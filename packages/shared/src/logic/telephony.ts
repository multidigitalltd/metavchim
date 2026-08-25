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

/**
 * שני ספקים, ושניהם ממומשים.
 *
 * הרשימה כללה גם Zadarma ו-Voicenter. שניהם היו **שם בלבד**: אף שורת
 * קוד לא קראה את הטוקן או את מפתח ה-API שלהם, וקליטת השיחות ממילא
 * אינה תלוית ספק — `parseTelephonyEvent` מחפש שמות שדות מקובלים ולא
 * מתאימה את עצמה לספק. כלומר מי שבחר בהם קיבל בדיוק את „מרכזייה
 * כללית”, אחרי שמסר לנו אישורי גישה שנשמרו מוצפנים ולא שימשו לדבר.
 *
 * ספק חוזר לרשימה כשיש לו קוד, לא כשיש לו שם.
 */
export type TelephonyProviderId = "generic" | "015";

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
     * סימונו
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
    label: "015",
    fields: [
      { key: "authUsername", label: "שם משתמש ב-015", secret: false },
      { key: "authPassword", label: "סיסמה ב-015", secret: true },
      /*
       * **קבוצת ההקלטות — של המשרד, ולא של המערכת.**
       *
       * ‎`recordings/list` דורש `recordgroup` או `customer` (תיעוד
       * 015), והמשיכה הבודדת דורשת `recordgroup` תמיד. עד עכשיו הוא
       * נגזר מהסֶגמנט הראשון בנתיב שהוובהוק שולח — ניחוש שהתברר
       * כשגוי: בנתיב `54936/12048/…` הקבוצה היא **השני**, ולכל משרד
       * מספר אחר.
       *
       * לכן הוא שדה ולא נגזרת. כשהוא ריק, הנתיב עדיין משמש כנפילה
       * לאחור — כדי שמשרד שלא מילא אותו לא יאבד את מה שכבר עבד.
       */
      {
        key: "recordGroup",
        label: "מספר קבוצת ההקלטות ב-015 (recordgroup)",
        secret: false,
      },
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
 * - **החלפת ספק מנקה** — סוד של ספק אחד לא נגרר לחיבור של ספק אחר.
 *   הוא חסר משמעות שם, ובעיקר: אין סיבה שיישאר מוצפן בבסיס הנתונים
 *   אחרי שהמשרד עזב את הספק.
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
  /**
   * שם המתקשר כפי שהמרכזייה מציגה אותו.
   *
   * 015 שולח `callername` בכל אירוע. עד כה הוא נבלע, ולכן ליד
   * שנפתח משיחה ממספר לא מוכר קיבל את **מספר הטלפון כשם** — כרטיס
   * שאי אפשר לחפש לפיו. כשיש שם אמיתי הוא עדיף.
   *
   * זהו פרט מזהה של אדם ולכן הוא מוצפן בשמירה, כמו כל שם.
   */
  callerName?: string;
  /**
   * מועד תחילת השיחה כפי שהמרכזייה מדווחת — **לא** מועד הוובהוק.
   *
   * 015 שולח שלושה אירועים לכל שיחה (`Calling` ⟵ `Answer` ⟵
   * `Hangup`) שמתפרסים על פני עשרות שניות, ובנוסף שולח שוב בניסיון
   * חוזר. `new Date()` היה רושם את מועד ה**הודעה האחרונה שהתקבלה**,
   * כלומר שיחה שקרתה ב-8:46:16 נרשמה ב-8:46:59 — ובניסיון חוזר
   * שעה אחר כך, בשעה אחרת לגמרי.
   */
  startedAt?: Date;
  /**
   * נתיב ההקלטה **אצל הספק** — לא מפתח באחסון שלנו.
   *
   * הערך מ-015 נראה כך:
   * `54936/12048/2026/08/20/record_17872047751258756_23747`
   *
   * הוא **אינו** נשמר ב-`recordingKey`, שהוא מפתח S3 שלנו. ההפרדה
   * אינה סגנונית: מסלולי מחיקת המידע סורקים את `recordingKey`
   * ומוחקים את האובייקטים המתאימים מה-S3. נתיב של ספק חיצוני שם
   * היה גורם למחיקה „להצליח” על אובייקט שאינו קיים — כלומר המערכת
   * הייתה מדווחת שההקלטה נמחקה בזמן שהאודיו עדיין יושב אצל 015.
   */
  providerRecordingPath?: string;
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
const CALLER_NAME_KEYS = ["callername", "caller_name", "callerName", "name"] as const;
/** ‎`start` של 015 הוא epoch בשניות; השאר הם שמות מקובלים אחרים. */
const START_KEYS = ["start", "start_time", "starttime", "timestamp"] as const;
const RECORDING_KEYS = ["recording", "record", "recording_url", "recordingfile"] as const;

/**
 * כל שם שדה שהמערכת יודעת לצרוך — האיחוד של כל הרשימות.
 *
 * נגזר מהן ולא נכתב מחדש: רשימה שנייה הייתה מסתדרת מהראשונה ביום
 * שמישהו מוסיף שם, ואז `unmappedFields` היה מדווח על שדה שדווקא
 * כן נקלט — כלומר שולח לתקן משהו שעובד.
 */
const KNOWN_KEYS = new Set<string>([
  ...CALL_ID_KEYS,
  ...DIRECTION_KEYS,
  ...SOURCE_KEYS,
  ...DESTINATION_KEYS,
  ...STATUS_KEYS,
  ...DURATION_KEYS,
  ...EXTENSION_KEYS,
  ...CALLER_NAME_KEYS,
  ...START_KEYS,
  ...RECORDING_KEYS,
]);

/**
 * מה שהספק שלח **ואנחנו מתעלמים ממנו**.
 *
 * ## למה זו השאלה הנכונה
 *
 * יומן שמראה "אילו שדות הגיעו" עונה על חצי שאלה. החצי שחסר הוא
 * מה מתוכם *נבלע* — כלומר איפה בדיוק יושב המידע שאנחנו לא
 * מנצלים. בלי זה, הוספת שם חדש לרשימה היא ניחוש: מסתכלים על
 * שלושה-עשר שמות ומנסים לזהות מי מהם עשוי להיות "מספר המתקשר".
 *
 * זו גם ההגנה מפני הכשל ההפוך: שדה שנראה חשוב, שמישהו מבזבז עליו
 * זמן — בזמן שהוא כבר נקלט תחת שם אחר.
 *
 * ## למה זה עדיף על מסך מיפוי
 *
 * מסך מיפוי מבקש ממנהל המשרד לענות על שאלה שדורשת לקרוא payload
 * גולמי, ומאפשר לו לשבור את הקליטה של עצמו. הרשימה הזו רק
 * **מראה**, וההכרעה נשארת אצל מי שיודע — בעל הפלטפורמה או מי
 * שכותב את הקוד.
 *
 * ‎`website` ו-honeypots דומים אינם מסוננים כאן במכוון: הם באמת
 * שדות שאנחנו מתעלמים מהם, וזה בדיוק מה שהרשימה אומרת.
 */
export function unmappedFields(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(raw)) {
    if (KNOWN_KEYS.has(key)) continue;
    if (!SAFE_KEY.test(key)) {
      out.push("‹שדה לא תקני›");
      continue;
    }
    const value = raw[key];
    // שדה ריק אינו מידע שהוחמץ — הספק שלח אותו ריק
    if (value === null || value === undefined || String(value).trim() === "") continue;
    out.push(key);
  }
  return [...new Set(out)];
}

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

