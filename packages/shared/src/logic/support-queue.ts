import {
  SUPPORT_KIND_LABEL,
  SUPPORT_SEVERITY_LABEL,
  type SupportKind,
  type SupportSeverity,
  type SupportStatus,
} from "./support.js";

/**
 * תור אחד לשני מקורות הפניות.
 *
 * ## למה מאוחד
 *
 * פנייה שנפתחה מכפתור התמיכה שבמערכת ופנייה שהגיעה במייל הן **אותה
 * עבודה**: מישהו מחכה לתשובה. שני מסכים נפרדים פירושם שני תורים
 * לבדוק, שתי ספירות "כמה פתוחות", ושתי פניות שיכולות להיות של אותו
 * אדם על אותו דבר בלי שאיש ישים לב.
 *
 * המקור נשאר מסומן — הוא משנה **איך** עונים (מייל חוזר בשרשור;
 * פנייה מהכפתור מקבלת תשובה בכרטיס ובמייל) — אבל הוא אינו מפצל את
 * הרשימה.
 */

/** מאיפה הפנייה הגיעה. משנה איך עונים, לא היכן היא מופיעה. */
export type SupportSource = "app" | "email";

export interface SupportQueueRow {
  source: SupportSource;
  id: string;
  reference: number;
  /** שורת הכותרת בתור — נושא המייל, או תחילת ההודעה מהכפתור. */
  title: string;
  /** מי פנה. */
  who: string;
  tenantName: string | null;
  status: SupportStatus;
  /** טרם נקראה/נענתה — מה שמסמן „מחכה לך”. */
  unread: boolean;
  lastActivityAt: string;
  /**
   * ‎**מה שקובע במה מטפלים קודם — על השורה, ולא מאחורי לחיצה.**
   *
   * ‎`severity` ו-`kind` היו קיימים מהיום הראשון, ונקראו רק אחרי
   * פתיחת הפנייה. כלומר תקלה **חוסמת** — מישהו עומד עכשיו מול מסך
   * שאינו עובד — נראתה בתור בדיוק כמו בקשת שיפור, ומי שמטפל היה
   * צריך לפתוח את כולן כדי לדעת במה להתחיל.
   *
   * ‎`null` בשני השדות אינו „לא ידוע” אלא **„לא קיים”**: פנייה
   * שהגיעה במייל אינה עוברת בטופס שמסווג אותה, ואין לה סוג ואין לה
   * חומרה. ערך ברירת מחדל כאן היה המצאה שנראית כמו נתון.
   */
  kind: SupportKind | null;
  severity: SupportSeverity | null;
  /**
   * דרכי הקשר — כדי שאפשר יהיה להשיב או להתקשר **מהשורה**.
   *
   * תקלה חוסמת נסגרת בשיחה, לא בשרשור. ‎`null` = אין כזה, ולא מקף
   * שנראה כמו מספר.
   */
  contactEmail: string | null;
  contactPhone: string | null;
}

/**
 * הסדר: **מה שפתוח קודם, והחדש שבו בראש.**
 *
 * ‎`status` אינו שדה מיון. מיון לפי הערך עצמו הוא לקסיקוגרפי, ושם
 * `closed` קטן מ-`in_progress` שקטן מ-`open` — כלומר הסגורות היו
 * עולות לראש והתור הפתוח נדחק מתחתן. זו בדיוק תקלה שכבר קרתה כאן
 * פעם (ביקורת Codex, על רשימת השרשורים), ולכן הכלל יושב בפונקציה
 * אחת עם בדיקה במקום להיכתב מחדש בכל קורא.
 *
 * ‎`in_progress` נחשב פתוח: מישהו מטפל, אבל הפונה עדיין מחכה.
 */
export function orderSupportQueue(rows: readonly SupportQueueRow[]): SupportQueueRow[] {
  return [...rows].sort((a, b) => {
    const openA = a.status === "closed" ? 1 : 0;
    const openB = b.status === "closed" ? 1 : 0;
    if (openA !== openB) return openA - openB;
    // חדש בראש; שוויון מוכרע במספר הפנייה כדי שהסדר יהיה יציב
    const byTime = b.lastActivityAt.localeCompare(a.lastActivityAt);
    return byTime !== 0 ? byTime : b.reference - a.reference;
  });
}

/**
 * ‎**„ממתינה” — הגדרה אחת, בשלילה.**
 *
 * הכלל נכתב בשלושה מקומות בשלושה נוסחים: `!== "resolved"` בסוכן,
 * `=== "open"` בשאילתה, ו-`!== "closed"` במסך. כל עוד היו שני
 * מצבים כולם הסכימו; ברגע ש-`in_progress` נולד, שניים מהם החלו
 * לספור אחרת — ואחד מהם הפסיק להתקמפל בכלל כשהסטטוס `resolved`
 * אוחד ל-`closed`.
 *
 * שלילה ולא מנייה חיובית: סטטוס שייוולד מחר ייחשב ממתין מעצמו,
 * וזה הכיוון הבטוח — עדיף לספור פנייה סגורה כפתוחה מאשר להעלים
 * פנייה שמישהו מחכה לתשובה עליה.
 */
