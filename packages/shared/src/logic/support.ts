/**
 * פניות לתמיכה — הטיפוסים, וההיגיון שהופך פנייה גולמית לפנייה שאפשר
 * לטפל בה.
 *
 * הנחת המוצא: מי שנתקל בתקלה לא יודע לתאר אותה. "לא עובד לי" היא
 * הפנייה השכיחה ביותר, ובלי הקשר היא שווה סבב שאלות שלם — שבו
 * המשתמש כבר יצא מהמסך שבו הכול קרה. לכן הפנייה נושאת איתה את מה
 * שהדפדפן ידע ברגע השליחה: המסך, מה נכשל בו, ואיזו שגיאה נזרקה.
 *
 * שני כללים מנחים את מה שיושב כאן:
 *
 * 1. **מיון אוטומטי במקום שדות חובה.** לא מבקשים מהמשתמש לבחור
 *    מודול ורמת חומרה — הוא לא יודע, והשדות רק מרתיעים מלשלוח.
 *    האזור נגזר מהמסך והחומרה מהראיות.
 * 2. **הקשר טכני אינו רשות לאסוף PII.** כתובת של מסך חיפוש נושאת
 *    בתוכה את מה שהמשתמש חיפש — לרוב שם של לקוח. לכן כל כתובת
 *    מנוקה לפני שהיא נשמרת, ראו `redactUrl`.
 */

export const SUPPORT_KINDS = ["bug", "idea", "question", "billing"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const SUPPORT_KIND_LABEL: Record<SupportKind, string> = {
  bug: "תקלה",
  idea: "הצעה לשיפור",
  question: "שאלה",
  billing: "מנוי ותשלום",
};

/**
 * ‎**אוצר מילים אחד לשני מקורות הפניות.**
 *
 * הפניות מהכפתור נשאו `resolved` והשרשורים שהגיעו במייל נשאו
 * `closed` — שני קודים לאותו מצב, שכבר הוצג בעברית באותה מילה.
 * שולחן אחד לא יכול להחזיק שניים: פילטר „סגורות” היה מסנן חצי
 * מהתור, ומיון לפי סטטוס היה מפצל את אותו מצב לשתי קבוצות.
 */
export const SUPPORT_STATUSES = ["open", "in_progress", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  open: "נפתחה",
  in_progress: "בטיפול",
  closed: "נסגרה",
};

export const MAX_SUPPORT_MESSAGE = 2000;
export const MAX_SUPPORT_REPLY = 2000;
/** צילום מסך בודד. JPEG של מסך מלא בדחיסה סבירה נמצא הרבה מתחת לזה. */
export const MAX_SUPPORT_SCREENSHOT_BYTES = 4 * 1024 * 1024;
/** כמה שגיאות/בקשות שנכשלו נשמרות עם הפנייה — האחרונות הן הרלוונטיות. */
export const MAX_SUPPORT_EVIDENCE = 8;

/** מה שהדפדפן ידע ברגע השליחה. הכול אופציונלי — פנייה חשובה מהקשר. */
export interface SupportContext {
  /** הנתיב שבו נשלחה הפנייה, אחרי ניקוי */
  path?: string;
  viewport?: string;
  userAgent?: string;
  appVersion?: string;
  /** שגיאות JavaScript שנתפסו בדפדפן לפני השליחה */
  errors?: string[];
  /** בקשות API שנכשלו — "500 POST /properties" */
  failedRequests?: string[];
  /** המסכים שבהם המשתמש היה לפני כן — מסלול השחזור */
  breadcrumbs?: string[];
}

/**
 * שמות המסכים לפי הנתיב.
 *
 * הסדר משמעותי: הרשומה הראשונה שהנתיב מתחיל בה מנצחת, ולכן הערכים
 * הספציפיים קודמים לכלליים.
 */
const AREA_BY_PREFIX: [prefix: string, area: string][] = [
  ["/properties", "נכסים"],
  ["/buyers", "קונים ושוכרים"],
  ["/leads", "לידים"],
  ["/calls", "שיחות"],
  ["/matches", "התאמות"],
  ["/offers", "הצעות"],
  ["/calendar", "יומן"],
  ["/tasks", "משימות"],
  ["/collaboration", "שיתופי פעולה"],
  ["/agreements", "מסמכים והסכמים"],
  ["/reports", "דוחות"],
  ["/settings/billing", "מנוי ותשלום"],
  ["/settings", "ניהול המשרד"],
  ["/platform", "ניהול הפלטפורמה"],
  ["/onboarding", "הקמת המשרד"],
  ["/voice", "הסוכן הקולי"],
  ["/search", "חיפוש"],
  ["/profile", "פרופיל אישי"],
];

/** שם המסך שממנו נשלחה הפנייה — "/properties/01K…" → "נכסים". */
export function supportAreaFromPath(path: string | undefined): string {
  if (path === undefined || path === "" || path === "/") return "דשבורד";
  const found = AREA_BY_PREFIX.find(([prefix]) => path.startsWith(prefix));
  return found ? found[1] : "כללי";
}

/**
 * פרמטרים שמותר לשמור בכתובת. הרשימה קטנה בכוונה: היא נכתבה כרשימת
 * היתר ולא כרשימת חסימה, כי פרמטר חדש שמישהו יוסיף מחר יגיע ברירת
 * מחדל **מוסתר** ולא ברירת מחדל חשוף.
 */
const URL_PARAM_ALLOWLIST = new Set(["tab", "status", "kind", "view", "page", "expired"]);

/**
 * ניקוי כתובת לפני שמירה.
 *
 * `‎/search?q=משה לוי‎` הוא שם של לקוח בכתובת. הנתיב עצמו נשמר —
 * בלעדיו אין פנייה — והערכים מוחלפים ב-`…` כדי שהתמיכה עדיין תדע
 * שהיה שם סינון, בלי לדעת מה חיפשו.
 */
export function redactUrl(raw: string): string {
  const [path = "", query] = raw.split("?");
  if (query === undefined || query === "") return path;
  const kept = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [key = ""] = pair.split("=");
      return URL_PARAM_ALLOWLIST.has(key) ? pair : `${key}=…`;
    });
  return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
}

