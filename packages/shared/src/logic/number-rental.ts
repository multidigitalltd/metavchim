/**
 * השכרת מספרים וירטואליים — מחשבון 015 של הפלטפורמה, בחיוב חודשי.
 *
 * המשרד בוחר מספר פנוי מתוך המלאי של הפלטפורמה אצל 015, משלם חודש
 * מראש, והמערכת תופסת את המספר אוטומטית (`numbers/purchase`). מנהלי
 * הפלטפורמה מקבלים הודעה על כל רכישה — הניתוב הסופי אצל הספק הוא
 * עדיין עבודה ידנית.
 *
 * הקובץ הזה לא נוגע ברשת ולא בבסיס נתונים: הוא בונה את כתובות
 * ה-API של 015 ומפענח את תשובותיהן (בדיק בלי רשת, כמו
 * `build015DialUrl`), ומגדיר את חוקי החיוב — חודש הוא היחידה,
 * **וחלק מחודש מחויב כחודש מלא**: אין חישוב יחסי, לא ברכישה ולא
 * בביטול.
 */

/** מצב השכרה. `pending` = דף תשלום נפתח וטרם שולם. */
export type RentedNumberStatus =
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "released";

export const RENTED_NUMBER_STATUSES: readonly RentedNumberStatus[] = [
  "pending",
  "active",
  "past_due",
  "cancelled",
  "released",
];

export function isRentedNumberStatus(value: string): value is RentedNumberStatus {
  return (RENTED_NUMBER_STATUSES as readonly string[]).includes(value);
}

/** תיאור המצב למסך — של המשרד ושל הפלטפורמה. */
export function describeRentalStatus(status: RentedNumberStatus): string {
  switch (status) {
    case "pending":
      return "ממתין לתשלום";
    case "active":
      return "פעיל";
    case "past_due":
      return "החיוב נכשל — נדרש טיפול";
    case "cancelled":
      return "בוטל — פעיל עד סוף התקופה ששולמה";
    case "released":
      return "שוחרר";
  }
}

/*
 * אותו שורש כמו `PBX015_MAKE_URL` של החיוג — `/local/api/json/` הוא
 * הצורה שהאינטגרציה הקיימת עובדת מולה בפרודקשן, ודפי התיעוד עצמם
 * יושבים תחת `/local/guide/`.
 */
export const PBX015_NUMBERS_BASE = "https://www.015pbx.net/local/api/json/numbers/";

export interface Pbx015Auth {
  authUsername: string;
  authPassword: string;
}

/*
 * בנייה ידנית ולא `URLSearchParams` — החבילה מוגדרת מול ES2023 בלי
 * DOM ובלי Node; ראו את אותה הכרעה ב-`build015DialUrl`.
 */