/** מה שנכתב על שדה טכני שהגיע ריק — ראו `diagnosticFields`. */
export const EMPTY_FIELD_MARK = "‹ריק›";

/**
 * שמות השדות, ולשדות הטכניים גם הערך.
 *
 * `key=value` למה שבטוח, `key` בלבד לכל השאר — כך שורה אחת ביומן
 * עונה גם על "מה הגיע" וגם על "איך זה נראה", בלי להכניס פרטי לקוח
 * לעמודה שנקראת בעיניים.
 *
 * ## למה שדה ריק מסומן במפורש
 *
 * קודם שדה טכני שהגיע **ריק** נכתב כשמו בלבד — בדיוק כמו שדה מזהה
 * שהערך שלו מוסתר בכוונה. שתי סיבות הפוכות, מראה זהה: „‎direction‎”
 * ביומן יכול היה להיות „הספק שלח כיוון ואנחנו לא מציגים אותו” או
 * „הספק שלח שדה ריק”. הראשון תקין, השני הוא התקלה.
 *
 * זה לא תיאורטי: מרכזיית 015 שולחת תבנית עם placeholders, וכשאחד
 * מהם אינו נתמך היא שולחת את השדה ריק. בלי ההבחנה הזו אי אפשר היה
 * לדעת מהיומן אם המספר הגיע — וזו השאלה היחידה שחשובה כשאין שיחה.
 *
 * ## למה הריקנות נבדקת **לפני** ההסתרה
 *
 * הסדר הזה הוא כל העניין. השדה שמכריע `no_phone` הוא
 * `callerid_external` — שדה מזהה, כלומר כזה שערכו לעולם אינו מוצג.
 * אילו ההסתרה קדמה, דווקא השדה החשוב ביותר לאבחון לא היה יכול
 * להיות מסומן כריק, והמסך היה מבטיח סימון שאינו מגיע (ביקורת
 * Codex).
 *
 * „ריק” אינו ערך של לקוח, ולכן סימונו אינו חושף דבר: הוא אומר
 * שאין מה לחשוף.
 */
export function diagnosticFields(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(raw).slice(0, MAX_DIAGNOSTIC_KEYS)) {
    if (!SAFE_KEY.test(key)) {
      parts.push("‹שדה לא תקני›");
      continue;
    }
    const value = raw[key];
    /*
     * כל מה שאינו טקסט או מספר נחשב ריק — אובייקט מקונן יכול
     * להכיל פרט מזהה, וקריאתו אינה שווה את הסיכון.
     *
     * ו-`trim`, כי `pickFrom` מתעלם ממחרוזת של רווחים בלבד ורואה
     * בה שדה חסר. בלי אותה נורמליזציה כאן, placeholder שהספק מילא
     * ברווח היה מוצג כ-`direction=   ` — כלומר „יש ערך” — בזמן
     * שהניתוח מתייחס אליו כריק. שתי קריאות של אותו payload חייבות
     * להסכים (ביקורת Codex).
     */
    const asText =
      typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    if (asText === "") {
      parts.push(`${key}=${EMPTY_FIELD_MARK}`);
      continue;
    }
    // יש ערך: לשדה טכני מציגים אותו, לשדה מזהה — השם בלבד
    parts.push(
      VALUE_SAFE_KEYS.has(key) ? `${key}=${asText.slice(0, MAX_VALUE_LENGTH)}` : key,
    );
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
    callerName: callerNameOf(pick(...CALLER_NAME_KEYS)),
    startedAt: startedAtOf(pick(...START_KEYS)),
    providerRecordingPath: recordingPathOf(pick(...RECORDING_KEYS)),
  };
}

