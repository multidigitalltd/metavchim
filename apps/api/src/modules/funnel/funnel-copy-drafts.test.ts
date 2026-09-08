import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unknownFunnelPlaceholders } from "@metavchim/shared";

/**
 * ‎**הטיוטות הזרועות — מה שאסור שיישלח כמו שהוא.**
 *
 * ‏הנוסחים יושבים ב-SQL ולא בקוד, ולכן שום טיפוס אינו שומר עליהם.
 * ‏שתי הטענות כאן הן בדיוק שתי הדרכים שבהן מיגרציה כזו יכולה
 * ‏להזיק:
 *
 * ‎1. **מציין מקום שאיש לא יחליף.** `{{שם_הסוכן}}` נשמע סביר
 *    ‏לגמרי, ואם אין לו מימוש הוא יוצא ללקוח בסוגריים.
 * ‎2. **הדלקה בשוגג.** מילוי נוסח אינו הדלקה. `UPDATE` אחד שנוגע
 *    ‏גם ב-`enabled` היה מדוור לכל המאגר ברגע ששלב ב׳ נוחת.
 */

const SQL = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "prisma",
    "migrations",
    "20260908090000_funnel_copy_drafts",
    "migration.sql",
  ),
  "utf8",
);

/** ‏הטקסט שבין תוחמי ה-dollar quoting — כלומר הנוסחים עצמם. */
function copyBlocks(): string[] {
  return [...SQL.matchAll(/\$copy\$([\s\S]*?)\$copy\$/gu)].map((m) => m[1] ?? "");
}

describe("‏טיוטות הנוסח של מסלול ההמרה", () => {
  it("יש נוסחים לבדוק (אחרת הבדיקה ירוקה על כלום)", () => {
    /* ‏ארבעה-עשר שלבים × חמישה שדות */
    expect(copyBlocks().length).toBe(14 * 5);
  });

  it("כל הנוסחים משתמשים רק במצייני מקום שיש להם מימוש", () => {
    const offenders = copyBlocks()
      .flatMap((text) => unknownFunnelPlaceholders(text))
      .filter((name, i, all) => all.indexOf(name) === i);
    expect(offenders).toEqual([]);
  });

  /**
   * ‎**המיגרציה נוגעת בתוכן בלבד.**
   *
   * ‏זו הטענה שמפרידה בין „מילאתי נוסח” לבין „התחלתי לדוור”.
   */
  it("המיגרציה אינה נוגעת ב-enabled ולא בתבנית הוואטסאפ", () => {
    expect(SQL).not.toMatch(/"enabled"\s*=/u);
    expect(SQL).not.toMatch(/"whatsapp_template"\s*=/u);
  });

  /** ‏נתיב הכפתור יחסי — כתובת מלאה נשברת בכל העברה בין סביבות. */
  it("כל נתיבי הכפתורים יחסיים", () => {
    const paths = [...SQL.matchAll(/"cta_path"\s*=\s*\$copy\$([\s\S]*?)\$copy\$/gu)].map(
      (m) => m[1] ?? "",
    );
    expect(paths.length).toBe(14);
    for (const path of paths) {
      expect(path.startsWith("/"), `נתיב שאינו יחסי: ${path}`).toBe(true);
      expect(path.startsWith("//"), `נתיב פרוטוקול-יחסי: ${path}`).toBe(false);
    }
  });
});