export function isSupportWaiting(status: string): boolean {
  return status !== "closed";
}

/** כמה ממתינות באמת — המונה שמוצג לצד השולחן. */
export function openSupportCount(rows: readonly SupportQueueRow[]): number {
  return rows.filter((row) => isSupportWaiting(row.status)).length;
}

/** תווית המקור, לעברית. */
export const SUPPORT_SOURCE_LABEL: Record<SupportSource, string> = {
  app: "מהמערכת",
  email: "במייל",
};

/**
 * שורת הכותרת של פנייה מהכפתור.
 *
 * להודעה מהכפתור אין נושא — היא טקסט חופשי — ולכן התור מציג את
 * תחילתה. בלי החיתוך שורה אחת בתור הייתה בגובה פסקה.
 */
export function ticketTitle(message: string, max = 80): string {
  const line = message.trim().split("\n")[0]?.trim() ?? "";
  if (line === "") return "(פנייה ללא טקסט)";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * כמה שורות השולחן מושך בכל מקור. גבול קיים כדי שמסך אחד לא ימשוך
 * טבלה שלמה; הוא **לא** אמור להכריע מי מוצג.
 */
export const SUPPORT_DESK_LIMIT = 100;

/** שני הדליים שהשולחן שולף מהם. „פתוח” הוא כל מה שאינו סגור. */
export type SupportBucket = "waiting" | "closed";

/**
 * ‎**הממתינות נשלפות ראשונות — הגבול חותך את הסגורות, לא אותן.**
 *
 * ## התקלה
 *
 * שאילתה אחת עם `orderBy` על הזמן ו-`take: 100` נראית תמימה, והיא
 * בדיוק זו שמאבדת פניות: מאה פניות **סגורות** חדשות דוחקות מהמסך
 * פנייה פתוחה ישנה. היא לא מסומנת, לא נספרת במונה „ממתינות”, ואין
 * שום סימן שהייתה — המסך פשוט מציג תור קצר יותר ממה שיש.
 *
 * ## והתקלה התאומה
 *
 * הניסוח „קודם הפתוחות” נכתב פעם כ-`status: "open"`, וזה נכון רק
 * כל עוד יש שני מצבים. מרגע ש-`in_progress` נולד, פנייה שמישהו
 * לקח לטיפול נפלה לדלי של הסגורות — כלומר נעלמה מהמסך בדיוק כשהיא
 * באחריות של מישהו. לכן הדלי הראשון מוגדר בשלילה: **כל מה שאינו
 * `closed`**. סטטוס חדש שייוולד מחר ייכנס אליו מעצמו, וגם ערך
 * ישן שנשאר במסד מלפני שינוי שם — הכיוון הבטוח הוא להציג.
 *
 * שתי השאילתות ולא אחת מסוננת בזיכרון: אי אפשר לסנן בזיכרון את מה
 * שהמסד כבר לא החזיר.
 */
export async function waitingFirst<T>(
  fetch: (bucket: SupportBucket, take: number) => Promise<T[]>,
  limit: number = SUPPORT_DESK_LIMIT,
): Promise<T[]> {
  const waiting = await fetch("waiting", limit);
  // אין מקום לסגורות — ולא שאילתה מיותרת כדי לגלות את זה
  if (waiting.length >= limit) return waiting.slice(0, limit);
  const closed = await fetch("closed", limit - waiting.length);
  return [...waiting, ...closed];
}

/**
 * הסינון של השולחן — **הגדרה אחת, ולא אחת במסך ואחת במונה.**
 *
 * ‏„ממתינות” היא ברירת המחדל ולא „נפתחה”: המונה שליד הכותרת סופר כל
 * מה שאינו סגור — כולל „בטיפול”, כי שם הפונה עדיין מחכה. סינון
 * שברירת המחדל שלו `open` בלבד היה מציג רשימה קצרה מהמונה שמעליה,
 * וזו סתירה שרואים מיד: „כתוב 2, מוצגת אחת”.
 *
 * הכלל ירד לכאן מהמסך כי נולד לו קורא שני — המספרים שעל לשוניות
 * הסינון. שני מימושים של „מה נכנס ללשונית הזאת” הם בדיוק המקום שבו
 * המספר על הלשונית מפסיק להסכים עם מה שהיא פותחת.
 */
export type SupportQueueFilter = SupportStatus | "waiting" | "all";

/** סדר הלשוניות על השולחן — הממתינות ראשונות. */
export const SUPPORT_QUEUE_FILTERS: readonly SupportQueueFilter[] = [
  "waiting",
  "in_progress",
  "closed",
  "all",
];

export const SUPPORT_QUEUE_FILTER_LABEL: Record<SupportQueueFilter, string> = {
  waiting: "ממתינות",
  open: "נפתחה",
  in_progress: "בטיפול",
  closed: "נסגרה",
  all: "הכול",
};

/** האם השורה שייכת ללשונית. */
export function matchesSupportFilter(row: SupportQueueRow, filter: SupportQueueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "waiting") return isSupportWaiting(row.status);
  return row.status === filter;
}