/**
 * שם המתקשר, או `undefined` כשאין בו מידע.
 *
 * מרכזיות שולחות את **המספר** בשדה השם כשאין להן שם, וגם מחרוזות
 * שמסמנות חוסר. שמירתן הייתה מייצרת בדיוק את הכרטיס שאי אפשר
 * לחפש שהשדה הזה בא לפתור.
 */
function callerNameOf(raw: string): string | undefined {
  const name = raw.trim();
  if (name === "") return undefined;
  if (/^[+\d\s()-]+$/u.test(name)) return undefined; // מספר, לא שם
  if (/^(unknown|anonymous|private|restricted|לא ידוע|חסוי)$/iu.test(name)) return undefined;
  return name.slice(0, 120);
}

/**
 * ‎epoch בשניות ⟵ תאריך. `undefined` על כל ערך שאינו מועד סביר.
 *
 * הסבירות נבדקת ולא רק הפריקות: ‎`Number("0")`‎ הוא מספר תקין
 * לחלוטין שמתורגם ל-1970, ושמירתו הייתה מציגה שיחה שקרתה לפני
 * חמישים שנה במקום ליפול חזרה לשעת הקליטה. מיליסקנדות מזוהות
 * לפי סדר הגודל — יש מרכזיות ששולחות כך.
 */
