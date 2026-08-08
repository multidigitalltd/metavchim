/**
 * חיבור מרכזיות טלפון — שכבת ההחלטות.
 *
 * מודל האינטגרציות: המשרד מחבר ספק (מרכזייה, ובעתיד גם אחרים), מקבל
 * מפתח webhook ייחודי משלו, והספק דוחף אליו אירועי שיחה. זו בדיוק
 * התבנית של `leadWebhookKey` שכבר עובדת לקליטת לידים מהאתר — מפתח
 * לכל משרד, נתיב ציבורי, וזיהוי המשרד לפי המפתח ולא לפי הקלט.
 *
 * הקובץ הזה לא מדבר עם רשת ולא עם בסיס נתונים: הוא מנרמל את מה
 * שהספק שלח, ומחליט מה לעשות איתו. כל החלטה כאן היא כזו שקל לטעות
 * בה בשקט, ולכן היא מכוסה בבדיקות.
 */
import { normalizePhone } from "./contact-people.js";

export type TelephonyProviderId = "generic" | "zadarma" | "voicenter" | "012";

export interface TelephonyProvider {
  id: TelephonyProviderId;
  label: string;
  /** מה המשרד צריך להזין כדי לחבר את הספק. */
  fields: { key: string; label: string; secret: boolean }[];
  /** האם הספק תומך בחיוג יוצא מהמערכת. */
  clickToDial: boolean;
}

/**
 * ספק "generic" הוא לא פשרה אלא ברירת המחדל המכוונת.
 *
 * מרכזיות בישראל שונות זו מזו בפרטים אבל כמעט כולן יודעות לקרוא
 * ל-URL עם פרמטרים בשיחה נכנסת. מי שיודע לעשות את זה מחובר תוך
 * דקה, בלי שנצטרך לכתוב מודול לכל ספק. ספק ייעודי נוסף רק כשהוא
 * מוסיף משהו שהגנרי לא נותן — חיוג יוצא, למשל.
 */
export const TELEPHONY_PROVIDERS: readonly TelephonyProvider[] = [
  {
    id: "generic",
    label: "מרכזייה כללית (Webhook)",
    fields: [],
    clickToDial: false,
  },
  {
    id: "zadarma",
    label: "Zadarma",
    fields: [
      { key: "apiKey", label: "מפתח API", secret: false },
      { key: "apiSecret", label: "סוד API", secret: true },
      { key: "callerId", label: "שלוחה לחיוג יוצא", secret: false },
    ],
    clickToDial: true,
  },
  {
    id: "voicenter",
    label: "Voicenter",
    fields: [
      { key: "token", label: "טוקן API", secret: true },
      { key: "extension", label: "שלוחה לחיוג יוצא", secret: false },
    ],
    clickToDial: true,
  },
  {
    id: "012",
    label: "012 מובייל / 015",
    fields: [
      { key: "token", label: "טוקן API", secret: true },
      { key: "extension", label: "שלוחה לחיוג יוצא", secret: false },
    ],
    clickToDial: true,
  },
];

export function telephonyProvider(id: string): TelephonyProvider | undefined {
  return TELEPHONY_PROVIDERS.find((p) => p.id === id);
}

/* ==================== אירוע שיחה ==================== */

/**
 * אותה תבנית של PhoneSchema — מספר ישראלי תקין אחרי נרמול.
 * מוגדרת כאן ולא מיובאת כדי שהקובץ יישאר בלי תלות ב-zod.
 */
const ISRAELI_PHONE = /^\+972[2-9]\d{7,8}$/u;

export type CallEventType = "ringing" | "answered" | "ended" | "missed";
export type CallDirection = "inbound" | "outbound";

/** אירוע גולמי אחרי נרמול, לפני שמחליטים מה לעשות איתו. */
export interface TelephonyEvent {
  type: CallEventType;
  direction: CallDirection;
  /** המספר של הצד השני — הלקוח. תמיד מנורמל. */
  peerPhone: string;
  /** מזהה השיחה אצל הספק — מפתח האידמפוטנטיות. */
  providerCallId: string;
  /** שלוחה/משתמש במרכזייה, לשיוך לסוכן. */
  extension?: string;
  durationSeconds?: number;
}

/**
 * חילוץ אירוע מתוך מה שהספק שלח.
 *
 * מקבל אובייקט שטוח (query string או JSON) ומחפש את השדות בשמות
 * המקובלים. מחזיר null כשחסר המידע המינימלי — מספר ומזהה שיחה —
 * במקום לנחש: אירוע בלי מספר לא ניתן לשייך לאיש קשר, ואירוע בלי
 * מזהה יירשם שוב בכל ניסיון חוזר של הספק.
 */
