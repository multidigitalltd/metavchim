import { z } from "zod";
import {
  BuyerMaturitySchema,
  MATURITY_LABELS,
  type BuyerMaturity,
} from "../schemas/buyer.js";

/**
 * ‎**סטטוס הקונה בשתי שכבות — ולמה לא באחת.**
 *
 * ## מה קיים היום
 *
 * ‎`maturity` הוא אוצר סגור של ארבעה ערכים: „חם מאוד” ,„חם”
 * ,„מתעניין” ,„לא בשל”. הוא **אינו** רק תווית על הכרטיס — הוא מזין
 * את הדשבורד, את דירוג ההתאמות, את כרטיס הרשת, את הייצוא, את
 * ההתראות ואת הסוכן הקולי. כל אחד מהם מניח ארבעה ערכים ידועים.
 *
 * ## מה ביקשו
 *
 * ‎„יש מתווכים שאוהבים להגדיר סטטוס בעצמם”. משרד אחד עובד לפי
 * ‎„בסבב סיורים”, אחר לפי „ממתין למשכנתא”, שלישי לפי מספרי שלבים.
 *
 * ## למה לא פשוט לפתוח את `maturity` לטקסט חופשי
 *
 * כי אז כל צרכן שלו נשבר בשקט. „חם מאוד” אינו מחרוזת אלא **דרגה**:
 * הדשבורד סופר לפיה, ההתאמות ממיינות לפיה, וההתראה על „קונה חם בלי
 * הצעות” בנויה עליה. משרד שיכתוב „שלב 3” יקבל מערכת שמפסיקה לדעת
 * מי דחוף — כלומר אובדן פונקציונליות שהוא לא ביקש ולא יבין.
 *
 * ## שתי שכבות
 *
 * ‎**שכבה א׳** — ארבע הדרגות. נשארות, נשארות גלויות על הכרטיס,
 * ונשארות ניתנות לשינוי ישיר. הן השפה שהמערכת עצמה מדברת.
 *
 * ‎**שכבה ב׳** — רשימת המשרד. כל סטטוס נושא `maturity` שהוא **נשען
 * עליה**, ולכן בחירה בו קובעת גם את הדרגה. המשרד מקבל את המילים
 * שלו, והמערכת ממשיכה לקבל את הדרגה שהיא צריכה — בלי שאיש צריך
 * לתחזק שתי מערכות שלא מסכימות.
 *
 * זו גם התשובה לשאלה „מה עם הדשבורד”: הוא אינו משתנה כלל.
 */

/** אורך התווית — כמה שנכנס לגלולה על הכרטיס בלי לגלוש. */
export const MAX_OFFICE_STATUS_LABEL = 30;

/**
 * ‎**תקרה על מספר הסטטוסים.**
 *
 * לא מגבלה טכנית: רשימה בת ארבעים היא רשימה שאיש אינו זוכר, וסטטוס
 * שאיש אינו זוכר אינו מעודכן — כלומר נתון שנראה קיים ואינו נכון.
 */
export const MAX_OFFICE_STATUSES = 20;

/** מזהה שנשמר על כרטיס הקונה, ולכן חייב להיות צר וקבוע. */
const STATUS_ID = /^[a-z0-9]{2,24}$/u;

export const OfficeBuyerStatusSchema = z.object({
  /**
   * ‎**מזהה ולא התווית** — כי תווית משתנה.
   *
   * משרד שמשנה „בסבב סיורים” ל„בסיורים” אינו מתכוון לאבד את הסטטוס
   * מכל הכרטיסים שנושאים אותו. שמירת התווית על הרשומה הייתה עושה
   * בדיוק את זה, ובשקט.
   */
  id: z.string().regex(STATUS_ID),
  label: z.string().trim().min(2).max(MAX_OFFICE_STATUS_LABEL),
  /** הדרגה שהסטטוס נשען עליה — מה שהמערכת עצמה קוראת. */
  maturity: BuyerMaturitySchema,
  /**
   * ‎**מוסתר, ולא נמחק.**
   *
   * סטטוס שיצא משימוש עדיין רשום על כרטיסים ישנים. מחיקה שלו הייתה
   * הופכת אותם ל„סטטוס לא ידוע” — כלומר מוחקת מידע היסטורי כדי
   * לנקות תפריט. הוא יוצא מהבוררים ונשאר קריא במקום שבו הוא כתוב.
   */
  archived: z.boolean().default(false),
});
export type OfficeBuyerStatus = z.infer<typeof OfficeBuyerStatusSchema>;

