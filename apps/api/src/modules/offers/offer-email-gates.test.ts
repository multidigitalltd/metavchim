import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**שער שחל על מסלול אחד ולא על הניסיון החוזר שלו.**
 *
 * הזכאות הראשונית של ההצעות האוטומטיות דורשת נכס `active` שאינו
 * מחוק. הניסיון החוזר — שרץ על הצעות שנשארו `pending_email` אחרי
 * פסק זמן או תקלת ספק — בדק את **הלקוח** בלבד (הסרה מרשימת
 * התפוצה), ולא את הנכס.
 *
 * התוצאה: שליחה שנכשלה, הנכס נמכר, והסבב הבא שלח בכל זאת. הלקוח
 * מקבל הצעה על דירה שהמשרד כבר משך — ומאז שהשליחה מתעדת פעולת
 * שיווק, גם נרשמת פעולה על נכס שהוסר (ביקורת Codex).
 *
 * ‎**מה הבדיקה מחזיקה:** לא את הניסוח, אלא את **קיומו של השער בשני
 * המסלולים**. זו משפחת התקלות שחוזרת כאן — תנאי שנכתב פעמיים ואחד
 * העותקים נשאר מאחור — ובדיקה מבנית היא הדרך הזולה לתפוס אותה.
 *
 * אין הרנס בדיקות ל-`OfferEmailService` (Prisma, RLS, ספק דואר),
 * ולכן זו בדיקה על המקור — כמו `match-created-at` ו-`office-names`.
 */

const RAW = readFileSync(join(import.meta.dirname, "offer-email.service.ts"), "utf8");