export function parseTelephonyEvent(raw: Record<string, unknown>): TelephonyEvent | null {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  };

  const providerCallId = pick("call_id", "callId", "uniqueid", "unique_id", "id", "session_id");
  if (providerCallId === "") return null;

  const directionRaw = pick("direction", "call_type", "type").toLowerCase();
  const direction: CallDirection =
    directionRaw.includes("out") || directionRaw.includes("יוצא") ? "outbound" : "inbound";

  /*
   * "הצד השני" תלוי בכיוון.
   *
   * בשיחה נכנסת הלקוח הוא המקור; בשיחה יוצאת הוא היעד, והמקור הוא
   * מספר המשרד. בחירה קבועה במקור הייתה תולה כל שיחה יוצאת על מספר
   * המשרד עצמו במקום על הלקוח שאליו התקשרו (ביקורת Codex).
   */
  const source = pick("caller", "caller_id", "callerid", "from", "src", "did_caller", "phone");
  const destination = pick("to", "destination", "called", "dst", "callee");
  const peerRaw = direction === "outbound" ? destination || source : source || destination;
  if (peerRaw === "") return null;

  /*
   * ולידציה ולא רק נרמול: normalizePhone מסיר תווים ומוסיף קידומת,
   * אבל אינו מאמת. בלי הבדיקה כאן ערך כמו "123" היה נשמר כשיחה, ואף
   * פותח כרטיס לקוח וליד עבור מספר שאינו קיים.
   */
  const peerPhone = normalizePhone(peerRaw);
  if (!ISRAELI_PHONE.test(peerPhone)) return null;

  const status = pick("status", "event", "state", "call_status").toLowerCase();
  const durationRaw = pick("duration", "billsec", "seconds");
  const durationSeconds = durationRaw === "" ? undefined : Number(durationRaw);

  return {
    type: eventTypeOf(status, durationSeconds),
    direction,
    peerPhone,
    providerCallId,
    // השלוחה היא של המשרד; ביעד כבר השתמשנו לבחירת הצד השני
    extension: pick("extension", "ext", "agent") || undefined,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
  };
}

/**
 * סיווג הסטטוס של הספק לאירוע שלנו.
 *
 * שיחה שהסתיימה באורך אפס היא שיחה שלא נענתה. הספקים לא עקביים
 * בשם הסטטוס, אבל כולם עקביים במשך — ולכן המשך מכריע כשיש סתירה.
 */
function eventTypeOf(status: string, duration: number | undefined): CallEventType {
  if (status.includes("ring") || status.includes("start") || status.includes("incoming")) {
    return "ringing";
  }
  if (status.includes("answer") || status.includes("bridge")) return "answered";
  if (status.includes("miss") || status.includes("noanswer") || status.includes("busy")) {
    return "missed";
  }
  if (status.includes("end") || status.includes("hangup") || status.includes("complete")) {
    return duration !== undefined && duration <= 0 ? "missed" : "ended";
  }
  return duration !== undefined && duration > 0 ? "ended" : "ringing";
}

/* ==================== מה עושים עם האירוע ==================== */

export interface CallAction {
  /** לרשום שורת שיחה בכרטיס — רק לאירוע סופי. */
  logCall: boolean;
  /** להקפיץ התראה לסוכן — בצלצול, כדי שיראה מי מתקשר לפני שהוא עונה. */
  notify: boolean;
  /** לפתוח ליד — מספר לא מוכר שדיבר איתנו בפועל. */
  createLead: boolean;
}

/**
 * ההחלטה המרכזית של המודול.
 *
 * שלוש טעויות אפשריות כאן, וכל אחת מהן מרעילה את המערכת בדרך אחרת:
 *
 * **רישום שיחה בצלצול** היה ממלא את ציר הזמן של הלקוח בשורות על
 * שיחות שלא קרו — כל צלצול שהמתווך לא הספיק לענות לו, וכל ניסיון
 * חוזר של אותו מתקשר. לכן שורת שיחה נרשמת רק על אירוע סופי.
 *
 * **התראה בסיום** הייתה מגיעה אחרי שהשיחה נגמרה, כלומר חסרת ערך.
 * המתווך רוצה לדעת *מי מתקשר* לפני שהוא עונה. לכן ההתראה בצלצול.
 *
 * **פתיחת ליד על כל מספר לא מוכר** הייתה מייצרת לידים מטעויות חיוג,
 * ממוקדנים וממספרים חסויים. לכן ליד נפתח רק כששיחה נכנסת ממספר לא
 * מוכר גם *נענתה* — מישהו באמת דיבר איתו.
 */
export function callAction(event: TelephonyEvent, knownContact: boolean): CallAction {
  const finished = event.type === "ended" || event.type === "missed";
  return {
    logCall: finished,
    notify: event.type === "ringing" && event.direction === "inbound",
    createLead:
      event.type === "ended" && event.direction === "inbound" && !knownContact,
  };
}

/** כותרת ההתראה שהמתווך רואה כשהטלפון מצלצל. */
export function incomingCallTitle(contactName: string | null, phone: string): string {
  return contactName ? `📞 ${contactName} מתקשר` : `📞 שיחה נכנסת מ-${phone}`;
}

/** תיאור השיחה לציר הזמן. */
export function describeCall(event: TelephonyEvent): string {
  const direction = event.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת";
  if (event.type === "missed") {
    return event.direction === "inbound" ? "שיחה נכנסת שלא נענתה" : "שיחה יוצאת ללא מענה";
  }
  const seconds = event.durationSeconds ?? 0;
  if (seconds <= 0) return direction;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const length = minutes > 0 ? `${minutes} דק׳ ${rest} שנ׳` : `${rest} שנ׳`;
  return `${direction} · ${length}`;
}