/**
 * ‎**מה שמשרד חדש מקבל — ולמה בכלל ברירת מחדל.**
 *
 * רשימה ריקה היא מסך שמבקש מהמשתמש להמציא תהליך עבודה לפני שהוא
 * ראה איך הפיצ׳ר נראה. חמישה שלבים שמתארים את המסלול הרגיל של
 * קונה הם נקודת פתיחה שאפשר לערוך, למחוק ולהחליף — ולא אילוץ.
 *
 * המיפוי לדרגות אינו שרירותי: הוא הופך את השלב לדחיפות שהמערכת
 * יודעת לפעול לפיה.
 */
export const DEFAULT_OFFICE_STATUSES: readonly OfficeBuyerStatus[] = [
  { id: "s1", label: "ליד חדש", maturity: "interested", archived: false },
  { id: "s2", label: "בבירור צרכים", maturity: "interested", archived: false },
  { id: "s3", label: "בסבב סיורים", maturity: "hot", archived: false },
  { id: "s4", label: "במשא ומתן", maturity: "very_hot", archived: false },
  { id: "s5", label: "בהמתנה", maturity: "not_ripe", archived: false },
];

/**
 * הרשימה כפי שהיא שמורה בהגדרות המשרד.
 *
 * ‎**חסר מוחלט ≠ רשימה ריקה.** משרד שלא נגע מעולם מקבל את ברירת
 * המחדל; משרד שמחק את כולן מקבל רשימה ריקה ונשאר עם שכבה א׳ בלבד.
 * החייאה של ברירות המחדל במקרה השני הייתה מבטלת פעולה מפורשת של
 * המשתמש בכל טעינה.
 *
 * ‎**ערך פגום נופל לבדו.** רשומה אחת שנשמרה שגוי — ייבוא, עריכה
 * ידנית ב-JSON — אינה מפילה את הרשימה כולה: היא יורדת, והשאר עובד.
 */
export function officeStatuses(raw: unknown): OfficeBuyerStatus[] {
  if (raw === undefined || raw === null) return [...DEFAULT_OFFICE_STATUSES];
  if (!Array.isArray(raw)) return [...DEFAULT_OFFICE_STATUSES];
  const out: OfficeBuyerStatus[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = OfficeBuyerStatusSchema.safeParse(entry);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
    if (out.length >= MAX_OFFICE_STATUSES) break;
  }
  return out;
}

/** מה שמוצג בבוררים — בלי מה שהוצא משימוש. */
export function activeOfficeStatuses(
  list: readonly OfficeBuyerStatus[],
): OfficeBuyerStatus[] {
  return list.filter((entry) => !entry.archived);
}

/**
 * חיפוש לפי מזהה — **כולל מה שהוצא משימוש**.
 *
 * זו כל הנקודה של ההסתרה: כרטיס שנושא סטטוס ישן חייב להמשיך להציג
 * את שמו, גם כשהוא כבר לא ניתן לבחירה.
 */
export function officeStatusById(
  list: readonly OfficeBuyerStatus[],
  id: string | null | undefined,
): OfficeBuyerStatus | null {
  if (id === null || id === undefined || id === "") return null;
  return list.find((entry) => entry.id === id) ?? null;
}

/** התווית להצגה. ריק = אין סטטוס, או שהמזהה כבר אינו מוכר. */
export function officeStatusLabel(
  list: readonly OfficeBuyerStatus[],
  id: string | null | undefined,
): string {
  return officeStatusById(list, id)?.label ?? "";
}

/**
 * ‎**הדרגה שבחירת הסטטוס גוררת.**
 *
 * זה הקשר היחיד בין שתי השכבות, והוא בכיוון אחד: הסטטוס קובע את
 * הדרגה ולא להפך. כך כל מה שקורא `maturity` — דשבורד, התאמות,
 * התראות, ייצוא — ממשיך לעבוד בלי לדעת שהשכבה השנייה קיימת.
 */
export function maturityForStatus(
  list: readonly OfficeBuyerStatus[],
  id: string | null | undefined,
): BuyerMaturity | null {
  return officeStatusById(list, id)?.maturity ?? null;
}

/**
 * ‎**מה קורה לסטטוס כשמשנים את הדרגה ישירות.**
 *
 * שתי השכבות גלויות שתיהן על הכרטיס, ולכן אפשר לשנות כל אחת מהן.
 * שינוי ידני של הדרגה סותר סטטוס שנשען על דרגה אחרת — „במשא ומתן”
 * שמסומן „לא בשל” הוא כרטיס שקורא שני דברים הפוכים, ואין דרך לדעת
 * מי מהם נכון.
 *
 * ‎**הדרגה מנצחת, והסטטוס יורד.** היא הפעולה שהמשתמש עשה עכשיו,
 * והיא גם מה שכל שאר המערכת פועלת לפיו. שמירה על שניהם הייתה
 * משאירה על המסך תווית שאינה נכונה.
 *
 * ‎**סטטוס שנשען על אותה דרגה נשאר.** אין שם סתירה, ואיפוס שלו היה
 * מוחק מידע בלי סיבה — למשל מי שלוחץ על אותה דרגה שכבר מסומנת.
 */
