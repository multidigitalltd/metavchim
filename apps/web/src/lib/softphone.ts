import {
  Inviter,
  Invitation,
  Registerer,
  RegistererState,
  SessionState,
  UserAgent,
  type Session,
} from "sip.js";
import type { SessionDescriptionHandler } from "sip.js/lib/platform/web";
import { phoneFromSipUri, sipUriFor } from "@metavchim/shared";

/**
 * הסופטפון — שיחה מהדפדפן, עם אוזניות, בלי מכשיר.
 *
 * הקובץ הזה עוטף את SIP.js ומחביא ממנו את כל השאר. המסך מקבל מצב
 * אחד (`SoftphoneState`) ושלוש פעולות, ואינו יודע דבר על רישום,
 * ‎SDP‎ או ‎ICE‎ — כך שינוי בספרייה לא מתפשט לרכיבי React.
 *
 * **למה WSS ולא SIP רגיל:** דפדפן אינו יכול לפתוח שקע UDP או TCP.
 * הדרך היחידה שלו לדבר SIP היא מעל WebSocket מאובטח, וזו הסיבה
 * שמרכזייה בלי WSS פשוט אינה ניתנת לחיבור מכאן — שום קוד שלנו לא
 * יכול לעקוף את זה.
 */

export type SoftphoneStatus =
  | "idle"
  | "connecting"
  | "registered"
  | "ringing"
  | "calling"
  | "in_call"
  | "failed";

export interface SoftphoneState {
  status: SoftphoneStatus;
  /** המספר של הצד השני, כשיש שיחה. */
  peerPhone?: string;
  /** השם, אחרי שנפתר מול הכרטיסים. */
  peerName?: string;
  muted: boolean;
  /** ‎`Date.now()`‎ של תחילת השיחה — למונה משך במסך. */
  startedAt?: number;
  error?: string;
}

export interface SoftphoneCredentials {
  wssUrl: string;
  domain: string;
  username: string;
  password: string;
}

const INITIAL: SoftphoneState = { status: "idle", muted: false };

export class Softphone {
  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private session: Session | null = null;
  private state: SoftphoneState = INITIAL;
  private readonly listeners = new Set<(state: SoftphoneState) => void>();

  /**
   * אלמנט אודיו יחיד לכל חיי הסופטפון.
   *
   * יצירת אלמנט חדש לכל שיחה נראתה נכונה עד שהתברר שדפדפנים חוסמים
   * ניגון על אלמנט שלא נגע בו משתמש. האלמנט הזה נוצר פעם אחת, וניגון
   * ראשון מתרחש אחרי לחיצה על "התחבר" — ומאותו רגע הוא מורשה.
   */
  private readonly audio: HTMLAudioElement;

  /** מי מתקשר — נפתר מול השרת, כי ה-INVITE נושא מספר ולא שם. */
  private readonly resolveName: (phone: string) => Promise<string | undefined>;

  constructor(resolveName: (phone: string) => Promise<string | undefined>) {
    this.resolveName = resolveName;
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    // לא מוצג — הוא רק צינור השמע
    this.audio.style.display = "none";
    document.body.appendChild(this.audio);
  }