/** חומרה נגזרת, לא נבחרת: ראיות מהדפדפן ולא הערכה של המשתמש. */
export type SupportSeverity = "blocking" | "error" | "normal";

export const SUPPORT_SEVERITY_LABEL: Record<SupportSeverity, string> = {
  blocking: "חוסם עבודה",
  error: "תקלה",
  normal: "רגיל",
};

export interface SupportTriage {
  area: string;
  severity: SupportSeverity;
  /** משפטים קצרים לתמיכה — מה שאפשר להסיק בלי לשאול את המשתמש */
  hints: string[];
}

/**
 * הקידומת שהלקוח מוסיף לשגיאה שמקורה מחוץ למערכת.
 *
 * מוגדרת כאן ולא בצד הלקוח כדי ששני הצדדים — מי שמסמן ומי שמסיק —
 * יקראו את אותה מחרוזת.
 */
export const EXTERNAL_ERROR_PREFIX = "[חיצוני";

/** קוד המצב מתוך "500 POST /properties" — 0 כשאין. */
function statusOf(entry: string): number {
  const match = /^(\d{3})\b/u.exec(entry.trim());
  return match ? Number(match[1]) : 0;
}

/**
 * מיון הפנייה: לאן היא שייכת, כמה היא דחופה, ומה כבר ידוע עליה.
 *
 * החומרה נקבעת מראיות ולא מהצהרה: שגיאת שרת (5xx) בזמן הפנייה היא
 * תקלה שלנו וחוסמת עבודה, בעוד 403 היא לרוב הרשאה חסרה — מעצבן,
 * אבל המערכת התנהגה כמתוכנן. הצעה לשיפור לעולם אינה חוסמת, גם אם
 * במקרה נכשלה בקשה ברקע.
 */
export function triageTicket(kind: SupportKind, context: SupportContext): SupportTriage {
  const area = supportAreaFromPath(context.path);
  const failed = context.failedRequests ?? [];
  const errors = context.errors ?? [];
  const serverErrors = failed.filter((f) => statusOf(f) >= 500);
  const denied = failed.filter((f) => statusOf(f) === 401 || statusOf(f) === 403);

  const hints: string[] = [`המסך: ${area}`];
  if (serverErrors.length > 0) {
    hints.push(`${serverErrors.length} בקשות נכשלו בשגיאת שרת — ${serverErrors[0] ?? ""}`);
  }
  if (denied.length > 0) {
    hints.push("היו בקשות שנדחו בהרשאה — ייתכן שחסרה יכולת למשתמש או שהמודול חסום במסלול");
  }
  /*
   * שגיאה שסומנה כחיצונית אינה ראיה נגדנו.
   *
   * דיווח אמיתי הגיע עם שמונה עותקים של שגיאה מתוסף דפדפן, והמיון
   * הקודם הסיק ממנה "חוסם עבודה" — כלומר קפיצה לראש התור על סמך
   * קוד שאינו שלנו. הן עדיין נשמרות ומוצגות (לפעמים תוסף באמת מה
   * ששובר את המסך), אבל לא הן שקובעות את החומרה.
   */
  const ourErrors = errors.filter((e) => !e.startsWith(EXTERNAL_ERROR_PREFIX));
  if (ourErrors.length > 0) {
    hints.push(`שגיאת דפדפן: ${ourErrors[0] ?? ""}`);
  }
  if (ourErrors.length < errors.length) {
    hints.push(
      `${errors.length - ourErrors.length} שגיאות הגיעו מתוסף דפדפן או מסקריפט חיצוני — לא מהמערכת`,
    );
  }
  if (serverErrors.length === 0 && denied.length === 0 && ourErrors.length === 0) {
    hints.push("לא נרשמו שגיאות של המערכת בזמן הפנייה — ככל הנראה התנהגות ולא קריסה");
  }

  /*
   * רק תקלה יכולה לחסום. פנייה שסומנה "הצעה" או "שאלה" נשארת רגילה
   * גם כשברקע נכשלה בקשה, אחרת כל הצעה שנשלחה ממסך עם תקלה קטנה
   * הייתה קופצת לראש התור ודוחקת תקלות אמיתיות.
   */
  const severity: SupportSeverity =
    kind !== "bug"
      ? "normal"
      : serverErrors.length > 0 || ourErrors.length > 0
        ? "blocking"
        : "error";

  return { area, severity, hints };
}

