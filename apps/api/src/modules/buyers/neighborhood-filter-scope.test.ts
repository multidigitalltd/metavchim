import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neighborhoodKey, neighborhoodKeyMatches } from "@metavchim/shared";

/**
 * ‎**סינון הקונים לפי שכונה — הטענות שאין להן שגיאת קומפילציה.**
 *
 * ‏הסינון בנוי משני שלבים: שאילתה גולמית שמתרגמת את מה שהוקלד
 * ‏למפתחות שקיימים, והתנאי המאונדקס על העמודה. הטיפוסים מכסים את
 * ‏השני; את הראשון — רק בדיקה שקוראת את המקור, בדיוק כמו שאר שערי
 * ‏ההיקף במודול הזה.
 */

const SOURCE = readFileSync(join(__dirname, "buyers.service.ts"), "utf8");
/** הקטע שבו השאילתה הגולמית יושבת — מהתנאי ועד לשליפת העמוד. */
const BLOCK = SOURCE.slice(
  SOURCE.indexOf('if (neighborhoodQueryKey !== "")'),
  SOURCE.indexOf("const rows = await tx.buyer.findMany("),
);

describe("‏שאילתת המפתחות אינה חורגת ממה שמותר לראות", () => {
  /*
   * ‎**בתוך `withTenant`, ולכן RLS הוא מה שמגן.**
   *
   * ‏השאילתה יושבת בתוך הקריאה שמגדירה את הקשר הדייר; העתקה שלה
   * ‏אל מחוץ לה הייתה קוראת שכונות של משרדים אחרים. השורה הזו היא
   * ‏מה שקושר בין השתיים.
   */
  it("‏רצה בתוך ההקשר של הדייר", () => {
    expect(BLOCK.length).toBeGreaterThan(0);
    expect(SOURCE.indexOf('if (neighborhoodQueryKey !== "")')).toBeGreaterThan(
      SOURCE.indexOf("return this.prisma.withTenant(async (tx) => {"),
    );
    expect(BLOCK).toContain("tx.$queryRaw");
  });

  it("‏קוראת רק קונים שלא נמחקו", () => {
    expect(BLOCK).toContain("b.deleted_at IS NULL");
  });

  /* ‏שאילתה של תו אחד לא תשלוף את כל אוצר המשרד לזיכרון */
  it("‏חסומה בתקרה", () => {
    expect(BLOCK).toContain("LIMIT ${NEIGHBORHOOD_KEY_MAX}");
  });

  /*
   * ‎**המסד מצמצם, הקוד מכריע.**
   *
   * ‏ה-SQL עושה בדיקת תת-מחרוזת רחבה, וההכרעה — תחילית מגבול מילה —
   * ‏נשארת בכלל המשותף שגם הבורר במסך משתמש בו. שתי הכרעות נפרדות
   * ‏היו רשימה שמציעה שכונה וסינון שעליה מחזיר ריק.
   */
  it("‏ההכרעה היא הכלל המשותף ולא ה-SQL", () => {
    expect(BLOCK).toContain("neighborhoodKeyMatches(key, neighborhoodQueryKey)");
  });

  /*
   * ‎**אף שכונה לא תואמת ⟵ אף קונה.**
   *
   * ‏יציאה מפורשת ולא `hasSome` על מערך ריק: התשובה זהה, אבל היא
   * ‏הייתה תלויה במשמעות שאיש אינו בודק, ושיכולה להשתנות בשקט
   * ‏בשדרוג של Prisma — כלומר סינון שיום אחד יחזיר את כל המאגר.
   */
  it("‏בלי התאמה מחזיר עמוד ריק, ולא את כל המאגר", () => {
    expect(BLOCK).toContain("if (keys.length === 0) return { items: [], nextCursor: null };");
  });
});

/**
 * ‏מה שהשאילתה מחפשת במסד הוא **על-קבוצה** של מה שהכלל מקבל. אילו
 * ‏היה להפך, התאמה אמיתית הייתה נחתכת לפני שהקוד בכלל רואה אותה.
 */
describe("‏הצמצום במסד רחב מההכרעה שבקוד", () => {
  const like = (key: string, query: string): boolean => key.includes(query);

  it.each([
    ["רמת אהרון", "אהרון"],
    ["רמת אהרון", "רמת א"],
    ["שיכון ג", "שיכון"],
    ["פרדס כץ", "פרדס כץ"],
  ])("‏„%s” מול „%s” — מה שהכלל מקבל, ה-LIKE מעביר", (name, query) => {
    const key = neighborhoodKey(name);
    const queryKey = neighborhoodKey(query);
    expect(neighborhoodKeyMatches(key, queryKey)).toBe(true);
    expect(like(key, queryKey)).toBe(true);
  });

  /* ‏וההפך אינו נדרש: תת-מחרוזת באמצע מילה עוברת ב-SQL ונופלת בקוד */
  it("‏ומה שה-LIKE מעביר אינו בהכרח מתקבל", () => {
    const key = neighborhoodKey("רמת אהרון");
    expect(like(key, "מת")).toBe(true);
    expect(neighborhoodKeyMatches(key, "מת")).toBe(false);
  });
});