function startedAtOf(raw: string): Date | undefined {
  if (raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const ms = value > 1e11 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  return year >= 2020 && year <= 2100 ? date : undefined;
}

/** נתיב ההקלטה אצל הספק, מקוצץ לאורך שהעמודה מחזיקה. */
function recordingPathOf(raw: string): string | undefined {
  const path = raw.trim();
  return path === "" ? undefined : path.slice(0, 300);
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
export function callAction(
  event: TelephonyEvent,
  knownContact: boolean,
  answerObserved: boolean,
): CallAction {
  return {
    logCall: callIsFinal(event),
    notify: event.type === "ringing" && event.direction === "inbound",
    createLead: event.type === "ended" && callSpoke(event, answerObserved) && !knownContact,
  };
}

/**
 * האם האירוע **מסיים** שיחה — כלומר האם הוא זה שכותב שורה.
 *
 * מיוצא כדי שמי שצריך רק את התשובה הזו (האבחון, למשל) לא יקרא
 * ל-`callAction` עם ארגומנטים מומצאים כדי לשלוף שדה אחד. ניסיון קודם
 * לכתוב את הרשימה מחדש במקום הקריאה מנה `ringing` בלבד ופספס את
 * `answered` (ביקורת Codex) — ולכן `callAction` עצמה קוראת לפונקציה
 * הזו, ושתי התשובות אינן יכולות להיפרד.
 */
export function callIsFinal(event: TelephonyEvent): boolean {
  return event.type === "ended" || event.type === "missed";
}

/**
 * ‎**הראיה שמישהו דיבר** — משך חיובי, או אירוע מענה שנצפה קודם.
 *
 * ‎„נענתה” היא ראיה ולא היעדר ראיה לכך שלא נענתה: אירוע ניתוק שהגיע
 * בלי משך מסווג `ended` מבלי שנאמר דבר על מענה, ורישומו כ„נענתה”
 * הוא מה שהציג בשטח „על כל השיחות כתוב נענתה”.
 *
 * ‎**אבל המשך אינו הראיה היחידה.** 015 שולחת `Calling` ⟵ `Answer` ⟵
 * `Hangup`, ואירוע ה-`Answer` הוא אמירה מפורשת של המרכזייה שהשיחה
 * נענתה. כשהניתוק מגיע בלי `talktime`, הסתמכות על המשך לבדו הופכת
 * שיחה שהמרכזייה **אמרה** עליה שנענתה ל„לא ידוע” — ומונעת פתיחת ליד
 * ממספר לא מוכר שדיברנו איתו בפועל (ביקורת Codex). הראיה קיימת,
 * ופשוט נזרקה באירוע קודם.
 *
 * ‎**„לא נענתה” גובר על שניהם.** ניתוק עם `talktime = 0` הוא אמירה
 * מפורשת שלא היה דיבור, והוא מאוחר יותר מה-`Answer`; מרכזייה יכולה
 * לצלצל, לענות במענה קולי ולנתק בלי שאיש דיבר.
 *
 * ‎`answerObserved` מגיע מהקורא ואינו נגזר מהאירוע, כי הוא **עובדה
 * על שיחה ולא על אירוע**: מי שמחזיק אותה הוא מי ששמר את האירוע
 * הקודם.
 */
export function callSpoke(event: TelephonyEvent, answerObserved: boolean): boolean {
  if (event.type === "missed") return false;
  return answerObserved || (event.durationSeconds !== undefined && event.durationSeconds > 0);
}

/* ==================== משיכת הקלטות — עצירת הסבב ==================== */

/**
 * תוצאת ניסיון משיכה בודד של הקלטה מהספק.
 *
 * שלוש ולא שתיים, וזו כל הנקודה: „הצליח”, „הספק סירב”, ו**„נכשל
 * אצלנו”** — נתיב פגום, אישורי גישה חסרים, תשובה בלתי קריאה, תקלת
 * רשת מקומית. השלישי אינו אומר דבר על הספק.
 */
export type RecordingPullResult = "stored" | "refused" | "other";

/**
 * מונה הסירובים הרצופים אחרי תוצאה אחת — **שלוש תוצאות, שלוש
 * התנהגויות.**
 *
 * הסבב נעצר אחרי כמה סירובים רצופים כדי שחנק מצד הספק לא יזין את
 * עצמו. השאלה היחידה כאן היא מה עושה כל תוצאה למונה:
 *
 * | תוצאה | מה זה מוכיח | המונה |
 * |---|---|---|
 * | `refused` | הספק אמר „לא” | ‎+1 |
 * | `stored` | הספק ענה, והוא בסדר | ‎0 |
 * | `other` | **כלום** — נכשלנו לפני שהספק ענה | ללא שינוי |
 *
 * ‎**`other` אינו מאפס**, וזה התיקון. הקוד איפס על כל מה שאינו
 * סירוב, וההערה שמעליו כתבה „כל **הצלחה** מאפסת” — כלומר ההערה
 * תיארה כלל מחמיר מזה שהקוד הריץ. התוצאה: שני סירובים, כישלון
 * מקומי אחד באמצע, והמונה חוזר לאפס בלי ששום בקשה מוצלחת הוכיחה
 * שהספק התאושש. כשלים מקומיים מפוזרים היו מבטלים את העצירה לגמרי
 * בדיוק בזמן חנק (ביקורת Codex).
 *
 * ‎`other` גם אינו **מגדיל** — תקלת רשת אצלנו אינה „לא” של הספק,
 * ועצירת הסבב בגללה הייתה מאטה את המשיכה בלי שיש חנק כלל.
 *
 * הפונקציה יושבת כאן ולא בשירות כדי שהכלל יהיה **נבדק**: בשירות
 * הוא שורה אחת שאפשר להפוך בלי שאף בדיקה תרגיש, וזה בדיוק מה
 * שקרה פעמיים.
 */
export function nextRefusalStreak(streak: number, result: RecordingPullResult): number {
  if (result === "refused") return streak + 1;
  if (result === "stored") return 0;
  return streak;
}

/** תוצאת השיחה כפי שהיא נרשמת ומוצגת. ראו `CALL_OUTCOME_LABELS`. */
export type CallOutcome = "answered" | "missed" | "unknown";

/**
 * התוצאה שנרשמת לשורת השיחה — **מאותה ראיה** שפותחת ליד.
 *
 * הפונקציה קיימת כדי ששני הדברים לא ייפרדו: קודם הביטוי היה כתוב
 * ידנית בשירות, ו-`callAction` החזיקה עותק משלו של „דיבר”. שתי
 * הגדרות של אותה עובדה נוטות להסכים ביום שנכתבו ולא אחריו.
 */
export function callOutcomeOf(event: TelephonyEvent, answerObserved: boolean): CallOutcome {
  if (event.type === "missed") return "missed";
  return callSpoke(event, answerObserved) ? "answered" : "unknown";
}

/** כותרת ההתראה שהמתווך רואה כשהטלפון מצלצל. */
export function incomingCallTitle(contactName: string | null, phone: string): string {
  return contactName ? `📞 ${contactName} מתקשר` : `📞 שיחה נכנסת מ-${phone}`;
}

/**
 * כותרת ההתראה על שיחה נכנסת שלא נענתה.
 *
 * המספר מופיע גם כשהלקוח מוכר: מי שקורא את ההתראה בטלפון רוצה לחזור
 * אליו עכשיו, וחיפוש הכרטיס כדי למצוא מספר הוא בדיוק החיכוך שההתראה
 * באה לחסוך.
 */
export function missedCallTitle(contactName: string | null, phone: string): string {
  return contactName
    ? `📵 ${contactName} התקשר ולא נענה — ${phone}`
    : `📵 שיחה שלא נענתה מ-${phone}`;
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
  const root = asRecord(body);
  const status = parse015Status(body);
  const code = status?.code ?? "";
  const message = status?.message ?? "";
  const data = asRecord(root["data"]);
  const callId = typeof data["callid"] === "string" ? data["callid"] : undefined;

  if (code === "200" || code === "204") {
    return { ok: true, ...(callId ? { callId } : {}), message: message || "השיחה יוצאת" };
  }
  return { ok: false, message: DIAL_ERRORS[code] ?? message ?? `שגיאה מ-015 (${code})` };
}

/** אובייקט, או אובייקט ריק — במקום לחזור על הבדיקה בכל פענוח. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** מה ש-015 אומרת **על הבקשה עצמה**, בנפרד ממה שהיא מחזירה. */
export interface Pbx015Status {
  /** קוד בסגנון HTTP — אך בגוף התשובה, כשהסטטוס עצמו 200. */
  code: string;
  /** הודעת הספק. אינה מוצגת כמו שהיא — היא עלולה לשאת פרטי בקשה. */
  message: string;
}

/**
 * מעטפת ה-JSON של 015 — **`responses`, בכל נתיבי ה-API שלה.**
 *
 * הספק מחזיר 200 כמעט תמיד, ומה שקרה באמת יושב במעטפת: אישורים
 * שגויים, חבילה בלי הרשאה, הקלטה שנמחקה. `parse015DialResponse`
 * הכירה את המעטפת מהיום הראשון; נתיבי ההקלטות נכתבו כאילו התוכן
 * יושב בשורש או תחת `data` — ולכן תשובה תקינה לחלוטין נראתה להם
 * כ„לא נקראה”, בלי דרך לדעת מה הספק אמר (דיווח מהשטח).
 *
 * הצורה אינה אחידה בין הנתיבים: לפעמים מערך של תשובה אחת ולפעמים
 * אובייקט יחיד. שתיהן מתקבלות כאן, כי ההבדל אינו מעניין אף קורא.
 */
export function parse015Status(body: unknown): Pbx015Status | null {
  const raw = asRecord(body)["responses"];
  const scope = asRecord(Array.isArray(raw) ? raw[0] : raw);
  const code = scope["code"];
  const text =
    typeof code === "string" ? code.trim() : typeof code === "number" ? String(code) : "";
  if (text === "") return null;
  return { code: text, message: typeof scope["message"] === "string" ? scope["message"] : "" };
}

/** תרגום קודי השגיאה של 015 למה שהמתווך צריך לעשות. */
const DIAL_ERRORS: Record<string, string> = {
  "400": "פרטי החיוג שגויים — בדקו את הקו של הסוכן ואת מספר הלקוח",
  "401": "שם המשתמש או הסיסמה של 015 שגויים",
  "402": "למשתמש ב-015 אין הרשאה לחייג",
  "403": "חבילת ה-015 אינה מאפשרת את החיוג הזה",
};

/* ==================== משיכת הקלטות — 015 ==================== */

/**
 * ‎`recording/recordings/get` של 015 — משיכת קובץ ההקלטה.
 *
 * ## למה בכלל מושכים ולא רק שומרים מצביע
 *
 * שתי סיבות, ושתיהן אינן נוחות. **תמלול** — צינור התמלול שלנו קורא
 * קובץ מהאחסון שלנו, ובלי האודיו אין מה לתמלל. **ראיה** — הקלטה
 * שיושבת אצל הספק תלויה בשימור שלו, במנוי פעיל ובמדיניות מחיקה
 * שאיננו שולטים בה; מתווך שצריך להוכיח מה נאמר בשיחה לא יכול לגלות
 * בדיעבד שהיא נמחקה.
 *
 * ## פענוח הנתיב מהוובהוק
 *
 * ה-Webhook שולח `recording` כנתיב:
 * `54936/12048/2026/08/20/record_17872047751258756_23747`
 *
 * ה-API מבקש שלושה פרמטרים נפרדים, ושניים מהם יושבים בנתיב:
 * הקטע הראשון הוא `recordgroup`, והמספר שאחרי הקו התחתון האחרון
 * הוא `recordid`.
 *
 * **`uniqueid` נלקח מהשדה שלו ולא מהנתיב.** בשם הקובץ הוא מופיע
 * כ-`17872047751258756` — הספרות של `1787204775.1258756` בלי הנקודה
 * — ואי אפשר לדעת לאן הנקודה חוזרת. הוובהוק שולח את `uniqueid`
 * במפורש, וזו התשובה ולא ניחוש.
 */
export const PBX015_RECORDING_URL =
  "https://www.015pbx.net/api/json/recording/recordings/get/";

/** שני המזהים שיושבים בנתיב ההקלטה, או null כשהצורה אינה מוכרת. */
export function split015RecordingPath(
  path: string,
): { recordGroup: string; recordId: string } | null {
  const segments = path.split("/").filter((part) => part !== "");
  if (segments.length < 2) return null;
  const recordGroup = segments[0]!;
  const file = segments[segments.length - 1]!;
  const recordId = file.slice(file.lastIndexOf("_") + 1);
  if (!/^\d+$/u.test(recordGroup) || recordId === "" || !/^\d+$/u.test(recordId)) return null;
  return { recordGroup, recordId };
}

/**
 * מועמדים ל-`recordgroup` — **בנתיב יש יותר ממספר אחד.**
 *
 * ## למה זה קיים
 *
 * הנתיב שהוובהוק שולח פותח בשני מספרים:
 * ‎`54936/12048/2026/08/20/record_…`. הקוד לקח תמיד את הראשון,
 * וההנחה הזו לא נבדקה מעולם מול הספק — עד שהתקבלה תשובה מפורשת
 * „לא נמצא” על הקלטה שקיימת בממשק של 015 (דיווח מהשטח). כשהמספר
 * הלא נכון נשלח, התשובה זהה לחלוטין לתשובה על הקלטה שנמחקה, ואין
 * דרך להבחין ביניהן מבחוץ.
 *
 * ## למה רשימה ולא ניחוש מתוקן
 *
 * להחליף „הראשון” ב„השני” זה להחליף הנחה בהנחה. שני המספרים
 * נשלחים — הראשון ואז השני — והתשובה של הספק היא שמכריעה. ניסיון
 * שני על בקשת קריאה זולה בהרבה מהקלטה שאובדת בשקט.
 *
 * ## מה נחשב מספר קבוצה
 *
 * רק קטעי פתיחה של ספרות בלבד, ועד לקטע שנראה כמו שנה — משם
 * מתחיל התאריך. נתיב שנבנה אצלנו מרשימת הייבוא נושא מספר אחד
 * בלבד, ומקבל מועמד יחיד.
 */
export function pbx015RecordingGroups(path: string): string[] {
  const groups: string[] = [];
  for (const segment of path.split("/")) {
    if (!/^\d+$/u.test(segment)) break;
    // ארבע ספרות בטווח שנים = תחילת התאריך, לא מספר קבוצה
    if (/^(19|20)\d{2}$/u.test(segment)) break;
    groups.push(segment);
    if (groups.length === 2) break;
  }
  return groups;
}

/**
 * שתי הצורות של `uniqueid` — **כי אין דרך לדעת איזו נכונה.**
 *
 * ## מה נשלל
 *
 * הוובהוק שולח `uniqueid` כ-`1787204775.1258756`, ובשם הקובץ הוא
 * מופיע בלי הנקודה. שלחנו את הצורה עם הנקודה, בהיגיון שהשדה עדיף
 * על שחזור מהנתיב — והתקבל 404 עקבי גם אחרי שקבוצת ההקלטות נבדקה
 * מול הספק **בשני** ערכיה (דיווח מהשטח: `recordgroup=12048|54936`).
 *
 * כלומר הקבוצה אינה החשוד, ו-`uniqueid` כן. הדוגמה בתיעוד של 015
 * היא ספרות בלבד (`1234567890`), בלי נקודה.
 *
 * ## למה שתיהן ולא „הנכונה”
 *
 * להחליף „עם נקודה” ב„בלי נקודה” זה להחליף הנחה בהנחה, וכבר עברנו
 * את זה עם הקבוצה. שתיהן נשלחות והספק מכריע — בדיוק אותו דפוס,
 * מאותו נימוק: תשובת 404 על מזהה שגוי זהה לחלוטין לתשובה על הקלטה
 * שנמחקה, ואין דרך להבחין ביניהן מבחוץ.
 *
 * הצורה שהוובהוק שלח נשארת ראשונה: היא מגיעה מהספק עצמו.
 */
export function pbx015UniqueIdForms(uniqueId: string): string[] {
  const digitsOnly = uniqueId.replace(/\D/gu, "");
  if (digitsOnly === "" || digitsOnly === uniqueId) return [uniqueId];
  return [uniqueId, digitsOnly];
}

export function build015RecordingUrl(input: {
  authUsername: string;
  authPassword: string;
  recordGroup: string;
  /** מזהה השיחה **כפי שהוובהוק שלח** — לא כפי שהוא מופיע בשם הקובץ. */
  uniqueId: string;
  recordId: string;
}): string {
  /*
   * ‎`&`‎ ולא ‎`;`‎ שבתיעוד: אותו API מקבל את `calls/make` שלנו עם
   * ‎`&`‎ ועובד בפרודקשן. עקביות עם מה שנבדק עדיפה על נאמנות לדוגמה
   * בתיעוד.
   */
  const query = ([
    ["auth_username", input.authUsername],
    ["auth_password", input.authPassword],
    ["recordgroup", input.recordGroup],
    ["uniqueid", input.uniqueId],
    ["recordid", input.recordId],
  ] as [string, string][])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${PBX015_RECORDING_URL}?${query}`;
}

/** גבול גודל לקובץ הקלטה — הגנה מפני תשובה חריגה, לא מדיניות. */
export const MAX_RECORDING_BYTES = 40 * 1024 * 1024;

/**
 * התשובה של 015 ⟵ בתים.
 *
 * הקובץ מגיע base64 **בתוך ה-JSON**, ולכן אין כאן הורדה בזרימה: כל
 * הקובץ נמצא בזיכרון ממילא. `MAX_RECORDING_BYTES` הוא הגבול שמונע
 * מתשובה חריגה להפיל את התהליך.
 *
 * שם השדה אינו מובטח בתיעוד, ולכן נבדקים כמה שמות מקובלים — עם
 * אותו היגיון של `parseTelephonyEvent`: לחפש בשמות המקובלים במקום
 * לקבע אחד ולהישבר בשקט.
 */
export function parse015RecordingResponse(
  body: unknown,
): { base64: string; contentType: string } | null {
  for (const scope of pbx015Scopes(body)) {
    for (const key of ["sound", "soundfile", "sound_file", "file", "recording", "data"]) {
      const value = scope[key];
      if (typeof value === "string" && value.length > 0) {
        return { base64: value, contentType: contentTypeOf(scope) };
      }
    }
  }
  return null;
}

/**
 * המקומות שבהם 015 מניחה תוכן — **בסדר של הסבירות.**
 *
 * שם השדה אינו מובטח בתיעוד, וגם לא **היכן** הוא יושב: בשורש, תחת
 * ‎`data`, או בתוך מעטפת `responses` (ואז לעיתים תחת `data` שבתוכה).
 * חיפוש בשורש בלבד היה מחמיץ תשובה תקינה שהגיעה במעטפת.
 */
function pbx015Scopes(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  const raw = root["responses"];
  const envelope = asRecord(Array.isArray(raw) ? raw[0] : raw);
  return [root, asRecord(root["data"]), envelope, asRecord(envelope["data"])].filter(
    (scope) => Object.keys(scope).length > 0,
  );
}

/**
 * סוג הקובץ לפי מה שהספק אמר, וברירת מחדל ל-WAV.
 *
 * מרכזיות מקליטות ב-WAV כברירת מחדל, ו-`audio/wav` הוא הניחוש
 * הבטוח: דפדפן שמקבל סוג שגוי פשוט לא מנגן, בלי שגיאה שאפשר לפעול
 * לפיה.
 */
function contentTypeOf(data: Record<string, unknown>): string {
  const format = String(data["format"] ?? data["filetype"] ?? "").toLowerCase();
  if (format.includes("mp3")) return "audio/mpeg";
  if (format.includes("ogg")) return "audio/ogg";
  if (format.includes("gsm")) return "audio/gsm";
  return "audio/wav";
}

/* ============================================================
   ייבוא הקלטות שקדמו לחיבור
   ============================================================ */

/**
 * רשימת ההקלטות אצל הספק — **המסלול היחיד להקלטות ישנות.**
 *
 * הוובהוק מספר לנו על הקלטה בזמן שהיא נוצרת, ולכן הוא מכסה רק את
 * מה שקרה **אחרי** שהמשרד חיבר את המרכזייה. כל מה שהוקלט לפני כן
 * יושב אצל הספק בלי שנדע עליו, וייעלם כשמדיניות השמירה שלו תמחק
 * אותו — כלומר בדיוק הראיה שהמשרד חושב שיש לו.
 *
 * ‎`recordgroup` אינו נשלח: התיעוד אומר שברירת המחדל היא „כל
 * הקבוצות של הלקוח”, וזה מה שאנחנו רוצים — משרד יכול להחזיק כמה
 * קבוצות הקלטה, ואיננו יודעים מראש אילו.
 */
export const PBX015_RECORDINGS_LIST_URL =
  "https://www.015pbx.net/api/json/recording/recordings/list/";

export function build015RecordingsListUrl(input: {
  authUsername: string;
  authPassword: string;
  /**
   * קבוצת ההקלטות — **חובה לפי התיעוד**, לא ברירת מחדל.
   *
   * התיעוד של `recordings/list` אומר `recordgroup` או `customer`:
   * „Yes, unless the other is specified”. הבקשה שלנו לא שלחה אף
   * אחד מהם, עם הערה בקוד שהניחה שברירת המחדל היא „כל הקבוצות של
   * הלקוח”. ההנחה הזו לא נבדקה מול התיעוד, וכנראה שהייבוא לא עבד
   * מעולם — בלי הודעה, כי רשימה ריקה נראית כמו „אין הקלטות”.
   */
  recordGroup: string;
  /** שניות, לא מילישניות — כמו בכל שאר ה-API של 015. */
  fromEpochSeconds: number;
  toEpochSeconds: number;
}): string {
  const query = (
    [
      ["auth_username", input.authUsername],
      ["auth_password", input.authPassword],
      ["recordgroup", input.recordGroup],
      ["start", String(Math.floor(input.fromEpochSeconds))],
      ["end", String(Math.floor(input.toEpochSeconds))],
      // הקלטות שהסתיימו בלבד; שיחה שעדיין רצה תיאסף בסבב הבא
      ["complete", "1"],
    ] as [string, string][]
  )
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${PBX015_RECORDINGS_LIST_URL}?${query}`;
}

/** הקלטה אחת ברשימה, אחרי שזוהתה. */
export interface Pbx015RecordingRow {
  /** מזהה השיחה — המפתח שמחבר להקלטה ולשיחה שאצלנו. */
  uniqueId: string;
  /**
   * מזהה הרשומה — **ואינו מובטח.**
   *
   * ‎`recordings/get` דורש אותו, אבל התיעוד אינו מונה אותו בין שדות
   * השורה שהרשימה מחזירה (`uniqueid`, `snumber`, `cnumber`, `start`,
   * ‎`totaltime`, `expires`). דרישה שלו הפילה את השורה — בדיוק אותה
   * תקלה שתוקנה ב-`recordgroup`, ובאותה שורה עצמה (ביקורת Codex).
   *
   * שורה בלעדיו אינה ניתנת למשיכה, אבל היא **קיימת**, וזה בדיוק מה
   * שצריך להיראות: „הספק החזיר ארבעים הקלטות ואין לנו את המזהה
   * להורדה” הוא אבחון, ו„אין הקלטות” הוא מבוי סתום.
   */
  recordId?: string;
  /** קבוצת ההקלטה — הסֶגמנט הראשון בנתיב. */
  recordGroup: string;
}

const LIST_UNIQUE_KEYS = ["uniqueid", "unique_id", "uniqueId", "callid"] as const;
const LIST_RECORD_ID_KEYS = ["recordid", "record_id", "id"] as const;
const LIST_GROUP_KEYS = ["recordgroup", "record_group", "group", "groupid"] as const;

function pick(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function rowsOf(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  /*
   * גם בתוך מעטפת `responses`: אותה מעטפת שנתיב החיוג מכיר, ושהיא
   * הסיבה שרשימה מלאה נראתה כאן ריקה. שורות המעטפת עצמה (`code`,
   * ‎`message`) אינן מזיקות — הן נופלות בבדיקת המזהים.
   */
  const raw = root["responses"];
  /*
   * המעטפת נפתחת גם כשהיא מערך — בדיוק כמו ב-`parse015Status`
   * וב-`pbx015Scopes`. הצורה הנפוצה היא מערך של תשובה אחת, ובתוכה
   * ‎`data` עם השורות; בלי הפתיחה נבחר המערך החיצוני עצמו, השורה
   * היחידה שנבדקה הייתה המעטפת (`code`, `message`), והייבוא דיווח
   * אפס הקלטות על תשובה מלאה (ביקורת Codex).
   */
  const envelope = asRecord(Array.isArray(raw) ? raw[0] : raw);
  /*
   * שדות המעטפת נבדקים **לפני** המעטפת עצמה, כדי שנתיב שמחזיר את
   * השורות ישירות ב-`responses` ימשיך לעבוד: שם אין ב-`responses[0]`
   * לא `data` ולא `recordings`, והבחירה נופלת חזרה על המערך.
   */
  const candidates = [
    root["data"],
    root["recordings"],
    root["rows"],
    envelope["data"],
    envelope["recordings"],
    envelope["rows"],
    raw,
    body,
  ];
  const rows = candidates.find((value) => Array.isArray(value));
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

/**
 * התשובה ⟵ שורות שאפשר לפעול לפיהן.
 *
 * שמות השדות בשורה **אינם מתועדים** — התיעוד אומר רק „מערך שדות
 * התואם לשורות טבלת ההקלטות”. לכן אותה גישה כמו בכל מה שמגיע
 * מהספק: לחפש בשמות המקובלים, ולוותר בשקט על שורה שאין בה את
 * המזהים — במקום לקבע שם אחד ולהישבר ביום שהוא ישתנה.
 *
 * שורה בלי `uniqueid` חסרת ערך לנו בכל מקרה: זה המפתח שמחבר את
 * ההקלטה לשיחה שאצלנו.
 *
 * ## למה הקבוצה **אינה** נדרשת בשורה
 *
 * ‎`recordgroup` הוא פרמטר של ה**בקשה**, ולא שדה שהתיעוד מבטיח
 * בתשובה: השדות שהוא מונה לשורה הם `uniqueid`, `snumber`,
 * ‎`cnumber`, `start`, `totaltime` ו-`expires`. דרישה שהספק יחזיר
 * אותו הפילה **כל** שורה בשקט, והייבוא דיווח „אין הקלטות אצל
 * הספק” על תשובה מלאה — בדיוק הדיווח שהתקבל מהשטח.
 *
 * הקבוצה שביקשנו היא הקבוצה שהשורות שייכות לה; אין מה לגזור.
 * שורה שכן נושאת אותה גוברת, כי ספק שטרח לומר יודע טוב מאיתנו.
 */
export function parse015RecordingsList(
  body: unknown,
  /** הקבוצה שנשלחה בבקשה — התשובה אינה חייבת לחזור עליה */
  requestedGroup?: string,
): Pbx015RecordingRow[] {
  const found: Pbx015RecordingRow[] = [];
  for (const row of rowsOf(body)) {
    const uniqueId = pick(row, LIST_UNIQUE_KEYS);
    const recordGroup = pick(row, LIST_GROUP_KEYS) ?? requestedGroup;
    if (uniqueId === undefined || recordGroup === undefined) continue;
    const recordId = pick(row, LIST_RECORD_ID_KEYS);
    found.push(recordId === undefined ? { uniqueId, recordGroup } : { uniqueId, recordGroup, recordId });
  }
  return found;
}

/**
 * שורות שהגיעו ונשמטו — **הפער בין מה שהספק שלח למה שקראנו.**
 *
 * ‎`parse015RecordingsList` מוותרת בשקט על שורה בלי מזהים, וזו
 * ההתנהגות הנכונה. אבל שקט מלא הופך „שם שדה שאיננו מכירים” ל„אין
 * הקלטות” — שני מצבים שדורשים פעולה הפוכה, ושנראו זהים מבחוץ.
 *
 * המספר הזה הוא מה שמבדיל ביניהם, ואפשר לדווח אותו: הוא ספירה
 * ולא תוכן.
 */
export function dropped015ListRows(body: unknown, requestedGroup?: string): number {
  return rowsOf(body).length - parse015RecordingsList(body, requestedGroup).length;
}

/**
 * שמות השדות שהגיעו ולא זוהו — **לאבחון, בלי הערכים.**
 *
 * אותו עיקרון כמו `lastEventKeys` על אירוע הוובהוק: אם 015 ישנה
 * שם שדה, הייבוא יחזיר אפס שורות ואיש לא יידע למה. הרשימה הזו
 * הופכת את הכשל הזה לניתן לדיווח בלי לכתוב מספרי טלפון ללוג.
 */
export function unmatched015ListKeys(body: unknown): string[] {
  const [first] = rowsOf(body);
  if (first === undefined) return [];
  const known = new Set<string>([...LIST_UNIQUE_KEYS, ...LIST_RECORD_ID_KEYS, ...LIST_GROUP_KEYS]);
  return Object.keys(first).filter((key) => !known.has(key));
}

/**
 * שמות השדות בשורה הראשונה — **כל השמות, לא רק אלה שלא זיהינו.**
 *
 * צורת השורה אינה מתועדת: התיעוד מונה שישה שדות לסינון ולמיון
 * ואומר „מערך שדות התואם לשורות טבלת ההקלטות”. לכן כל ניחוש על
 * שם שדה הוא הימור, ומספיק הימור אחד שגוי כדי שהייבוא יידום.
 *
 * הדרך היחידה לדעת היא **לראות תשובה אמיתית**, ולכן השמות עולים
 * למסך ולא רק ליומן: הרצת ייבוא אחת אצל המשרד עונה על השאלה.
 *
 * שמות שדות אינם מידע אישי; הערכים כן — שורת הקלטה נושאת מספרי
 * טלפון — ולכן הם אינם נכללים.
 */
export function pbx015ListRowKeys(body: unknown): string[] {
  const [first] = rowsOf(body);
  return first === undefined ? [] : Object.keys(first);
}

/** הנתיב שאנחנו שומרים לשיחה — אותה צורה שהוובהוק שולח. */
export function pbx015RecordingPath(row: Pbx015RecordingRow & { recordId: string }): string {
  return `${row.recordGroup}/record_${row.uniqueId.replace(".", "")}_${row.recordId}`;
}
