"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useFeature } from "@/lib/use-features";
import { Softphone, type SoftphoneState } from "@/lib/softphone";

/**
 * פס השיחה — הסופטפון כפי שרואים אותו.
 *
 * הוא יושב בפריסה ולא בעמוד מסוים בכוונה: שיחה נכנסת חייבת להופיע
 * גם כשהסוכן נמצא במסך הנכסים, ופס ששייך למסך אחד היה נעלם ברגע
 * שהוא עובר בין דפים — כלומר בדיוק כשהשיחה מצלצלת.
 *
 * **החיבור אינו אוטומטי.** הרשמה למרכזייה פותחת חיבור קבוע ומבקשת
 * גישה למיקרופון, ולעשות את זה לכל מי שפותח את המערכת זו חוצפה. יש
 * כפתור, והמצב נזכר במכשיר — מי שהתחבר אתמול מחובר גם היום.
 */

const REMEMBER_KEY = "mv.softphone.on";

interface SoftphoneApi {
  state: SoftphoneState;
  /** זמין רק כשהסופטפון מחובר; אחרת `undefined` והכפתור מסתתר. */
  call?: (phone: string, name?: string) => void;
}

const SoftphoneContext = createContext<SoftphoneApi>({ state: { status: "idle", muted: false } });

/** מאפשר לכרטיס הלקוח לחייג בלי לדעת דבר על SIP. */
export function useSoftphone(): SoftphoneApi {
  return useContext(SoftphoneContext);
}

interface SoftphoneDto {
  ready: boolean;
  gap?: string;
  wssUrl?: string;
  domain?: string;
  username?: string;
  password?: string;
}

/** למה אי אפשר להתחבר — ומי אמור לתקן. */
const GAP_TEXT: Record<string, string> = {
  no_integration: "לא מחוברת מרכזייה במשרד",
  no_wss: "מנהל המשרד צריך להזין כתובת WSS בהגדרות המרכזייה",
  no_domain: "מנהל המשרד צריך להזין דומיין SIP בהגדרות המרכזייה",
  no_line: "הזינו את קו ה-SIP שלכם בהגדרות המרכזייה",
  no_line_password: "הזינו את סיסמת קו ה-SIP שלכם בהגדרות המרכזייה",
};

export function SoftphoneProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const enabled = useFeature("telephony");
  const phoneRef = useRef<Softphone | null>(null);
  const [state, setState] = useState<SoftphoneState>({ status: "idle", muted: false });
  const [gap, setGap] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * האם למשרד בכלל יש מרכזייה שסופטפון יכול להתחבר אליה. עד שהשרת
   * עונה — `false`, כלומר שום כפתור: כפתור "חבר סופטפון" אצל סוכן
   * שהמשרד שלו מעולם לא חיבר מרכזייה מוביל רק להודעת שגיאה.
   */
  const [available, setAvailable] = useState(false);

  const instance = useCallback((): Softphone => {
    phoneRef.current ??= new Softphone(async (phone: string) => {
      const res = await apiPost<{ name?: string }>("/settings/telephony/resolve-caller", { phone });
      return res.name;
    });
    return phoneRef.current;
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    setBusy(true);
    setGap(null);
    let dto: SoftphoneDto;
    try {
      dto = await apiGet<SoftphoneDto>("/settings/telephony/softphone");
    } catch {
      setGap("לא הצלחנו לטעון את פרטי החיבור");
      setBusy(false);
      return;
    }
    if (!dto.ready) {
      setGap(GAP_TEXT[dto.gap ?? ""] ?? "הסופטפון אינו מוגדר");
      /*
       * בלי זה, משרד שניתק את המרכזייה היה משאיר את מי שהתחבר בעבר
       * עם הודעת שגיאה קבועה בכל טעינת עמוד — החיבור-מחדש האוטומטי
       * היה מנסה ונכשל לנצח.
       */
      window.localStorage.removeItem(REMEMBER_KEY);
      setBusy(false);
      return;
    }
    try {
      await instance().connect({
        wssUrl: dto.wssUrl!,
        domain: dto.domain!,
        username: dto.username!,
        password: dto.password!,
      });
      /*
       * הדגל נשמר **רק אחרי הצלחה**. קודם הוא נשמר גם על כישלון, כי
       * `connect` בלע את השגיאה — וכל רענון דף חזר על אותו כישלון
       * שקט (ביקורת Codex).
       */
      window.localStorage.setItem(REMEMBER_KEY, "1");
    } catch {
      // ההודעה כבר במצב של הסופטפון עצמו; gap כאן היה מסתיר אותה
      window.localStorage.removeItem(REMEMBER_KEY);
    } finally {
      setBusy(false);
    }
  }, [instance]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiGet<{ available: boolean }>("/settings/telephony/softphone/availability")
      .then((res) => {
        if (!cancelled) setAvailable(res.available);
      })
      .catch(() => {
        // אין תשובה — אין כפתור; מי שכבר מחובר לא תלוי בבדיקה הזו
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const phone = instance();
    const unsubscribe = phone.subscribe(setState);
    /*
     * חיבור מחדש רק למי שכבר בחר בו. בלי הזיכרון הזה הסוכן היה לוחץ
     * "התחבר" בכל רענון דף — כלומר עשרות פעמים ביום.
     */
    if (window.localStorage.getItem(REMEMBER_KEY) === "1") void connect();
    return () => {
      unsubscribe();
      /*
       * **ניתוק מלא בפירוק הרכיב, ולא רק ביטול המנוי.**
       *
       * ביציאה מהמערכת ה-AppShell מסיר את הספק הזה. בלי הניתוק
       * ה-UserAgent נשאר רשום למרכזייה: שיחה שהייתה באוויר ממשיכה
       * אחרי היציאה, ולקוח ממשיך לקבל שיחות נכנסות בלי שום פס על
       * המסך שדרכו אפשר לענות או לנתק (ביקורת Codex).
       */
      phoneRef.current = null;
      void phone.destroy();
    };
  }, [enabled, instance, connect]);

  const api = useMemo<SoftphoneApi>(
    () => ({
      state,
      ...(state.status === "registered"
        ? { call: (phone: string, name?: string) => void instance().call(phone, name) }
        : {}),
    }),
    [state, instance],
  );

  return (
    <SoftphoneContext.Provider value={api}>
      {children}
      {enabled ? (
        <CallBar
          state={state}
          gap={gap}
          busy={busy}
          available={available}
          onConnect={() => void connect()}
          onDisconnect={() => {
            window.localStorage.removeItem(REMEMBER_KEY);
            void instance().disconnect();
          }}
          onAnswer={() => void instance().answer()}
          onHangup={() => void instance().hangup()}
          onToggleMute={() => instance().setMuted(!state.muted)}
        />
      ) : null}
    </SoftphoneContext.Provider>
  );
}

