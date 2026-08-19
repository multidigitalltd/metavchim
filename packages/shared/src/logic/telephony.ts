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

export type TelephonyProviderId = "generic" | "zadarma" | "voicenter" | "015";

export interface TelephonyProvider {
  id: TelephonyProviderId;
  label: string;
  /** מה המשרד צריך להזין כדי לחבר את הספק. */
  fields: { key: string; label: string; secret: boolean }[];
  /**
   * האם **קיים מימוש** של חיוג יוצא לספק הזה — לא האם הספק תומך.
   *
   * הדגל הזה היה מוצהר `true` על שלושה ספקים בלי שורת קוד שמחייגת,
   * והמסך הבטיח פיצ'ר שלא קרה. הוא נכון רק כשיש `dial` בשירות.
   */
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
    /*
     * 015 — הספק היחיד עם חיוג יוצא ממומש.
     *
     * ה-API שלו מאמת ב**שם משתמש וסיסמה** ולא בטוקן (`auth_username`,
     * `auth_password`), וזה מה שהיה כתוב כאן קודם בטעות.
     *
     * **רק הסיסמה סודה.** שם המשתמש הוא שם, ולא מפתח שפותח משהו —
     * בדיוק כמו `apiKey` מול `apiSecret` אצל Zadarma כאן למטה. סימונו
     * כסוד גרם לשלושה נזקים ממשיים: השדה רונדר כ-`password`, ולכן
     * הדפדפן מילא לתוכו סיסמה שמורה של המשתמש; הערך לא הוצג בחזרה,
     * ולכן אי אפשר היה לבדוק מה בעצם שמור; והוא נגרר לריקוד
     * "השאירו ריק כדי לא לשנות" בלי סיבה.
     *
     * `defaultLine` הוא נפילה-לאחור בלבד. השיחה מצלצלת קודם **לטלפון
     * של הסוכן** (הפרופיל שלו), כי זו כל הנקודה של חיוג בלחיצה; קו
     * משרדי אחד לכולם היה מחבר את הלקוח למי שבמקרה הרים.
     */
    id: "015",
    label: "015 / 012 מובייל",
    fields: [
      { key: "authUsername", label: "שם משתמש ב-015", secret: false },
      { key: "authPassword", label: "סיסמה ב-015", secret: true },
      { key: "defaultLine", label: "קו ברירת מחדל (כשלסוכן אין טלפון בפרופיל)", secret: false },
      { key: "callerId", label: "מזהה מתקשר שיוצג ללקוח (לא חובה)", secret: false },
      /*
       * שני השדות של הסופטפון. הם ברמת המשרד ולא ברמת הסוכן כי הם
       * זהים לכולם — מה שמשתנה בין סוכנים הוא קו ה-SIP האישי, והוא
       * יושב על המשתמש.
       */
      { key: "sipWssUrl", label: "כתובת WSS לסופטפון (wss://…)", secret: false },
      { key: "sipDomain", label: "דומיין SIP (למשל sip.015.net)", secret: false },
    ],
    clickToDial: true,
  },
  {
    id: "zadarma",
    label: "Zadarma",
    fields: [
      { key: "apiKey", label: "מפתח API", secret: false },
      { key: "apiSecret", label: "סוד API", secret: true },
      { key: "callerId", label: "שלוחה לחיוג יוצא", secret: false },
    ],
    // קליטת שיחות עובדת; חיוג יוצא טרם מומש מול ה-API שלהם
    clickToDial: false,
  },
  {
    id: "voicenter",
    label: "Voicenter",
    fields: [
      { key: "token", label: "טוקן API", secret: true },
      { key: "extension", label: "שלוחה לחיוג יוצא", secret: false },
    ],
    clickToDial: false,
  },
];

export function telephonyProvider(id: string): TelephonyProvider | undefined {
  return TELEPHONY_PROVIDERS.find((p) => p.id === id);
}

