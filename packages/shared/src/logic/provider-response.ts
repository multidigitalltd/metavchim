/**
 * „מה בעצם ענתה המרכזייה” — **בצורה שמותר לשמור.**
 *
 * ## הבעיה שזה פותר
 *
 * ‎`response_unreadable` פירושו ש-015 החזירה 200 עם JSON שאין בו אף
 * אחד מהמפתחות שאנחנו יודעים לקרוא. זה קורה בשני מצבים שהתיקון
 * שלהם הפוך לגמרי:
 *
 * - **מעטפת שגיאה** — `{"status":"error","message":"..."}`. הספק
 *   מחזיר 200 גם על אישורים שגויים ועל הקלטה שנמחקה, ולכן `res.ok`
 *   אינו תופס אותם.
 * - **שם מפתח שאיננו מכירים** — ההקלטה שם, ואנחנו מחפשים אותה
 *   במקום הלא נכון.
 *
 * המסך אמר „התשובה מהמרכזייה לא נקראה” ולא יותר, וזה נכון אבל חסר
 * תועלת: אי אפשר לדעת ממנו אם להשלים סיסמה, להתקשר לספק, או לתקן
 * אצלנו את רשימת השמות (דיווח מהשטח).
 *
 * ## למה זה לא סותר את הכלל של הרשימה הסגורה
 *
 * הכלל נכתב כי כתובת המשיכה נושאת שם משתמש וסיסמה, וגוף השגיאה של
 * ספק מחזיר לא פעם את הבקשה שקיבל. הכלל **נשאר**, ומה שנוסף כאן
 * הוא תיאור שנבנה מראש כך שאינו יכול לשאת אותם:
 *
 * 1. שמות מפתחות — תמיד. שם מפתח אינו סוד.
 * 2. ערכים — רק לשדות טכניים קצרים מרשימה סגורה.
 * 3. כתובות URL — נמחקות לגמרי, לפני כל בדיקה אחרת.
 * 4. הסודות עצמם — מוחלפים במפורש, כרשת ביטחון אחרונה.
 *
 * זה בדיוק אותו עיקרון של `TelephonyWebhookHit`: שמות תמיד, ערכים
 * רק לשדות טכניים, לעולם לא תוכן של לקוח.
 */

/** שדות שערכם הוא קוד או מילה טכנית — קצרים, ולא נושאים תוכן. */
const SAFE_VALUE_KEYS = ["status", "code", "result", "format", "filetype", "type"];

/** שדות שהערך שלהם מעניין אך עלול לשאת טקסט חופשי מהספק. */
const MESSAGE_KEYS = ["message", "error", "reason", "description", "msg"];

/** אורך מרבי לערך יחיד, ולכל התיאור. */
const VALUE_LIMIT = 60;
const TOTAL_LIMIT = 200;

/**
 * מחיקת כתובות — **לפני** כל שיקול אחר.
 *
 * זו ההגנה העיקרית ולא החלפת הסוד: כתובת המשיכה נושאת את האישורים
 * כפרמטרים, ומחיקת כל מה שנראה כמו URL מוציאה אותם מהמשחק בלי
 * להסתמך על כך שנזהה בדיוק את המחרוזת שלהם.
 */
function withoutUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, "[כתובת]");
}

/**
 * רשת ביטחון אחרונה — הסוד עצמו, גם אם הופיע בלי כתובת סביבו.
 *
 * **בלי חריג של אורך.** היה כאן דילוג על סוד קצר משלושה תווים, כדי
 * שסיסמה בת תו אחד לא תהפוך כל מילה באנגלית לכוכביות ותשאיר תיאור
 * חסר תועלת. זה היה איזון שגוי: תצורת המרכזייה אינה כופה אורך
 * מזערי, ומשרד שהזין סיסמה בת תו אחד היה מקבל אותה מודפסת ביומן
 * ובעמודה שבמסד (ביקורת Codex, P1). אבחון עקר עדיף על סוד שדלף —
 * ומי שהסיסמה שלו קצרה כל כך יראה תיאור מלא כוכביות, וטוב שכך.
 *
 * מחרוזת ריקה כן מדולגת, וזו אינה הקלה אלא נכונות: `split("")`
 * מפרק כל תו בנפרד ומחזיר טקסט מרוסק לגמרי.
 */
function withoutSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    out = out.split(secret).join("***");
  }
  return out;
}