/**
 * המספר שעל כל לשונית.
 *
 * ‎**נספר על התור המלא ולא על המסונן** — אחרת כל לשונית הייתה מציגה
 * את מספר השורות שכבר על המסך, כלומר את עצמה.
 */
export function supportQueueCounts(
  rows: readonly SupportQueueRow[],
): Record<SupportQueueFilter, number> {
  const counts: Record<SupportQueueFilter, number> = {
    waiting: 0,
    open: 0,
    in_progress: 0,
    closed: 0,
    all: 0,
  };
  for (const row of rows) {
    for (const filter of Object.keys(counts) as SupportQueueFilter[]) {
      if (matchesSupportFilter(row, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/** רק ספרות — כדי ש-„052-123” ימצא מספר ששמור כרצף. */
function digits(value: string): string {
  return value.replace(/\D+/gu, "");
}

/**
 * ‎**מה נחשב „מילה של מספר”.**
 *
 * ספרות, ורווחים/מקפים/סוגריים/פלוס/סולמית שמפרידים ביניהן — כלומר
 * מספר טלפון או מספר פנייה כפי שמישהו מקליד אותם.
 *
 * ‎**התקלה שהתנאי הזה נולד ממנה (ביקורת Codex).** ההשוואה על הספרות
 * בלבד הופעלה על כל מילה שיש בה ולו ספרה אחת, וכתובת כמו
 * ‎`user2@example.com` הצטמצמה ל-„2” — שנמצא כמעט בכל שורה, כי מספר
 * הפנייה תמיד בערימת החיפוש. כלומר חיפוש אחרי כתובת **שאינה קיימת**
 * החזיר תוצאות, בניגוד גמור להבטחה ש„כל מילה חייבת להימצא”.
 */
function looksNumeric(term: string): boolean {
  return /^[\d\s+()#.-]+$/u.test(term) && /\d/u.test(term);
}

/**
 * ‎**חיפוש חופשי בתור — כי סינון לפי מצב אינו מוצא פנייה מסוימת.**
 *
 * ## מה זה פותר
 *
 * ‏„הלקוח מתקשר ושואל מה עם הפנייה שלו” הוא הרגע השכיח ביותר מול
 * השולחן, ועד עכשיו הדרך היחידה למצוא אותה הייתה גלילה. עם מאה
 * שורות זו לא דרך.
 *
 * ## איך זה מחפש
 *
 * כל מילה בשאילתה חייבת להימצא — **וגם** ולא **או**. „דוד חוסם”
 * מוצא את הפנייה של דוד שסומנה חוסמת, ולא את כל דוד ואת כל החוסמות.
 * זה ההבדל בין חיפוש שמצמצם לחיפוש שמציף.
 *
 * מילה שכולה **מספר** (ספרות ומפרידים בלבד) נבדקת גם מול הספרות
 * בלבד של השורה, ולכן „0521234567” מוצא טלפון שנשמר עם מקפים
 * ו-„1042” מוצא את `#1042`. מילה שיש בה גם אותיות אינה עוברת שם:
 * ‎`user2@example.com` היה מצטמצם ל-„2” ומוצא כמעט הכול.
 */
export function searchSupportQueue(
  rows: readonly SupportQueueRow[],
  query: string,
): SupportQueueRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const parts = [
      `#${row.reference}`,
      row.title,
      row.who,
      row.tenantName ?? "",
      row.contactEmail ?? "",
      row.contactPhone ?? "",
      row.kind === null ? "" : SUPPORT_KIND_LABEL[row.kind],
      row.severity === null ? "" : SUPPORT_SEVERITY_LABEL[row.severity],
      SUPPORT_SOURCE_LABEL[row.source],
    ];
    const haystack = parts.join(" ").toLowerCase();
    const onlyDigits = digits(haystack);
    return terms.every((term) => {
      if (haystack.includes(term)) return true;
      if (!looksNumeric(term)) return false;
      const asDigits = digits(term);
      return asDigits !== "" && onlyDigits.includes(asDigits);
    });
  });
}