/**
 * מיזוג הסודות של אינטגרציה — **לפי מפתח, לא כגוש אחד**.
 *
 * המסך אומר "השאירו ריק כדי לא לשנות", ושדה סוד ריק פשוט אינו נשלח.
 * הכלל הזה עובד כשיש סוד אחד. עם שניים הוא הרס נתונים שקט: שמירה
 * חוזרת שבה מולא רק שם המשתמש שלחה ‎`{authUsername}`‎, והשרת החליף את
 * **כל** הגוש — כלומר מחק את הסיסמה. המסך הראה חיבור תקין, והחיוג
 * ענה "חסרים פרטי ההתחברות", בלי שאיש נגע בסיסמה.
 *
 * שלושה כללים, וכל אחד מהם מונע תקלה אחרת:
 *
 * - **מיזוג לפי מפתח** — סוד שלא נשלח נשמר כפי שהיה.
 * - **החלפת ספק מנקה** — הסוד של Zadarma לא נגרר לחיבור 015. הוא
 *   חסר משמעות שם, ובעיקר: אין סיבה שיישאר מוצפן בבסיס הנתונים אחרי
 *   שהמשרד עזב את הספק.
 * - **רק מפתחות שהספק מכיר, ורק ערכים לא ריקים** — כך שדה שהוסר
 *   מרשימת הסודות (או עבר להיות גלוי) מתנקה מעצמו בשמירה הבאה,
 *   ומחרוזת ריקה לא נשמרת כאילו היא ערך.
 */
export function mergeIntegrationSecrets(
  previous: Record<string, string>,
  incoming: Record<string, string>,
  secretKeys: readonly string[],
  options: { providerChanged: boolean } = { providerChanged: false },
): Record<string, string> {
  const allowed = new Set(secretKeys);
  const base = options.providerChanged ? {} : previous;
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...base, ...incoming })) {
    if (allowed.has(key) && typeof value === "string" && value.trim() !== "") {
      merged[key] = value.trim();
    }
  }
  return merged;
}

/** מפתחות הסוד של ספק — הרשימה שמותר לשמור עבורו. */
export function telephonySecretKeys(provider: TelephonyProvider): string[] {
  return provider.fields.filter((f) => f.secret).map((f) => f.key);
}

/**
 * שדה שהיה סוד והפך לגלוי — נקרא מהמקום שבו הוא **באמת** שמור.
 *
 * `authUsername` נשמר עד היום בגוש המוצפן. מרגע שהוא שדה גלוי, המסך
 * קורא אותו מ-`config` — שם הוא לא קיים בחיבורים ותיקים. בלי הגישור
 * הזה הטופס היה מציג שם משתמש ריק, השמירה הראשונה הייתה כותבת ריק
 * ל-`config`, ו-`mergeIntegrationSecrets` היה זורק את הערך הישן מהגוש
 * כי הוא כבר אינו מפתח סוד מוכר — כלומר בדיוק אותה מחיקה שקטה שה-PR
 * הזה בא לתקן, רק דרך אחרת (ביקורת Codex).
 *
 * הגישור הוא **קריאה בלבד**, והוא מהגר את עצמו: ברגע שהטופס מציג את
 * הערך הנכון, השמירה הבאה כותבת אותו ל-`config` והעותק המוצפן נזרק.
 * ערך קיים ב-`config` תמיד גובר, ולכן מנהל שמנקה שדה בכוונה מנקה
 * אותו באמת.
 */
export function mergeLegacySecretsIntoConfig(
  provider: TelephonyProvider,
  config: Record<string, unknown>,
  storedSecrets: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const field of provider.fields) {
    if (field.secret) continue;
    const current = out[field.key];
    const isEmpty = current === undefined || current === null || String(current).trim() === "";
    const legacy = (storedSecrets[field.key] ?? "").trim();
    if (isEmpty && legacy !== "") out[field.key] = legacy;
  }
  return out;
}

/* ==================== סופטפון בדפדפן (WebRTC) ==================== */

/**
 * מה שהדפדפן צריך כדי להירשם למרכזייה.
 *
 * ‎`wssUrl` הוא **חובה ולא נוחות**: דפדפן אינו יכול לדבר SIP רגיל
 * (UDP/TCP), רק SIP over WebSocket מאובטח. מרכזייה בלי WSS פשוט אינה
 * ניתנת לחיבור מהדפדפן, ואין דרך לעקוף את זה בקוד שלנו.
 */
export interface SoftphoneConfig {
  wssUrl: string;
  domain: string;
  username: string;
  password: string;
}

/** למה הסופטפון אינו זמין — כל סיבה והפעולה שסוגרת אותה. */
export type SoftphoneGap =
  | "no_integration"
  | "no_wss"
  | "no_domain"
  | "no_line"
  | "no_line_password";

