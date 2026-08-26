import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import { JERUSALEM_TZ } from "./israel-time.js";

/**
 * התאמת מועד כניסה/מסירה — כשהתשובה אינה תאריך.
 *
 * עד כה ההשוואה הייתה `property.entryDate <= buyer.entryBy`, ושני
 * הצדדים נאלצו לבחור יום בלוח. בשוק זה כמעט אף פעם לא המצב: נכס
 * נמסר "מיידי", "גמיש", "בתיאום עם השוכר" או "החל מ-", וקונה אומר
 * "אין לי לחץ" לפחות באותה תדירות שהוא אומר "עד ספטמבר". מי שנאלץ
 * לבחור תאריך בחר תאריך שקרי, וההתאמה עבדה עליו.
 *
 * הכללים כאן מנוסחים כמו שמתווך חושב, ולכן שלושה עקרונות:
 *
 * 1. **קונה גמיש לא נפסל.** מי שאין לו אילוץ מקבל ניקוד מלא על כל
 *    נכס — מועד המסירה פשוט אינו שיקול אצלו.
 * 2. **גמישות אינה ודאות.** נכס "גמיש" מקבל ניקוד גבוה אך לא מלא
 *    מול קונה עם דד-ליין: זו שיחה שצריך לנהל, לא הבטחה.
 * 3. **איחור קטן אינו פסילה.** נכס שמתפנה חודש אחרי מה שהקונה ביקש
 *    הוא עדיין עסקה אפשרית; רק פער גדול מוריד את הניקוד לרצפה.
 *
 * הפונקציה טהורה ומחזירה `null` כשאין מה להשוות — הקריטריון פשוט
 * לא נכנס לממוצע המשוקלל, כמו כל שדה חסר אחר במנוע.
 */

/** חלון החסד: איחור קצר במסירה הוא נושא למשא ומתן, לא סיבה לפסול. */
const GRACE_DAYS = 45;

const DAY_MS = 86_400_000;

export interface EntryFit {
  /** 0–1, כמו כל קריטריון אחר במנוע. */
  score: number;
  /** מוצג למתווך רק כשיש מה להגיד; התאמה מלאה שותקת. */
  note?: string;
}

/** ההפרש בימים, חיובי כשהנכס מתפנה מאוחר מהמבוקש. */
function daysLate(entry: Date, deadline: Date): number {
  return Math.ceil((entry.getTime() - deadline.getTime()) / DAY_MS);
}

/** "15/03/2027" — עקבי עם שאר ההסברים. */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: JERUSALEM_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * ניקוד מועד הכניסה.
 *
 * `now` פרמטר ולא `new Date()` בגוף הפונקציה: המנוע חייב להישאר
 * דטרמיניסטי וניתן לבדיקה, ואותו נכס לא אמור לקבל ציון אחר לפי
 * השעה שבה רצה השאילתה.
 */
export function scoreEntryFit(
  property: Pick<PropertyFields, "entryType" | "entryDate">,
  buyer: Pick<BuyerRequirements, "entryType" | "entryBy">,
  now: Date,
): EntryFit | null {
  /*
   * תאימות לאחור: כרטיסים שנוצרו לפני השדה נושאים תאריך בלי מצב.
   * תאריך על נכס משמעו "מסירה בתאריך", ותאריך על קונה משמעו "עד".
   * בלי הגזירה הזו כל המאגר הקיים היה מאבד את קריטריון המסירה ביום
   * העלייה לאוויר.
   */
  const propertyType =
    property.entryType ?? (property.entryDate !== undefined ? "on_date" : undefined);
  const buyerType = buyer.entryType ?? (buyer.entryBy !== undefined ? "by_date" : undefined);

  // אין מה להשוות — הקריטריון לא נכנס לממוצע
  if (propertyType === undefined || buyerType === undefined) return null;

  // הקונה בלי אילוץ: מועד המסירה אינו שיקול אצלו
  if (buyerType === "flexible") return { score: 1 };

  if (propertyType === "flexible") {
    return {
      score: 0.8,
      note: "מועד המסירה בנכס ייקבע בתיאום — כדאי לוודא שהוא עונה לצורך",
    };
  }

  if (propertyType === "immediate") {
    // פנוי עכשיו עונה גם ל"מיידי" וגם לכל דד-ליין עתידי
    return { score: 1 };
  }

  // `on_date` / `from_date` — יש תאריך, אלא אם הכרטיס חסר
  if (property.entryDate === undefined) return null;

  const deadline = buyerType === "immediate" ? now : buyer.entryBy;
  if (deadline === undefined) return null;

  const late = daysLate(property.entryDate, deadline);
  if (late <= 0) return { score: 1 };
  if (late <= GRACE_DAYS) {
    return {
      score: 0.6,
      note: `הנכס מתפנה ב-${formatDate(property.entryDate)}, מעט אחרי המועד המבוקש`,
    };
  }
  return {
    score: 0.2,
    note: `הנכס מתפנה רק ב-${formatDate(property.entryDate)}`,
  };
}

/** תיאור מועד המסירה בשורה אחת — לכרטיס הנכס ולהצעה. */
export function describeEntry(
  property: Pick<PropertyFields, "entryType" | "entryDate" | "entryNote">,
): string | undefined {
  const parts: string[] = [];
  switch (property.entryType ?? (property.entryDate !== undefined ? "on_date" : undefined)) {
    case "immediate":
      parts.push("מיידי");
      break;
    case "flexible":
      parts.push("גמיש / בתיאום");
      break;
    case "on_date":
      if (property.entryDate !== undefined) parts.push(formatDate(property.entryDate));
      break;
    case "from_date":
      if (property.entryDate !== undefined) parts.push(`החל מ-${formatDate(property.entryDate)}`);
      break;
    default:
      break;
  }
  if (property.entryNote !== undefined && property.entryNote.trim() !== "") {
    parts.push(property.entryNote.trim());
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** תיאור אילוץ הכניסה של הקונה — לכרטיס הקונה. */
export function describeEntryNeed(
  buyer: Pick<BuyerRequirements, "entryType" | "entryBy">,
): string | undefined {
  switch (buyer.entryType ?? (buyer.entryBy !== undefined ? "by_date" : undefined)) {
    case "immediate":
      return "צריך להיכנס מיידית";
    case "flexible":
      return "גמיש במועד הכניסה";
    case "by_date":
      return buyer.entryBy !== undefined ? `עד ${formatDate(buyer.entryBy)}` : undefined;
    default:
      return undefined;
  }
}