/**
 * קיצוץ הראיות לגודל שנשמר. האחרונות ולא הראשונות: התקלה שגרמה
 * לפנייה היא זו שקרתה ממש לפני הלחיצה.
 */
export function trimEvidence(entries: string[] | undefined, max = MAX_SUPPORT_EVIDENCE): string[] {
  if (entries === undefined) return [];
  return entries.slice(-max).map((e) => e.slice(0, 300));
}

/**
 * ניקוי ההקשר כולו — נקודת המעבר היחידה בין מה שהדפדפן שלח לבין מה
 * שנשמר. קריאה אחת, כדי שלא יישכח שדה.
 */
export function sanitizeSupportContext(raw: SupportContext): SupportContext {
  const out: SupportContext = {};
  if (raw.path !== undefined) out.path = redactUrl(raw.path).slice(0, 300);
  if (raw.viewport !== undefined) out.viewport = raw.viewport.slice(0, 40);
  if (raw.userAgent !== undefined) out.userAgent = raw.userAgent.slice(0, 300);
  if (raw.appVersion !== undefined) out.appVersion = raw.appVersion.slice(0, 60);
  const errors = trimEvidence(raw.errors);
  if (errors.length > 0) out.errors = errors;
  const failed = trimEvidence(raw.failedRequests).map(redactUrl);
  if (failed.length > 0) out.failedRequests = failed;
  const crumbs = trimEvidence(raw.breadcrumbs).map(redactUrl);
  if (crumbs.length > 0) out.breadcrumbs = crumbs;
  return out;
}

/* ==================== מקור השגיאה ==================== */

/** סכימות של תוספי דפדפן — הן לעולם אינן הקוד של המערכת. */
const EXTENSION_SCHEMES = /^(chrome|moz|safari-web|webkit|ms-browser)-extension:\/\//u;

/** ה-URL הראשון שמופיע בטקסט — הפריים שבו השגיאה נזרקה בפועל. */
function firstUrl(source: string): string | undefined {
  return /[a-z-]+:\/\/[^\s)'"]+/iu.exec(source)?.[0];
}

/**
 * האם השגיאה הגיעה **מחוץ** למערכת.
 *
 * ההבחנה הזו נולדה מדיווח אמיתי: פנייה נשאה שמונה עותקים של
 * `Cannot read properties of undefined (reading 'M_ID')`, והמחרוזת
 * הזו לא קיימת באף חבילה שנשלחת לדפדפן. תוסף דפדפן שנכשל מגיע
 * לאותו `unhandledrejection` כמו באג אמיתי — ובלי סימון, התמיכה
 * חוקרת קוד שאינו שלה בזמן שהתקלה האמיתית ממתינה.
 *
 * **ברירת המחדל היא "שלנו".** מקור לא ידוע אינו עילה להסיר אחריות;
 * שגיאה מסומנת כחיצונית רק כשידוע בוודאות שכך היא.
 *
 * `origin` הוא המקור של הדף עצמו (`https://app.example.co.il`).
 */
export function isExternalError(source: string | undefined, origin: string): boolean {
  if (source === undefined || source.trim() === "") return false;
  const url = firstUrl(source);
  if (url === undefined) return false; // בלי כתובת אין על מה לבסס
  if (EXTENSION_SCHEMES.test(url)) return true;
  return !url.startsWith(origin);
}