/**
 * מה חסר כדי שהסופטפון יעבוד. `null` = הכול מוכן.
 *
 * ההפרדה בין החוסרים אינה קוסמטית: שניים מהם באחריות מנהל המשרד
 * (כתובת WSS ודומיין) ושניים באחריות הסוכן עצמו (הקו והסיסמה שלו).
 * הודעה אחת גנרית הייתה שולחת את הסוכן למסך שאין לו בכלל גישה אליו.
 */
export function softphoneGap(input: {
  connected: boolean;
  wssUrl?: string;
  domain?: string;
  username?: string;
  hasPassword: boolean;
}): SoftphoneGap | null {
  if (!softphoneOfficeReady(input)) {
    if (!input.connected) return "no_integration";
    if ((input.wssUrl ?? "").trim() === "") return "no_wss";
    return "no_domain";
  }
  if ((input.username ?? "").trim() === "") return "no_line";
  if (!input.hasPassword) return "no_line_password";
  return null;
}

/**
 * האם צד **המשרד** מוכן לסופטפון — מרכזייה פעילה עם WSS ודומיין.
 *
 * זו הבדיקה שקובעת אם להציג בכלל את כפתור "חבר סופטפון": במשרד
 * שהמרכזייה שלו לא תומכת בחיבור מהדפדפן (או שאין לו מרכזייה) הכפתור
 * הוא הבטחת שווא — אין שום דבר שהסוכן יכול לעשות כדי שהוא יעבוד.
 * חוסר בצד הסוכן (קו וסיסמה) דווקא כן מציג אותו: הלחיצה מסבירה מה
 * להשלים ואיפה.
 */
export function softphoneOfficeReady(input: {
  connected: boolean;
  wssUrl?: string;
  domain?: string;
}): boolean {
  return input.connected && (input.wssUrl ?? "").trim() !== "" && (input.domain ?? "").trim() !== "";
}

/**
 * כתובת SIP לחיוג יוצא.
 *
 * המספר מנורמל ל-E.164 בכל המערכת, אבל מרכזיות ישראליות מצפות
 * לצורה המקומית בחיוג (‎0501234567‎ ולא ‎+972501234567‎) — שליחת הצורה
 * הבינלאומית גורמת ל-404 מהמרכזייה על מספר תקין לחלוטין.
 */
export function sipUriFor(phone: string, domain: string): string {
  /*
   * הניקוי קודם לכול, ולא רק בענף אחד.
   *
   * קודם ענף ה-+972 עשה `slice` בלי לנקות, והענף השני ניקה — אי-סימטריה
   * שקטה שהופכת מספר שמור פגום לזריקת תווים לתוך כתובת SIP. שורה
   * חדשה בתוך URI היא הזרקת כותרת בפרוטוקול הזה, ואין סיבה שהפונקציה
   * תסמוך על מי שקרא לה.
   */
  const clean = phone.replace(/[^\d+]/gu, "");
  const local = clean.startsWith("+972") ? `0${clean.slice(4)}` : clean;
  return `sip:${local}@${domain}`;
}

/** המספר מתוך כתובת SIP נכנסת — ‎`sip:0501234567@host`‎ → ‎`0501234567`‎. */
export function phoneFromSipUri(uri: string): string {
  const user = uri.replace(/^sips?:/u, "").split("@")[0] ?? "";
  return user.replace(/[^\d+]/gu, "");
}

/* ==================== אירוע שיחה ==================== */

/**
 * אותה תבנית של PhoneSchema — מספר ישראלי תקין אחרי נרמול.
 * מוגדרת כאן ולא מיובאת כדי שהקובץ יישאר בלי תלות ב-zod.
 */
/*
 * מיוצא כדי שהמספרים הווירטואליים ישתמשו **באותה** בדיקה בדיוק.
 * עותק שני היה יכול לסטות, ואז מספר שנשמר כתקין לא היה מותאם
 * כשמתקשרים אליו — בלי שום שגיאה שמישהו יראה.
 */
