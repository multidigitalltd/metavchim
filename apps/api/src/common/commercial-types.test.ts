import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { COMMERCIAL_PROPERTY_TYPES, PropertyTypeSchema } from "@metavchim/shared";

/**
 * ‎**סוג נכס חי בחמש טבלאות שנכתבות ביד — ואחת מהן תמיד נשכחת.**
 *
 * זה כבר קרה כאן: `propertyTypes` היה במודל ולא היה מסך להזין
 * אותו, ו-`floor` היה בקריטריונים בלי משקל ובלי תווית. הפיצול
 * המסחרי נוגע בכל אחת מהטבלאות, ולכן הן נבדקות מול **הסכימה** ולא
 * מול רשימה מקבילה.
 *
 * שתיים מהן כבר מוגנות בטיפוסים (`satisfies Record<PropertyType,…>`
 * בקטלוג הסוכן ובתוויות הווב) — הן ייפלו בקומפילציה. השאר לא.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const SHARED = (path: string): string =>
  read(new URL(`../../../../packages/shared/src/${path}`, import.meta.url));
const WEB = (path: string): string => read(new URL(`../../../web/src/${path}`, import.meta.url));

describe("נכס מסחרי — תשעת הענפים מגיעים לכל מקום", () => {
  it.each([...COMMERCIAL_PROPERTY_TYPES])("%s — קיים בייצוא ובייבוא CSV", (branch) => {
    /*
     * ‎**ייצוא-וייבוא חוזר.** קובץ שיוצא עם „חנות” ונטען חזרה בלי
     * הענף היה חוזר כ„אחר” — כלומר המשרד מאבד את הסוג בפעולה
     * שנועדה לשמר אותו.
     */
    expect(SHARED("logic/csv-import.ts")).toContain(`"${branch}"`);
  });

  /*
   * ‎**„מסחרי” נשאר ממופה.** קובץ שיוצא לפני הפיצול נושא „מסחרי”,
   * וטעינה חוזרת שלו חייבת להמשיך לעבוד.
   */
  it("ו„מסחרי” הישן ממשיך להיטען", () => {
    expect(SHARED("logic/csv-import.ts")).toMatch(/מסחרי: "commercial"/u);
  });

  /*
   * ‎**המנוע קורא את הכלל ולא `includes` ישיר.** זה הפער שהיה
   * מנתק כל קונה קיים שסימן „מסחרי” מכל נכס מסחרי חדש.
   */
  it("מנוע ההתאמות עובר דרך propertyTypeMatches", () => {
    const engine = SHARED("logic/matching.ts");
    expect(engine).toContain("propertyTypeMatches(buyer.propertyTypes, property.propertyType)");
    expect(engine, "חזר ל-includes ישיר").not.toMatch(
      /buyer\.propertyTypes\.includes\(property\.propertyType\)/u,
    );
  });

  /*
   * ‎**הקבוצה במסך נגזרת מהתחילית**, ולכן ענף חדש נכנס לבורר מעצמו.
   * רשימה מקבילה כאן הייתה משאירה ענף חדש מחוץ לקבוצה — או, גרוע
   * מזה, מחוץ לבורר.
   */
  it("הבורר מקבץ לפי התחילית ולא לפי רשימה כתובה", () => {
    const format = WEB("lib/format.ts");
    expect(format).toMatch(/value === "commercial" \|\| value\.startsWith\("commercial_"\)/u);
    expect(format).toContain('label: "מסחרי"');
  });

  it.each([
    ["app/properties/new/page.tsx", "נכס חדש"],
    ["app/properties/[id]/edit/page.tsx", "עריכת נכס"],
    ["app/leads/convert-sections.tsx", "המרת ליד"],
    ["app/buyers/property-types-field.tsx", "דרישות קונה"],
  ])("%s — משתמש בבורר המקובץ", (path) => {
    expect(WEB(path)).toContain("<PropertyTypeOptions");
  });

  /*
   * ‎**וקבוצה ריקה נעלמת.** בבורר של הקונה הערכים שנבחרו יורדים
   * מהרשימה; „מסחרי” בלי ענפים מתחתיו הוא כותרת שאי אפשר לבחור
   * בה דבר.
   */
  it("וקבוצה שהתרוקנה אינה נשארת ככותרת ריקה", () => {
    expect(WEB("app/property-type-options.tsx")).toMatch(
      /\.filter\(\(group\) => group\.options\.length > 0\)/u,
    );
  });

  /*
   * ‎**הקול מזהה את הענף ולא רק „מסחרי”.** מתווך שאומר „יש לי
   * חנות” אמר משהו מדויק, ושמירת המטרייה במקומו מאבדת בדיוק את מה
   * שנאמר.
   */
  it.each([["חנות"], ["משרד"], ["מחסן"], ["מרתף"], ["תחנת דלק"]])(
    "חילוץ מהקול מזהה „%s”",
    (word) => {
      expect(SHARED("logic/extract-property.ts")).toContain(word);
    },
  );

  /* שער על השער: הרשימה נגזרת מהסכימה, ולכן ענף חדש נכנס לכולן */
  it("והרשימה שהבדיקה רצה עליה היא זו שבסכימה", () => {
    const fromSchema = PropertyTypeSchema.options.filter((v) => v.startsWith("commercial_"));
    expect([...COMMERCIAL_PROPERTY_TYPES].sort()).toEqual([...fromSchema].sort());
  });
});
