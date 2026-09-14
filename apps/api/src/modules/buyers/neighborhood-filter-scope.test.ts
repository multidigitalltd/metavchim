import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neighborhoodKeyMatches } from "@metavchim/shared";

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

  /*
   * ‎**ובלי תקרה** (ביקורת Codex, P1).
   *
   * ‏כל עוד הבדיקה במסד היתה רחבה, תקרה בלי סדר חתכה
   * ‏**לפני** ההכרעה, והתאמות אמיתיות נדחקו החוצה בידי
   * ‏התאמות באמצע מילה שהכלל פוסל בלאו הכי — קונים
   * ‏שנעלמים מהסינון בלי שום סימן. עכשיו השאילתה מחזירה
   * ‏בדיוק את התואמות, וכמותן חסומה במציאות.
   */
  it("‏אינה חותכת התאמות בתקרה", () => {
    expect(BLOCK).not.toContain("LIMIT");
  });

  /*
   * ‎**הכלל עצמו במסד, והכלל המשותף נשאר הסמכות.**
   *
   * ‏שתי הבדיקות חייבות להסכים: רשימה שמציעה שכונה וסינון
   * ‏שעליה מחזיר ריק הוא בדיוק מה ששתי הכרעות נפרדות מייצרות.
   */
  it("‏הכלל המשותף נשאר בדרך", () => {
    expect(BLOCK).toContain("neighborhoodKeyMatchSql(neighborhoodQueryKey)");
    expect(BLOCK).toContain("neighborhoodKeyMatches(key, neighborhoodQueryKey)");
  });

  /*
   * ‎**ותווי ה-LIKE מוברחים.** כל עוד המסד רק הרחיב, `%`
   * ‏שהוקלד בשדה לא הזיק — הקוד צימצם אחריו. מרגע שהמסד
   * ‏מכריע, תו כזה הוא הרחבה אמיתית של הכלל.
   */
  it("‏ותווי ה-LIKE מוברחים", () => {
    const builder = SOURCE.slice(
      SOURCE.indexOf("export function neighborhoodKeyMatchSql("),
      SOURCE.indexOf("export function requirementColumns("),
    );
    expect(builder).toContain('replace(/([!%_])/gu, "!$1")');
    expect(builder.split("ESCAPE '!'").length - 1).toBe(2);
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
 * ‎**הכלל ב-SQL הוא תרגום מדויק של זה שבקוד — לא רחב יותר.**
 *
 * ‏המודל כאן מחקה את שני ה-`LIKE` שהבונה מייצרת, ומשווה אותם
 * ‏לכלל המשותף. ההרצה מול מסד אמיתי יושבת ב-
 * ‏`neighborhood-match.int.test.ts`, בדיוק כמו שהקיפול נבדק שם.
 */
describe("‏שתי הבדיקות מסכימות", () => {
  /**
   * ‏מודל של `LIKE … ESCAPE '!'` — סריקה תו-תו, ולא החלפות
   * ‏ביטוי רגולרי: החלפה שרצה לפני המרת `%` ל-`.*` משמידה
   * ‏את הבריחה עצמה — וזו בדיוק הטעות שהבדיקה הזו תפסה
   * ‏בגרסה הראשונה של עצמה.
   */
  const like = (key: string, pattern: string): boolean => {
    let rx = "";
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i]!;
      if (ch === "!" && i + 1 < pattern.length) {
        i += 1;
        rx += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/u, "\\$&");
      } else if (ch === "%") rx += "[\\s\\S]*";
      else if (ch === "_") rx += "[\\s\\S]";
      else rx += ch.replace(/[.*+?^${}()|[\]\\]/u, "\\$&");
    }
    return new RegExp(`^${rx}$`, "u").test(key);
  };
  const matchesInSql = (key: string, queryKey: string): boolean => {
    const escaped = queryKey.replace(/([!%_])/gu, "!$1");
    return like(key, `${escaped}%`) || like(key, `% ${escaped}%`);
  };

  const KEYS = [
    "רמת אהרון",
    "שיכון ג",
    "פרדס כץ",
    "נווה שאנן",
    "רמת גן הישנה",
    "א ב ג",
    "100% שכונה",
    "קו_תחתון",
  ];
  const QUERIES = [
    "",
    "רמת",
    "אהרון",
    "רמת א",
    "מת",
    "הרון",
    "ג",
    "כץ",
    "%",
    "_",
    "!",
    "100%",
    "קו_",
  ];

  it.each(QUERIES)("‏על כל המפתחות, עבור „%s”", (query) => {
    for (const key of KEYS) {
      expect(`${key} ← ${query}: ${String(matchesInSql(key, query))}`).toBe(
        `${key} ← ${query}: ${String(neighborhoodKeyMatches(key, query))}`,
      );
    }
  });
});