export const ISRAELI_PHONE = /^\+972[2-9]\d{7,8}$/u;

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
  /**
   * המספר שאליו הלקוח התקשר — **הצד שלנו בשיחה**.
   *
   * עד כה הוא נזרק: `readCore` חילץ את שני הצדדים ושמר רק את הלקוח.
   * הוא הבסיס למספרים וירטואליים — מספר נפרד לכל קמפיין, לכל סוכן
   * או לכל נכס — ובלעדיו אי אפשר לדעת *מאיפה* הגיעה השיחה, רק *ממי*.
   *
   * `undefined` כשהמספר אינו מספר טלפון ישראלי תקין: שלוחה פנימית
   * בת שלוש ספרות אינה מספר שמפרסמים, ושמירתה הייתה מייצרת "מספר
   * וירטואלי" שלעולם לא יותאם לשום הגדרה.
   */
  dialedNumber?: string;
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
/**
 * **למה** האירוע לא נקלט — לאבחון, לא לזרימה.
 *
 * `parseTelephonyEvent` מחזיר `null` מארבע סיבות שונות לגמרי, ואחת
 * מהן — מספר חסוי — היא מצב נורמלי לחלוטין ולא תקלת הגדרה. הצגת
 * "שמות השדות אינם נתמכים" על שיחה ממספר חסוי שולחת את מנהל המשרד
 * לחפש בעיה שאינה קיימת (ביקורת Codex).
 */
export type TelephonyParseIssue =
  | "no_fields"
  | "no_call_id"
  | "no_phone"
  | "invalid_phone";

export function telephonyParseIssue(raw: Record<string, unknown>): TelephonyParseIssue | null {
  /*
   * **בקשה ריקה היא אבחנה בפני עצמה, ולא "חסר מזהה שיחה".**
   *
   * זה המצב שנוצר כשה-Content-Type אינו תואם לתבנית — כותרת שאומרת
   * JSON וגוף שהוא URL-encoded, או להפך. השרת לא מצליח לפרסר, הגוף
   * מגיע כאובייקט ריק, וכל שדה כמובן חסר. הודעה על "מזהה שיחה" הייתה
   * שולחת לחפש הגדרה אצל הספק, בזמן שהתקלה היא שורה אחת בכותרות.
   */
  if (Object.keys(raw).length === 0) return "no_fields";
  const core = readCore(raw);
  if (core.providerCallId === "") return "no_call_id";
  if (core.peerRaw === "") return "no_phone";
  if (!ISRAELI_PHONE.test(normalizePhone(core.peerRaw))) return "invalid_phone";
  return null;
}

/*
 * שמות השדות — **רשימה אחת**, לא שתיים.
 *
 * הניתוח והאבחון חלקו עד כה את `pickFrom` בלבד, כלומר את מנגנון
 * הקריאה — אבל כל אחד מהם החזיק עותק משלו של שמות השדות. הוספת שם
 * חדש לצד אחד בלבד הייתה יוצרת בדיוק את הסתירה שהשיתוף בא למנוע:
 * אירוע שנקלט בהצלחה ומאובחן כ"חסר מספר", או להפך.
 */
const CALL_ID_KEYS = [
  "call_id",
  "callId",
  // ‎`#callid#`‎ של 015; `uniqueid` שלו הוא רגל בודדת ולכן פחות טוב
  "callid",
  "uniqueid",
  "unique_id",
  "id",
  "session_id",
] as const;
const DIRECTION_KEYS = ["direction", "call_type", "type"] as const;
/*
 * ‎`callerid_external` לפני `snumber`: הראשון הוא המספר החיצוני
 * שהתקשר, והשני יכול להיות שלוחה פנימית — שלוחה אינה עוברת את
 * ולידציית המספר, כלומר השיחה הייתה נזרקת במקום להיתלות על הלקוח.
 */
const SOURCE_KEYS = [
  "caller",
  "caller_id",
  "callerid",
  "callerid_external",
  "snumber",
  "from",
  "src",
  "did_caller",
  "phone",
] as const;
const DESTINATION_KEYS = [
  "to",
  "destination",
  "called",
  "dst",
  "callee",
  // ‎`#cnumber#`/`#dnumber#`‎ של 015 — היעד בחיוג יוצא הוא הלקוח
  "cnumber",
  "dnumber",
] as const;
const STATUS_KEYS = ["status", "event", "state", "call_status"] as const;
/*
 * ‎`talktime` **לפני** `totaltime`: הראשון אינו כולל צלצול. שיחה שלא
 * נענתה מגיעה מ-015 עם ‎`totaltime`‎ חיובי (היא צלצלה) ו-`talktime`
 * אפס — והעדפת `totaltime` הייתה מסווגת כל שיחה שלא נענתה כשיחה
 * שהתקיימה, כלומר בדיוק ההפך ממה שהמתווך צריך לראות.
 */