/** מונה משך השיחה. שנייה, לא דקה — כאן ההבדל כן נראה. */
function useElapsed(startedAt?: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === undefined) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function CallBar({
  state,
  gap,
  busy,
  available,
  onConnect,
  onDisconnect,
  onAnswer,
  onHangup,
  onToggleMute,
}: {
  state: SoftphoneState;
  gap: string | null;
  busy: boolean;
  available: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onAnswer: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
}): React.JSX.Element | null {
  const elapsed = useElapsed(state.startedAt);
  const busyCall =
    state.status === "ringing" || state.status === "calling" || state.status === "in_call";

  // בלי שיחה ובלי חיבור הפס לא קיים — הוא לא תופס מקום סתם
  if (!busyCall && state.status === "idle" && gap === null && !busy) {
    /*
     * שבב "חבר סופטפון" רק כשלמשרד באמת יש מרכזייה שדפדפן יכול
     * להתחבר אליה. אצל כל השאר הכפתור היה מוביל להודעת שגיאה בלבד.
     */
    return available ? <ConnectChip onConnect={onConnect} busy={busy} /> : null;
  }

  const who = state.peerName ?? state.peerPhone ?? "מספר חסוי";

  return (
    <div
      role={state.status === "ringing" ? "alert" : "status"}
      aria-live={state.status === "ringing" ? "assertive" : "polite"}
      className="fixed bottom-3 left-3 z-50 flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 shadow-lg"
      style={{
        borderColor: state.status === "ringing" ? "var(--color-primary)" : "var(--color-border)",
        background: "var(--color-surface)",
        maxWidth: "min(92vw, 460px)",
      }}
    >
      {busyCall ? (
        <>
          <span className="font-bold">
            {state.status === "ringing"
              ? `📞 ${who} מתקשר`
              : state.status === "calling"
                ? `מחייג ל-${who}…`
                : who}
          </span>
          {state.status === "in_call" ? (
            <span dir="ltr" style={{ color: "var(--color-text-muted)" }}>
              {elapsed}
            </span>
          ) : null}
          {state.status === "ringing" ? (
            <button type="button" className="mv-btn-action" onClick={onAnswer}>
              ענה
            </button>
          ) : null}
          {state.status === "in_call" ? (
            <button
              type="button"
              className="mv-btn-plain"
              onClick={onToggleMute}
              aria-pressed={state.muted}
            >
              {state.muted ? "🔇 מושתק" : "🎤 השתק"}
            </button>
          ) : null}
          <button
            type="button"
            className="mv-btn-plain"
            style={{ color: "var(--color-danger)" }}
            onClick={onHangup}
          >
            {state.status === "ringing" ? "דחה" : "נתק"}
          </button>
        </>
      ) : (
        <>
          <span className="text-sm">
            {busy
              ? "מתחבר למרכזייה…"
              : state.status === "registered"
                ? "☎️ הסופטפון מחובר"
                : state.status === "failed"
                  ? `הסופטפון לא התחבר — ${state.error ?? ""}`
                  : (gap ?? "הסופטפון מנותק")}
          </span>
          {state.status === "registered" ? (
            <button type="button" className="mv-btn-plain" onClick={onDisconnect}>
              נתק
            </button>
          ) : (
            <button type="button" className="mv-btn-plain" disabled={busy} onClick={onConnect}>
              נסה שוב
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** לפני החיבור הראשון — שבב קטן ולא פס שלם. */
function ConnectChip({ onConnect, busy }: { onConnect: () => void; busy: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      className="mv-btn-plain fixed bottom-3 left-3 z-50 shadow-lg"
      disabled={busy}
      onClick={onConnect}
      title="חיבור הסופטפון מאפשר לדבר עם אוזניות ישירות מהמסך"
    >
      ☎️ חבר סופטפון
    </button>
  );
}