  subscribe(fn: (state: SoftphoneState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SoftphoneState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async connect(creds: SoftphoneCredentials): Promise<void> {
    if (this.ua) return;
    this.set({ status: "connecting", error: undefined });
    try {
      const uri = UserAgent.makeURI(`sip:${creds.username}@${creds.domain}`);
      if (!uri) throw new Error("כתובת SIP לא תקינה");

      const ua = new UserAgent({
        uri,
        transportOptions: { server: creds.wssUrl },
        authorizationUsername: creds.username,
        authorizationPassword: creds.password,
        /*
         * שיחה נכנסת מגיעה כאן. היא **לא** נענית מעצמה: מענה אוטומטי
         * היה פותח את המיקרופון של הסוכן בלי שביקש, וזו הפרת פרטיות
         * של מי שיושב לידו לא פחות מאשר של הלקוח.
         */
        delegate: {
          onInvite: (invitation: Invitation) => {
            void this.onIncoming(invitation);
          },
        },
      });
      await ua.start();
      const registerer = new Registerer(ua);
      registerer.stateChange.addListener((state) => {
        if (state === RegistererState.Registered) this.set({ status: "registered" });
        /*
         * ‎Terminated‎ בזמן שיחה אינו אירוע שצריך להציג: הרישום פג
         * ומתחדש מעצמו, ושינוי הסטטוס היה מוחק מהמסך שיחה פעילה.
         */
        if (state === RegistererState.Unregistered && this.session === null) {
          this.set({ status: "connecting" });
        }
      });
      await registerer.register();
      this.ua = ua;
      this.registerer = registerer;
    } catch (error: unknown) {
      /*
       * **הניקוי אינו מוחק את השגיאה, והכישלון עולה החוצה.**
       *
       * קודם ה-catch כתב `failed` ומיד קרא ל-`disconnect`, שמאפס
       * למצב ההתחלתי — כלומר ההודעה נמחקה לפני שמישהו ראה אותה.
       * וגרוע מכך: הקורא קיבל Promise שהצליח, שמר "התחבר בהצלחה"
       * במכשיר, וכל רענון דף חזר על אותו כישלון שקט (ביקורת Codex).
       */
      await this.teardown();
      this.set({
        status: "failed",
        error: error instanceof Error ? error.message : "החיבור למרכזייה נכשל",
      });
      throw error;
    }
  }

  /** שחרור המשאבים בלבד — בלי לגעת במצב המוצג. */
  private async teardown(): Promise<void> {
    try {
      await this.registerer?.unregister();
      await this.ua?.stop();
    } catch {
      // ניתוק שנכשל אינו מצב שהמשתמש יכול לתקן
    }
    this.registerer = null;
    this.ua = null;
    this.session = null;
  }

  async disconnect(): Promise<void> {
    await this.teardown();
    this.state = INITIAL;
    for (const fn of this.listeners) fn(this.state);
  }

  /**
   * סוף החיים — ביציאה מהמערכת.
   *
   * ‎`disconnect` לבדו משאיר את אלמנט האודיו תלוי ב-DOM. הוא קטן,
   * אבל הוא נוצר מחדש בכל טעינה של הרכיב, ואלמנט שמנגן שמע של שיחה
   * שהסתיימה הוא בדיוק סוג הדבר שלא רוצים שיישאר אחרי יציאה.
   */
  async destroy(): Promise<void> {
    await this.disconnect();
    this.listeners.clear();
    this.audio.srcObject = null;
    this.audio.remove();
  }

  /** חיוג יוצא. המספר מגיע מהכרטיס, כמו בכל שאר המערכת. */
  async call(phone: string, name?: string): Promise<void> {
    const ua = this.ua;
    if (!ua) {
      this.set({ status: "failed", error: "הסופטפון אינו מחובר" });
      return;
    }
    const target = UserAgent.makeURI(sipUriFor(phone, ua.configuration.uri.host));
    if (!target) {
      this.set({ status: "failed", error: "מספר לא תקין לחיוג" });
      return;
    }
    const inviter = new Inviter(ua, target, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    this.attach(inviter);
    this.set({ status: "calling", peerPhone: phone, ...(name ? { peerName: name } : {}) });
    try {
      await inviter.invite();
    } catch (error: unknown) {
      this.set({
        status: "registered",
        error: error instanceof Error ? error.message : "החיוג נכשל",
        peerPhone: undefined,
        peerName: undefined,
      });
    }
  }

  /** מענה לשיחה נכנסת. רק מכאן — לחיצה מפורשת של הסוכן. */
  async answer(): Promise<void> {
    const invitation = this.session;
    if (!(invitation instanceof Invitation)) return;
    await invitation.accept({
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
  }

  /** ניתוק — עובד בכל שלב, ולכן שלוש דרכים לפי מצב השיחה. */
  async hangup(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      if (session.state === SessionState.Initial || session.state === SessionState.Establishing) {
        if (session instanceof Invitation) await session.reject();
        else if (session instanceof Inviter) await session.cancel();
      } else if (session.state === SessionState.Established) {
        await session.bye();
      }
    } catch {
      // שיחה שכבר נסגרה מהצד השני — הניקוי למטה עושה את שלו בכל מקרה
    }
    this.clearCall();
  }

  /**
   * השתקה. מכבה את המסלול המקומי ולא את המיקרופון עצמו — עצירת
   * המכשיר הייתה מכבה את נורית ההקלטה ומחזירה אותה בביטול ההשתקה,
   * ובחלק מהמערכות זה נשמע כקפיצה בשמע.
   */
  setMuted(muted: boolean): void {
    const pc = this.peerConnection();
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (sender.track) sender.track.enabled = !muted;
    }
    this.set({ muted });
  }

  private peerConnection(): RTCPeerConnection | undefined {
    const sdh = this.session?.sessionDescriptionHandler as SessionDescriptionHandler | undefined;
    return sdh?.peerConnection;
  }

  private async onIncoming(invitation: Invitation): Promise<void> {
    /*
     * שיחה שנייה בזמן שיחה פעילה נדחית מיד. "שיחה ממתינה" בלי מסך
     * שמנהל אותה הייתה משאירה את הסוכן עם שתי שיחות ובלי דרך לעבור
     * ביניהן — גרוע יותר מאשר לא לקבל אותה.
     */
    if (this.session) {
      await invitation.reject().catch(() => undefined);
      return;
    }
    const phone = phoneFromSipUri(invitation.remoteIdentity.uri.toString());
    this.attach(invitation);
    // מספר חסוי מגיע כ-anonymous — אין מה לפתור, ואין בזה תקלה
    this.set({
      status: "ringing",
      peerPhone: phone === "" ? undefined : phone,
      peerName: undefined,
      muted: false,
    });
    if (phone !== "") {
      const name = await this.resolveName(phone).catch(() => undefined);
      // רק אם השיחה עדיין אותה שיחה — התשובה עשויה להגיע אחרי ניתוק
      if (this.session === invitation && name) this.set({ peerName: name });
    }
  }

  private attach(session: Session): void {
    this.session = session;
    session.stateChange.addListener((state) => {
      if (state === SessionState.Established) {
        this.playRemote();
        this.set({ status: "in_call", startedAt: Date.now(), muted: false });
      }
      if (state === SessionState.Terminated) this.clearCall();
    });
  }

  /**
   * חיבור השמע המרוחק לאלמנט.
   *
   * ‎`getReceivers` ולא האירוע `ontrack`: הוא נקרא אחרי שהשיחה כבר
   * התבססה, ואירוע שקרה קודם היה מוחמץ — שיחה שנשמעת אילמת בלי שום
   * שגיאה, שהיא התקלה הכי קשה לאבחון בשמע.
   */
  private playRemote(): void {
    const pc = this.peerConnection();
    if (!pc) return;
    const stream = new MediaStream();
    for (const receiver of pc.getReceivers()) {
      if (receiver.track) stream.addTrack(receiver.track);
    }
    this.audio.srcObject = stream;
    void this.audio.play().catch(() => undefined);
  }

  private clearCall(): void {
    this.session = null;
    this.audio.srcObject = null;
    this.set({
      status: this.ua ? "registered" : "idle",
      peerPhone: undefined,
      peerName: undefined,
      startedAt: undefined,
      muted: false,
    });
  }
}