const DURATION_KEYS = ["duration", "billsec", "seconds", "talktime", "totaltime"] as const;
const EXTENSION_KEYS = ["extension", "ext", "agent"] as const;

/** מזהה, כיוון והמספר של הצד השני — הבסיס שגם הניתוח וגם האבחון צריכים. */
function readCore(raw: Record<string, unknown>): {
  providerCallId: string;
  direction: CallDirection;
  peerRaw: string;
  /** הצד שלנו — המספר שאליו התקשרו. ראו `dialedNumber`. */
  ownRaw: string;
} {
  const pick = pickFrom(raw);
  const providerCallId = pick(...CALL_ID_KEYS);
  const directionRaw = pick(...DIRECTION_KEYS).toLowerCase();
  const direction: CallDirection =
    directionRaw.includes("out") || directionRaw.includes("יוצא") ? "outbound" : "inbound";
  /*
   * "הצד השני" תלוי בכיוון.
   *
   * בשיחה נכנסת הלקוח הוא המקור; בשיחה יוצאת הוא היעד, והמקור הוא
   * מספר המשרד. בחירה קבועה במקור הייתה תולה כל שיחה יוצאת על מספר
   * המשרד עצמו במקום על הלקוח שאליו התקשרו (ביקורת Codex).
   */
  const source = pick(...SOURCE_KEYS);
  const destination = pick(...DESTINATION_KEYS);
  /*
   * הצד שלנו הוא ההפך המדויק של הצד השני, ולכן נגזר מאותם שני
   * ערכים ובאותו כיוון — ולא מרשימת שדות שלישית שהייתה יכולה
   * לסטות מהם.
   */
  return {
    providerCallId,
    direction,
    peerRaw: direction === "outbound" ? destination || source : source || destination,
    ownRaw: direction === "outbound" ? source : destination,
  };
}

/** קורא שדה בשמות המקובלים. משותף לניתוח ולאבחון — לא שני העתקים. */
function pickFrom(raw: Record<string, unknown>): (...keys: string[]) => string {
  return (...keys: string[]): string => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  };
}

/**
 * שמות שדות בטוחים לשמירה לאבחון.
 *
 * `Object.keys` אינו בהכרח רשימת שמות תמימה: ספק שמייצר מפתחות
 * דינמיים יכול לשלוח `{"0501234567": "..."}`, וכך מספר הטלפון של
 * הלקוח היה נשמר בעמודה גלויה ונכתב ללוג — בדיוק מה שההצפנה בכל
 * שאר המערכת מונעת (ביקורת Codex).
 *
 * לכן רשימת היתר: רק מה שנראה כמו שם שדה נשמר, וכל השאר מוחלף
 * בסימון. זה עדיין מספיק למיפוי, כי שם שדה אמיתי תמיד עובר.
 */
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u;
const MAX_DIAGNOSTIC_KEYS = 25;

/**
 * שדות שמותר לשמור **עם הערך** ביומן האבחון.
 *
 * רשימת היתר ולא רשימת חסימה, ובכוונה: הגוף מגיע מגורם חיצוני, וכל
 * שדה שלא חשבנו עליו הוא שדה שעלול להכיל מספר טלפון או שם של לקוח.
 * רשימת חסימה הייתה מדליפה בדיוק את מה שלא צפינו.
 *
 * מה שבפנים הוא טכני בלבד — נתיב הקלטה, סטטוס, כיוון, מזהים
 * וזמנים. מה שבחוץ הוא כל מה שמזהה אדם: `callerid_external`,
 * `snumber`, `cnumber`, `callername`.
 *
 * הצורך אמיתי: כשמרכזייה מתחילה לשלוח שדה חדש, לדעת ש"הוא הגיע"
 * אינו מספיק — צריך לראות את **הצורה** של הערך כדי לבנות מולו.
 */