/**
 * ‎**הקוד בלי ההערות — והסיבה שזה כאן ולא בכל טענה בנפרד.**
 *
 * הקובץ הזה מתעד למה כל שער קיים, ולכן ההערות שלו נוקבות במפורש
 * בדיוק במה שהטענות מחפשות: `optedOutAt`, `hasSigned`, `draft`.
 * שלוש פעמים בסבב אחד עברה כאן טענה **על ההערה של עצמה** — הקוד
 * הוסר, הפרוזה שמסבירה אותו נשארה, והשער נשאר ירוק ולא שמר על דבר.
 *
 * תיקון פרטני לכל טענה („חפש `signedPairs(` ולא `signedPairs`”)
 * מטפל במופע ולא במחלקה, וכל טענה חדשה מתחילה מאפס. הפשטת ההערות
 * פעם אחת סוגרת את הדלת לכולן.
 *
 * ‎`//` מוסר רק כשהוא שורה שלמה, כדי ש-`https://` בתוך מחרוזת לא
 * ייחתך באמצע.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

/** גוף פונקציה פרטית אחת, עד הפונקציה הבאה באותה רמת הזחה. */
function body(name: string): string {
  const start = SOURCE.indexOf(`private async ${name}(`);
  expect(start, `${name} לא נמצאה בקובץ`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const end = rest.search(/\n {2}(?:private|public|async)/u);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * ‎**תנאי ה-`where` של שאילתת ה**נכסים** בלבד — ולא של הפונקציה.**
 *
 * הניסוח הראשון של הבדיקה הזו חיפש `deletedAt: null` בכל גוף
 * הפונקציה, והוא נמצא שם — על שאילתת ה**קונה**. כלומר הבדיקה עברה
 * גם כשהסרתי את התנאי מהנכס: שער שנראה ירוק ואינו שומר על דבר,
 * שהוא בדיוק סוג הבדיקה שהקובץ הזה קיים כדי למנוע. אומת בשבירה.
 */
function propertyWhere(fn: string): string {
  const match = /tx\.property\.find(?:First|Many)\(\{[\s\S]*?\n {12}\},/u.exec(body(fn));
  expect(match, `${fn}: אין שאילתת נכסים כלל`).not.toBeNull();
  return match![0];
}

describe("שער הנכס בהצעות האוטומטיות", () => {
  it("הזכאות הראשונית דורשת נכס פעיל שאינו מחוק", () => {
    const where = propertyWhere("eligibleMatches");
    expect(where).toContain('status: "active"');
    expect(where).toContain("deletedAt: null");
  });

  /*
   * ‎**וזה הצד שנשבר.** בין היצירה לניסיון החוזר עוברות עשר דקות
   * לפחות, ובהן הנכס יכול להימכר, לרדת לטיוטה או להימחק.
   */
  it("והניסיון החוזר בודק אותו שוב", () => {
    const where = propertyWhere("retryPending");
    expect(where).toContain('status: "active"');
    expect(where).toContain("deletedAt: null");
  });

  /*
   * ‎**וגם את הלקוח** — הבדיקה שכן הייתה שם. אילו הייתי מחליף אותה
   * בבדיקת הנכס במקום להוסיף לצידה, הבדיקה שמעל הייתה עוברת.
   */
  it("ואת ההסרה מרשימת התפוצה", () => {
    expect(body("retryPending")).toContain("optedOutAt");
  });

  /*
   * ‎**ההסרה מרשימת התפוצה נבדקת בשני המסלולים.**
   *
   * ‎`eligibleMatches` בונה תמונת מצב של „מי ניתן להשגה”, ובין הרגע
   * ההוא לרגע היצירה הלקוח יכול ללחוץ על קישור ההסרה.
   * ‎`ContactsService.getById` אינו שולף `optedOutAt` — הוא מפענח שם,
   * טלפון ואימייל בלבד — ולכן הבדיקה במסלול היצירה **נראתה קיימת
   * ולא הייתה**: המייל יצא ללקוח שכבר הסיר את עצמו, בניגוד לחוק
   * התקשורת §30א (ביקורת Codex).
   */
  it("שני המסלולים קוראים את ההסרה מהמסד, ולא נשענים על getById", () => {
    for (const fn of ["eligibleMatches", "offerAndEmail", "retryPending"]) {
      expect(body(fn), fn).toContain("optedOutAt");
    }
  });

  /*
   * ‎**„טיוטה” אינה נכללת באוטומציה, וזו הסיבה שלא נעשה כאן שימוש
   * חוזר ב-`offerPropertyMarketable`.** הוא מתיר `draft | active`,
   * כי מתווך רשאי להציע טיוטה במודע; האוטומציה משווקת רק מה שהמשרד
   * סימן פעיל. שימוש חוזר בו היה מרחיב את האוטומציה בשקט.
   */
  it("האוטומציה אינה משווקת טיוטות", () => {
    for (const fn of ["eligibleMatches", "retryPending"]) {
      expect(body(fn), fn).not.toMatch(/status:\s*\{\s*in:\s*\[[^\]]*"draft"/u);
    }
  });
});

/**
 * ‎**עבודה חסומה בתוך טרנזקציה.**
 *
 * שער ההחתמה נבדק לכל מועמד בנפרד (`hasSigned` — שתי שאילתות
 * לקריאה), בלולאה, בתוך טרנזקציה אחת. מספר המועמדים לא היה חסום:
 * ייבוא או חישוב-מחדש המוני מייצרים אלפי התאמות חזקות, ותקרת
 * עשרים הלקוחות שבהמשך אינה חוסמת זאת — היא חלה **אחרי**. משרד
 * אחד היה מחזיק טרנזקציה פתוחה לאלפי שאילתות כל עשר דקות ומעכב
 * את כל השאר (ביקורת Codex).
 */
describe("חסימת העבודה בסבב", () => {
  it("שער ההחתמה נבדק בקבוצה ולא בלולאה", () => {
    const eligible = body("eligibleMatches");
    expect(eligible).toContain("signedPairs(");
    expect(eligible).not.toContain("hasSigned");
  });

  it("מספר המועמדים חסום", () => {
    expect(body("eligibleMatches")).toMatch(/take:\s*MAX_CANDIDATES_PER_SWEEP/u);
  });

  /*
   * ‎**וחיתוך נאמר בקול.** מגבלה שקטה נקראת כמו „זה הכול”, וזה בדיוק
   * הכשל שהמערכת הזו חוזרת ומגנה מפניו — תשובה שנראית מלאה ומדברת
   * על שאלה אחרת. אותו נימוק כמו בוויסות הלקוחות שכבר מדווח.
   */
  it("והחיתוך מדווח", () => {
    expect(body("eligibleMatches")).toContain("this.logger");
  });
});