function buildQuery(params: [string, string][]): string {
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

/**
 * ‎`numbers/available/list` — המספרים הפנויים לרכישה.
 *
 * ‎`ingroup` חובה בתיעוד: המלאי מוגדר לפי קבוצת נכנסות בחשבון 015
 * של הפלטפורמה, וזה מה שמנהל הפלטפורמה מגדיר במסך ההגדרות.
 */
export function build015AvailableNumbersUrl(
  auth: Pbx015Auth,
  input: { ingroup: string; count?: number },
): string {
  return `${PBX015_NUMBERS_BASE}available/list/?${buildQuery([
    ["auth_username", auth.authUsername],
    ["auth_password", auth.authPassword],
    ["ingroup", input.ingroup],
    ["count", String(input.count ?? 10)],
  ])}`;
}

/**
 * ‎`numbers/available/get` — האם המספר עדיין פנוי, רגע לפני התשלום.
 *
 * ‏200 = פנוי; 400 = כבר בשימוש; 404 = לא קיים. הבדיקה גם בפתיחת
 * התשלום וגם ברגע התפיסה — בין השניים עוברות דקות, ומספר יכול
 * להילקח בינתיים.
 */
export function build015NumberAvailableUrl(auth: Pbx015Auth, number: string): string {
  return `${PBX015_NUMBERS_BASE}available/get/?${buildQuery([
    ["auth_username", auth.authUsername],
    ["auth_password", auth.authPassword],
    ["number", number],
  ])}`;
}

/** ‎`numbers/purchase` — תפיסת המספר לחשבון הפלטפורמה. */
export function build015PurchaseUrl(auth: Pbx015Auth, number: string): string {
  return `${PBX015_NUMBERS_BASE}purchase/?${buildQuery([
    ["auth_username", auth.authUsername],
    ["auth_password", auth.authPassword],
    ["number", number],
  ])}`;
}

/** ‎`numbers/delete` — שחרור מספר שההשכרה שלו הסתיימה. */
export function build015ReleaseUrl(auth: Pbx015Auth, number: string): string {
  return `${PBX015_NUMBERS_BASE}delete/?${buildQuery([
    ["auth_username", auth.authUsername],
    ["auth_password", auth.authPassword],
    ["number", number],
  ])}`;
}

/**
 * ‎`numbers/update` עם תיאור בלבד — שם המשרד נכתב על המספר אצל 015.
 *
 * זה מה שהופך את הטיפול הידני לאפשרי: מנהל שפותח את ממשק 015 רואה
 * ליד כל מספר למי הוא שייך, בלי לחפש בטבלאות.
 */
export function build015DescriptionUrl(
  auth: Pbx015Auth,
  input: { number: string; description: string },
): string {
  return `${PBX015_NUMBERS_BASE}update/?${buildQuery([
    ["auth_username", auth.authUsername],
    ["auth_password", auth.authPassword],
    ["number", input.number],
    ["description", input.description],
  ])}`;
}

/** תשובת 015 המפוענחת — קוד אחד, הודעה אחת, ונתונים אם יש. */
export interface Pbx015Response {
  ok: boolean;
  code: string;
  message: string;
}

/**
 * פענוח מעטפת התשובה של 015: `responses[0]` נושא קוד והודעה.
 *
 * ‏200 ו-204 שניהם הצלחה (התיעוד משתמש בשניהם, לפי הפעולה). כל
 * צורה אחרת — כולל גוף שאינו JSON במבנה המוכר — היא כישלון עם
 * ההודעה שיש, כי תשובה שאי אפשר לקרוא אינה "בסדר".
 */
export function parse015Envelope(body: unknown): Pbx015Response {
  if (typeof body !== "object" || body === null) {
    return { ok: false, code: "", message: "תשובה לא צפויה מהספק" };
  }
  const responses = (body as { responses?: unknown }).responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    return { ok: false, code: "", message: "תשובה לא צפויה מהספק" };
  }
  const first = responses[0] as { code?: unknown; message?: unknown };
  const code = typeof first.code === "string" ? first.code : String(first.code ?? "");
  const message = typeof first.message === "string" ? first.message : "";
  return { ok: code === "200" || code === "204" || code === "201", code, message };
}

/**
 * רשימת המספרים הפנויים מתוך התשובה.
 *
 * ‎`data` הוא מערך מחרוזות; ערך שאינו מחרוזת ספרתית נזרק — מספר
 * טלפון הוא ספרות, וכל דבר אחר הוא רעש שאסור להציג ככפתור רכישה.
 */
export function parse015AvailableNumbers(body: unknown): string[] {
  const envelope = parse015Envelope(body);
  if (!envelope.ok) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (typeof item === "string" ? item : typeof item === "number" ? String(item) : ""))
    .filter((item) => /^\d{4,20}$/u.test(item));
}

/** מספר להצגה: "0722776123" ⟵ "072-277-6123"-סגנון פשוט עם רווחים. */
export function formatRentalNumber(number: string): string {
  if (!/^\d+$/u.test(number)) return number;
  if (number.length === 10) return `${number.slice(0, 3)}-${number.slice(3, 6)}-${number.slice(6)}`;
  if (number.length === 9) return `${number.slice(0, 2)}-${number.slice(2, 5)}-${number.slice(5)}`;
  return number;
}

/** גבול שפיות למחיר החודשי, כמו בשאר התקרות — לא מדיניות מחירים. */
export const MAX_RENTAL_MONTHLY_AGOROT = 1_000_000;

/**
 * האם אפשר לפתוח השכרה — הודעה בעברית או `null`.
 *
 * הבדיקות כאן הן אלה שאינן דורשות רשת: מחיר מוגדר וחיובי, ומספר
 * שנראה כמו מספר. הזמינות אצל 015 נבדקת בשרת, מול הספק.
 */
export function rentalCheckoutRejection(input: {
  monthlyAgorot: number | null;
  number: string;
}): string | null {
  if (input.monthlyAgorot === null || input.monthlyAgorot < 1) {
    return "מחיר ההשכרה טרם הוגדר — פנו למנהל הפלטפורמה";
  }
  if (input.monthlyAgorot > MAX_RENTAL_MONTHLY_AGOROT) {
    return "מחיר ההשכרה שהוגדר אינו סביר — פנו למנהל הפלטפורמה";
  }
  if (!/^\d{4,20}$/u.test(input.number)) {
    return "המספר שנבחר אינו תקין";
  }
  return null;
}