const VALUE_SAFE_KEYS = new Set([
  "recording",
  "status",
  "direction",
  "callid",
  "uniqueid",
  "start",
  "answered",
  "end",
  "talktime",
  "totaltime",
  "extension",
  "server",
  "stype",
  "ctype",
  "dtype",
]);

/** אורך מרבי לערך בודד ביומן — נתיב הקלטה ארוך אינו מציף את השורה. */
const MAX_VALUE_LENGTH = 120;

/**
 * שמות השדות, ולשדות הטכניים גם הערך.
 *
 * `key=value` למה שבטוח, `key` בלבד לכל השאר — כך שורה אחת ביומן
 * עונה גם על "מה הגיע" וגם על "איך זה נראה", בלי להכניס פרטי לקוח
 * לעמודה שנקראת בעיניים.
 */
export function diagnosticFields(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(raw).slice(0, MAX_DIAGNOSTIC_KEYS)) {
    if (!SAFE_KEY.test(key)) {
      parts.push("‹שדה לא תקני›");
      continue;
    }
    const value = raw[key];
    const printable =
      VALUE_SAFE_KEYS.has(key) && (typeof value === "string" || typeof value === "number")
        ? String(value).slice(0, MAX_VALUE_LENGTH)
        : null;
    parts.push(printable !== null && printable !== "" ? `${key}=${printable}` : key);
  }
  return [...new Set(parts)].join(", ").slice(0, 1000);
}

export function safeDiagnosticKeys(keys: readonly string[]): string {
  const seen = new Set<string>();
  for (const key of keys.slice(0, MAX_DIAGNOSTIC_KEYS)) {
    seen.add(SAFE_KEY.test(key) ? key : "‹שדה לא תקני›");
  }
  return [...seen].join(", ").slice(0, 400);
}

export function parseTelephonyEvent(raw: Record<string, unknown>): TelephonyEvent | null {
  // אותם שמות שדות בדיוק כמו באבחון — readCore הוא המקור היחיד
  const pick = pickFrom(raw);
  const { providerCallId, direction, peerRaw, ownRaw } = readCore(raw);
  if (providerCallId === "") return null;
  if (peerRaw === "") return null;

  /*
   * ולידציה ולא רק נרמול: normalizePhone מסיר תווים ומוסיף קידומת,
   * אבל אינו מאמת. בלי הבדיקה כאן ערך כמו "123" היה נשמר כשיחה, ואף
   * פותח כרטיס לקוח וליד עבור מספר שאינו קיים.
   */
  const peerPhone = normalizePhone(peerRaw);
  if (!ISRAELI_PHONE.test(peerPhone)) return null;

  const status = pick(...STATUS_KEYS).toLowerCase();
  const durationRaw = pick(...DURATION_KEYS);
  const durationSeconds = durationRaw === "" ? undefined : Number(durationRaw);

  return {
    type: eventTypeOf(status, durationSeconds),
    direction,
    peerPhone,
    providerCallId,
    // השלוחה היא של המשרד; ביעד כבר השתמשנו לבחירת הצד השני
    extension: pick(...EXTENSION_KEYS) || undefined,
    /*
     * המספר שאליו התקשרו — רק אם הוא מספר ישראלי תקין.
     *
     * שלוחה פנימית ("203") ותווית מרכזייה אינן מספרים שמפרסמים,
     * ושמירתן הייתה מייצרת "מספר וירטואלי" שלעולם לא יותאם לשום
     * הגדרה — ורעש בדוח הקמפיינים.
     */
    dialedNumber: dialedNumberOf(ownRaw),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
  };
}

/** המספר שלנו בצורתו המנורמלת, או `undefined` כשאינו מספר טלפון. */
function dialedNumberOf(raw: string): string | undefined {
  if (raw === "") return undefined;
  const normalized = normalizePhone(raw);
  return ISRAELI_PHONE.test(normalized) ? normalized : undefined;
}

/**
 * סיווג הסטטוס של הספק לאירוע שלנו.
 *
 * שיחה שהסתיימה באורך אפס היא שיחה שלא נענתה. הספקים לא עקביים
 * בשם הסטטוס, אבל כולם עקביים במשך — ולכן המשך מכריע כשיש סתירה.
 */