export function statusAfterMaturityChange(
  list: readonly OfficeBuyerStatus[],
  currentStatusId: string | null | undefined,
  /**
   * ‎`string` ולא `BuyerMaturity` **בכוונה**: הערך מגיע מגוף בקשה,
   * ודרגה שאינה מוכרת אינה תואמת לשום סטטוס — כלומר הסטטוס יורד,
   * וזו גם התוצאה הבטוחה. טיפוס צר כאן היה מכריח המרה בקצה, שהיא
   * בדיוק המקום שבו טענה כזו נשברת בשקט.
   */
  nextMaturity: string,
): string | null {
  const current = officeStatusById(list, currentStatusId);
  if (current === null) return null;
  return current.maturity === nextMaturity ? current.id : null;
}

/** קיפול תוויות להשוואה — „ליד חדש ” ו„ליד  חדש” הן אותה תווית. */
function labelKey(label: string): string {
  return label.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * ‎**המזהה הבא — ולמה הוא לא נגזר מהתווית.**
 *
 * תווית עברית אינה מזהה תקין, ותעתיק שלה הוא ניחוש שמייצר התנגשויות
 * („בסיור” ו„בסיורים”). מונה פשוט אינו יכול להתנגש, והוא גם קריא
 * מספיק כדי לקרוא רשומה במסד בלי לפענח כלום.
 *
 * המונה נגזר מהמקסימום הקיים ולא מהאורך: מחיקה באמצע הרשימה אינה
 * משחררת מזהה שכרטיס עדיין מצביע עליו.
 */
export function nextOfficeStatusId(list: readonly OfficeBuyerStatus[]): string {
  let max = 0;
  for (const entry of list) {
    const match = /^s(\d+)$/u.exec(entry.id);
    if (match === null) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `s${max + 1}`;
}

/** למה פעולה על הרשימה נדחתה — טקסט שמוצג כמו שהוא. */
export type OfficeStatusError =
  | "רשימת הסטטוסים מלאה"
  | "כבר קיים סטטוס בשם הזה"
  | "הסטטוס לא נמצא"
  | "שם הסטטוס קצר מדי";

export type OfficeStatusResult =
  | { ok: true; list: OfficeBuyerStatus[]; id: string }
  | { ok: false; error: OfficeStatusError };

/**
 * הוספה. התווית ייחודית **בקיפול** ולא באות: שתי גרסאות של אותו שם
 * הן שני שלבים שאיש לא יידע להבדיל ביניהם ברשימה נפתחת.
 *
 * ההשוואה כוללת גם מה שהוצא משימוש — שני סטטוסים באותו שם, אחד
 * מוסתר, הם בדיוק המצב שבו לא ברור למה כרטיס ישן קורא אחרת.
 */
export function addOfficeStatus(
  list: readonly OfficeBuyerStatus[],
  input: { label: string; maturity: BuyerMaturity },
): OfficeStatusResult {
  const label = input.label.replace(/\s+/gu, " ").trim();
  if (label.length < 2) return { ok: false, error: "שם הסטטוס קצר מדי" };
  if (list.length >= MAX_OFFICE_STATUSES) {
    return { ok: false, error: "רשימת הסטטוסים מלאה" };
  }
  const key = labelKey(label);
  if (list.some((entry) => labelKey(entry.label) === key)) {
    return { ok: false, error: "כבר קיים סטטוס בשם הזה" };
  }
  const id = nextOfficeStatusId(list);
  return {
    ok: true,
    id,
    list: [
      ...list,
      { id, label: label.slice(0, MAX_OFFICE_STATUS_LABEL), maturity: input.maturity, archived: false },
    ],
  };
}

/**
 * עריכה. שינוי הדרגה של סטטוס קיים **אינו** רודף אחורה אחרי כרטיסים
 * שנושאים אותו: הדרגה שלהם נקבעה ברגע הבחירה, ושכתוב שלה בדיעבד היה
 * משנה בשקט את הדשבורד וההתראות של עשרות כרטיסים שאיש לא נגע בהם.
 * ההגדרה החדשה חלה על הבחירה הבאה.
 */
export function updateOfficeStatus(
  list: readonly OfficeBuyerStatus[],
  id: string,
  patch: { label?: string; maturity?: BuyerMaturity; archived?: boolean },
): OfficeStatusResult {
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return { ok: false, error: "הסטטוס לא נמצא" };
  const current = list[index]!;

  let label = current.label;
  if (patch.label !== undefined) {
    label = patch.label.replace(/\s+/gu, " ").trim();
    if (label.length < 2) return { ok: false, error: "שם הסטטוס קצר מדי" };
    const key = labelKey(label);
    if (list.some((entry) => entry.id !== id && labelKey(entry.label) === key)) {
      return { ok: false, error: "כבר קיים סטטוס בשם הזה" };
    }
  }

  const next: OfficeBuyerStatus = {
    id: current.id,
    label: label.slice(0, MAX_OFFICE_STATUS_LABEL),
    maturity: patch.maturity ?? current.maturity,
    archived: patch.archived ?? current.archived,
  };
  const out = [...list];
  out[index] = next;
  return { ok: true, id, list: out };
}

/**
 * מחיקה מלאה. מותרת רק כשאיש אינו נושא את הסטטוס — הבדיקה הזו היא
 * שאילתה על המסד ולכן נעשית בשרת, וכאן מגיע כבר `inUse`.
 *
 * ‎**מחיקה של סטטוס בשימוש היא מחיקת מידע**, ולכן היא לא נחסמת „עד
 * שיתפנה” אלא מוחלפת בהסתרה, שנותנת את אותה תוצאה בתפריט בלי לגעת
 * בכרטיסים.
 */
export function removeOfficeStatus(
  list: readonly OfficeBuyerStatus[],
  id: string,
  inUse: boolean,
): OfficeStatusResult {
  const index = list.findIndex((entry) => entry.id === id);
  if (index === -1) return { ok: false, error: "הסטטוס לא נמצא" };
  if (inUse) return updateOfficeStatus(list, id, { archived: true });
  return { ok: true, id, list: list.filter((entry) => entry.id !== id) };
}

/**
 * ‎**השורה שנרשמת בציר הזמן — אחת לכל פעולה, ולא אחת לכל עמודה.**
 *
 * בחירת סטטוס מזיזה גם את הדרגה. שתי שורות — „סטטוס: … ” ומיד
 * אחריה „בשלות: …” — היו נקראות בציר כמו **שני** דברים שקרו, במקום
 * כמו הדבר האחד שהמתווך עשה. הציר הוא מה שמסבירים בו ללקוח מה קרה
 * ומתי, ורעש בו הוא לא אי-נוחות אלא היסטוריה שגויה.
 *
 * ולכן השורה נגזרת ממה ש**נשלח** ולא ממה שהשתנה: מי שבחר סטטוס
 * רואה שורת סטטוס, ומי ששינה דרגה רואה שורת דרגה — כולל כשהדרגה
 * הפילה סטטוס סותר, שנאמר באותה שורה במקום בשורה נפרדת.
 *
 * ריק = לא קרה דבר שראוי לרשום (קביעה חוזרת של אותו ערך).
 */
export function buyerStatusChangeLine(input: {
  statuses: readonly OfficeBuyerStatus[];
  /** האם הבקשה נגעה בסטטוס במפורש (ולא רק כתוצאה משינוי דרגה). */
  pickedStatus: boolean;
  statusMoved: boolean;
  maturityMoved: boolean;
  beforeStatus: string | null;
  afterStatus: string | null;
  beforeMaturity: string;
  afterMaturity: string | undefined;
}): string {
  const name = (id: string | null): string => {
    const label = officeStatusLabel(input.statuses, id);
    /* „—” ולא ריק: „סטטוס: ← בסיורים” נראה כמו טקסט חסר. */
    return label === "" ? "—" : label;
  };
  const grade = (value: string | undefined): string =>
    MATURITY_LABELS[value as BuyerMaturity] ?? value ?? "";

  if (input.pickedStatus && input.statusMoved) {
    return `סטטוס: ${name(input.beforeStatus)} ← ${name(input.afterStatus)}`;
  }
  if (input.maturityMoved) {
    const line = `בשלות: ${grade(input.beforeMaturity)} ← ${grade(input.afterMaturity)}`;
    /*
     * הסטטוס לא „נעלם”: הוא ירד **בגלל** הדרגה החדשה, וזה בדיוק מה
     * שהמתווך צריך לדעת כשהוא יחפש אותו ולא ימצא.
     */
    return input.statusMoved && input.beforeStatus !== null
      ? `${line} · הסטטוס „${name(input.beforeStatus)}” הוסר`
      : line;
  }
  return "";
}
