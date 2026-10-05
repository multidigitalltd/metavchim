import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**השלמת העיר יושבת בנקודת ההתמדה, ולא אצל הקורא.**
 *
 * ‏שלושה מסלולים מגיעים בלי עיר — ייבוא אקסל, הסוכן בוואטסאפ,
 * ‏וחילוץ מצילום או מהקלטה — ו**אף אחד מהם אינו עובר בטופס**.
 * ‏תיקון בצד הקורא היה מכסה קורא אחד ומשאיר את הבא בתור פתוח,
 * ‏וזה בדיוק הדפוס שחוזר בקוד הזה. `persist` הוא המקום היחיד
 * ‏שכל יצירת נכס עוברת בו.
 *
 * ‏שער על **טקסט המקור**, כי אין כאן שגיאת קומפילציה: הסרת
 * ‏הקריאה משאירה קוד תקין שפשוט אינו משלים דבר.
 */
const service = readFileSync(join(__dirname, "properties.service.ts"), "utf8");
const importer = readFileSync(
  join(__dirname, "../import/import.controller.ts"),
  "utf8",
);

describe("השלמת עיר מהשכונה", () => {
  it("נקראת בתוך persist, ולא אצל קורא בודד", () => {
    const persist = service.slice(service.indexOf("private async persist("));
    expect(persist).toContain("withCompletedCity(input.fields)");
  });

  it("רצה לפני הגיאוקודינג — הכתובת שנשלחת לספק נושאת גם את העיר", () => {
    const call = service.indexOf("withGeocodedLocation(\n      await this.withCompletedCity");
    expect(call).toBeGreaterThan(-1);
  });

  it("אינה פונה למסד כשיש עיר או כשאין שכונה", () => {
    const fn = service.slice(service.indexOf("private async withCompletedCity"));
    const body = fn.slice(0, fn.indexOf("private async withGeocodedLocation"));
    /* ‏שתי יציאות מוקדמות לפני כל קריאה למסד. */
    expect(body.indexOf("return fields;")).toBeLessThan(body.indexOf("cityForNeighborhood"));
    expect(body).toContain('fields.city.trim() !== ""');
    expect(body).toContain('neighborhood.trim() === ""');
  });

  it("אין תשובה ⇒ השדה נשאר ריק, בלי ניחוש", () => {
    const fn = service.slice(service.indexOf("private async withCompletedCity"));
    expect(fn.slice(0, 1200)).toContain("city === null ? fields");
  });

  /*
   * ‎**אצווה אינה תלויה בסדר השורות** (ביקורת Codex, P1).
   *
   * ‏הייבוא כותב שורה-שורה, ולכן שורה בלי עיר שקדמה לשורה שנושאת
   * ‏את העיר של אותה שכונה לא יכלה לראות אותה — ואותו קובץ בדיוק
   * ‏נקלט אחרת לפי סדר השורות בו. הסבב שאחרי הלולאה מבטל את זה.
   */
  it("הייבוא מריץ סבב השלמה אחרי הלולאה, לא בתוכה", () => {
    const loopEnd = importer.indexOf("return { created, failed, warnings };");
    expect(loopEnd).toBeGreaterThan(-1);
    const sweep = importer.indexOf("completeMissingCitiesFor(createdIds)");
    expect(sweep).toBeGreaterThan(-1);
    /* ‏אחרי הלולאה ולפני ההחזרה. */
    expect(sweep).toBeLessThan(loopEnd);
  });

  it("הסבב מחשב התאמות מחדש למי שהושלם", () => {
    const fn = service.slice(service.indexOf("async completeMissingCitiesFor("));
    const body = fn.slice(0, fn.indexOf("private async withCompletedCity"));
    /*
     * ‏בלי עיר `recomputeForProperty` יצא מוקדם, ולכן הנכס נשמר
     * ‏בלי ולו התאמה אחת. השלמה בלי חישוב חוזר הייתה מתקנת את
     * ‏הכרטיס ומשאירה אותו מחוץ להתאמות.
     */
    expect(body).toContain("recomputeForProperty(row.id)");
  });
});