function eventTypeOf(status: string, duration: number | undefined): CallEventType {
  /*
   * **סיום נבדק ראשון.** ‎"Hangup Answered Only" של 015 הוא אירוע
   * ניתוק, אבל הוא מכיל את המילה "answered" — ובדיקת המענה לפניו
   * הייתה מסווגת את אירוע הניתוק **היחיד** שהמרכזייה שולחת כ"נענתה",
   * ואז שורת השיחה לא הייתה נרשמת כלל, כי רק אירוע סופי נרשם.
   */
  if (status.includes("hangup") || status.includes("end") || status.includes("complete")) {
    return duration !== undefined && duration <= 0 ? "missed" : "ended";
  }
  /*
   * הצורות השליליות לפני "answer" מאותה סיבה: `"noanswer".includes("answer")`
   * הוא אמת, ולכן הבדיקה הזו הייתה קוד מת עד היום — כל "noanswer"
   * סווג כשיחה שנענתה. ‎"abandon" של 015 הוא מתקשר שוויתר בהמתנה בתור,
   * וזו שיחה שלא נענתה לכל דבר: המתווך צריך לראות אותה.
   */
  if (
    status.includes("miss") ||
    status.includes("noanswer") ||
    status.includes("no_answer") ||
    status.includes("unanswer") ||
    status.includes("busy") ||
    status.includes("abandon")
  ) {
    return "missed";
  }
  if (status.includes("answer") || status.includes("bridge")) return "answered";
  /*
   * ‎"calling" הוא שם האירוע של 015 לתחילת שיחה. בלעדיו הוא נפל
   * לברירת המחדל שבתחתית, שהחזירה "ringing" רק במקרה — התנהגות נכונה
   * שאיש לא הבטיח, ושהייתה נשברת ברגע ש-015 יצרף משך לאירוע.
   */
  if (
    status.includes("ring") ||
    status.includes("start") ||
    status.includes("incoming") ||
    status.includes("calling")
  ) {
    return "ringing";
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
 * ממוקדנים וממספרים חסויים. לכן ליד נפתח רק כשהשיחה גם *נענתה* —
 * מישהו באמת דיבר איתו.
 *
 * ## למה גם שיחה יוצאת פותחת ליד
 *
 * עד כה `createLead` היה מוגבל לשיחות נכנסות, ולכן סוכן שהתקשר
 * ללקוח חדש יצר **שורת שיחה יתומה**: בלי `contactId` ובלי `leadId`,
 * כלומר שורה שאינה מופיעה בשום כרטיס ואי אפשר להגיע אליה מאף מסך.
 * מבחינת המתווך "לא נרשם כלום".
 *
 * זה הפוך מהמציאות של תיווך: מתווך שמחייג ללקוח פוטנציאלי, מציע לו
 * נכס ומדבר איתו — ביצע בדיוק את הפעולה שהמערכת אמורה לתעד. שיחה
 * יוצאת שנענתה היא **ראיה חזקה יותר** לעניין מאשר שיחה נכנסת: היא
 * דורשת שהסוכן טרח לחייג.
 *
 * ההגנה מפני זבל נשארת אותה הגנה — רק שיחה שנענתה, ורק למספר שאינו
 * מוכר. חיוג שגוי שנותק בצלצול אינו פותח דבר.
 */
export function callAction(event: TelephonyEvent, knownContact: boolean): CallAction {
  const finished = event.type === "ended" || event.type === "missed";
  return {
    logCall: finished,
    notify: event.type === "ringing" && event.direction === "inbound",
    createLead: event.type === "ended" && !knownContact,
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

/* ==================== חיוג יוצא — 015 ==================== */

/**
 * ‎`calls/make` של 015 — בניית הבקשה.
 *
 * **השיחה דו-שלבית**: 015 מצלצל קודם ל-`snumber` (הטלפון של הסוכן),
 * וכשהוא עונה — מחייג ל-`cnumber` (הלקוח) ומחבר ביניהם. זה המודל
 * הנכון לחיוג בלחיצה: הסוכן לא צריך להקליד, והלקוח רואה שיחה
 * מהמשרד.
 *
 * `wait` נשלח בכוונה: בלעדיו 015 מחזיר 204 בלי `callid`, ואז אין
 * לנו מזהה לקשור אליו את האירועים שיגיעו ב-Webhook — כלומר השיחה
 * שהמערכת יזמה תיראה כמו שיחה זרה.
 *
 * הפונקציה מחזירה URL ולא שולחת אותו: כך היא ניתנת לבדיקה בלי רשת,
 * וכל ההחלטות על שמות הפרמטרים נבדקות מול התיעוד פעם אחת.
 */
export const PBX015_MAKE_URL = "https://www.015pbx.net/local/api/json/calls/make/";

export function build015DialUrl(input: {
  authUsername: string;
  authPassword: string;
  /** הטלפון של הסוכן — הצד שמצלצל ראשון. */
  agentLine: string;
  /** הלקוח — הצד שאליו מחברים אחרי שהסוכן ענה. */
  destination: string;
  /** מזהה המתקשר שיוצג ללקוח, כשהוגדר. */
  callerId?: string;
  /** כמה שניות להמתין לתשובה עם מזהה שיחה. */
  waitSeconds?: number;
}): string {
  /*
   * בנייה ידנית ולא `URLSearchParams`: החבילה הזו רצה גם בדפדפן וגם
   * בשרת, והיא מוגדרת מול `lib: ES2023` בלבד — בלי DOM ובלי Node.
   * הרחבת ה-lib בשביל שורה אחת הייתה פותחת את כל ה-API של הדפדפן
   * לקוד שאמור להישאר ניטרלי.
   */
  const params: [string, string][] = [
    ["auth_username", input.authUsername],
    ["auth_password", input.authPassword],
    // "phone" = קו טלפון ולא מספר חיצוני; זו הצורה של שלוחת הסוכן
    ["stype", "phone"],
    ["snumber", input.agentLine],
    /*
     * ‎`ctype` ריק = **מספר חיצוני**, ולא קו במרכזייה.
     *
     * התיעוד מסמן אותו כ"מומלץ" ואנחנו השמטנו אותו לגמרי. ברירת
     * המחדל של הספק אינה מובטחת, ואם היא תיפול ל"קו" — היעד היה
     * מתפרש כשלוחה פנימית, כלומר חיוג ללקוח שמצלצל לשום מקום.
     * שליחה מפורשת עולה כלום ומסירה את ההימור (מול התיעוד).
     */
    ["ctype", ""],
    ["cnumber", input.destination],
    ["wait", String(input.waitSeconds ?? 5)],
    // מזהה המתקשר על הרגל **השנייה** — זה מה שהלקוח רואה
    ...(input.callerId ? ([["callerid2", input.callerId]] as [string, string][]) : []),
  ];
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${PBX015_MAKE_URL}?${query}`;
}

/**
 * פענוח התשובה של 015.
 *
 * 200 = התקבל עם מזהה שיחה, 204 = התקבל בלי. **שניהם הצלחה** —
 * קריאה שמתייחסת ל-204 ככשל הייתה מציגה שגיאה על שיחה שכבר מצלצלת
 * אצל הסוכן.
 */
export function parse015DialResponse(
  body: unknown,
): { ok: boolean; callId?: string; message: string } {
  const root = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const responses = Array.isArray(root["responses"]) ? root["responses"] : [];
  const first =
    typeof responses[0] === "object" && responses[0] !== null
      ? (responses[0] as Record<string, unknown>)
      : {};
  const code = String(first["code"] ?? "");
  const message = typeof first["message"] === "string" ? first["message"] : "";
  const data =
    typeof root["data"] === "object" && root["data"] !== null
      ? (root["data"] as Record<string, unknown>)
      : {};
  const callId = typeof data["callid"] === "string" ? data["callid"] : undefined;

  if (code === "200" || code === "204") {
    return { ok: true, ...(callId ? { callId } : {}), message: message || "השיחה יוצאת" };
  }
  return { ok: false, message: DIAL_ERRORS[code] ?? message ?? `שגיאה מ-015 (${code})` };
}

/** תרגום קודי השגיאה של 015 למה שהמתווך צריך לעשות. */
const DIAL_ERRORS: Record<string, string> = {
  "400": "פרטי החיוג שגויים — בדקו את הקו של הסוכן ואת מספר הלקוח",
  "401": "שם המשתמש או הסיסמה של 015 שגויים",
  "402": "למשתמש ב-015 אין הרשאה לחייג",
  "403": "חבילת ה-015 אינה מאפשרת את החיוג הזה",
};