/** המעטפת עצמה — מערך בן פריט אחד או אובייקט יחיד, לפי הנתיב. */
function envelopeOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string, secrets: readonly string[]): string {
  const safe = withoutSecrets(withoutUrls(value), secrets).replace(/\s+/gu, " ").trim();
  return safe.length > VALUE_LIMIT ? `${safe.slice(0, VALUE_LIMIT - 1)}…` : safe;
}

/**
 * תיאור קצר ומצונזר של תשובת הספק.
 *
 * `secrets` הם שם המשתמש והסיסמה של אותו משרד — נמסרים ולא נקראים
 * מכאן, כי הלוגיקה המשותפת אינה מכירה תצורה.
 */
export function describeProviderResponse(body: unknown, secrets: readonly string[] = []): string {
  if (body === null || body === undefined) return "התשובה ריקה";
  if (typeof body !== "object") return `התשובה אינה אובייקט (${typeof body})`;
  if (Array.isArray(body)) return `התשובה היא רשימה (${body.length} פריטים)`;

  const root = body as Record<string, unknown>;
  const parts: string[] = [];

  const describe = (scope: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(scope)) {
      const name = `${prefix}${key}`;
      if (typeof value === "string" && SAFE_VALUE_KEYS.includes(key.toLowerCase())) {
        parts.push(`${name}=${clean(value, secrets)}`);
        continue;
      }
      if (typeof value === "string" && MESSAGE_KEYS.includes(key.toLowerCase())) {
        parts.push(`${name}="${clean(value, secrets)}"`);
        continue;
      }
      /*
       * מפתח שאיננו מכירים מקבל **שם וגודל בלבד.**
       *
       * הגודל הוא מה שעונה על השאלה המעניינת: מפתח עם 40 אלף תווים
       * הוא ההקלטה עצמה תחת שם שלא ציפינו לו, ומפתח עם שנים-עשר הוא
       * קוד. שני המצבים דורשים תיקון שונה לגמרי, ובלי הגודל שניהם
       * נראים כמו „עוד שדה”.
       */
      if (typeof value === "string") {
        parts.push(`${name}(${value.length} תווים)`);
        continue;
      }
      /*
       * מערך מקבל **אורך**, ולא „object”.
       *
       * ‎`typeof []` הוא `"object"`, ולכן מעטפת `responses` — מערך בן
       * פריט אחד עם קוד השגיאה של הספק — הודפסה כ„responses:object”
       * וזהו. זה כל מה שהיה למתווך על המסך ולנו ביומן, ומשם אי אפשר
       * להתקדם לשום כיוון (דיווח מהשטח).
       */
      if (Array.isArray(value)) {
        parts.push(`${name}[${value.length}]`);
        continue;
      }
      parts.push(`${name}:${value === null ? "null" : typeof value}`);
    }
  };

  describe(root, "");
  /*
   * ‎`data` ו-`responses` — שני המקומות שבהם 015 מניחה את התוכן.
   * המעטפת היא הראשונה שכדאי לראות: הקוד וההודעה שבתוכה הם ההבדל
   * בין „הסיסמה שגויה” לבין „ההקלטה נמחקה”, ושניהם מגיעים בסטטוס
   * 200 שאין בו רמז.
   */
  for (const [key, scope] of [
    ["data", root["data"]],
    ["responses", envelopeOf(root["responses"])],
  ] as const) {
    if (typeof scope === "object" && scope !== null && !Array.isArray(scope)) {
      describe(scope as Record<string, unknown>, `${key}.`);
    }
  }

  if (parts.length === 0) return "התשובה היא אובייקט ריק";
  const joined = parts.join(" · ");
  /*
   * ‎`TOTAL_LIMIT - 1` ואז שלוש הנקודות: `provider_recording_detail`
   * הוא `VARCHAR(200)`, ותיאור באורך 201 היה נדחה על ידי PostgreSQL
   * יחד עם `providerRecordingError` שבאותו עדכון — כלומר תשובה
   * רחבה ולא מוכרת, בדיוק המקרה שבשבילו נכתב האבחון, הייתה נשארת
   * בלי סטטוס כשל ובלי תיאור (ביקורת Codex).
   */
  return joined.length > TOTAL_LIMIT ? `${joined.slice(0, TOTAL_LIMIT - 1)}…` : joined;
}
