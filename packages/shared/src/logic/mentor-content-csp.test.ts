import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMBED_ORIGINS } from "./mentor-content";

/**
 * ‎**הפענוח וה-CSP חייבים להסכים — אחרת מסגרת ריקה בלי שגיאה.**
 *
 * ## ‏מה נמצא כשזה נכתב
 *
 * ‏ל-CSP של האפליקציה **לא הייתה `frame-src` בכלל**. משמעות הדבר
 * ‏ש-`default-src 'self'` חל גם על מסגרות, וסרטון יוטיוב היה נחסם
 * ‏— בשקט. לא הודעת שגיאה, לא כשלון טעינה שהמשתמש מזהה: מסגרת
 * ‏ריקה. המנהל היה מאשים את הכתובת שהדביק, ואיש לא היה מוצא את
 * ‏השורה החסרה במקום אחר לגמרי בקוד.
 *
 * ‏זו בדיוק אותה משפחה של תקלה כמו שדה `image` שלא הוכרז בסכימת
 * ‏הוובהוק: הפיצ'ר בנוי במלואו, ושער שאיש לא חשב עליו סוגר אותו.
 *
 * ## ‏למה הבדיקה כאן ולא בצד האתר
 *
 * ‏כי **הרשימה** יושבת כאן. מי שמוסיף ספק הטמעה עושה זאת ב-
 * ‎`EMBED_ORIGINS`, וזה הרגע שבו הוא צריך להיתקל בכך שגם ה-CSP
 * ‏צריך לדעת. בדיקה שיושבת ליד ה-CSP הייתה מתעוררת רק כשמישהו
 * ‏עורך את ה-CSP — כלומר אף פעם.
 */

const MIDDLEWARE = readFileSync(
  new URL("../../../../apps/web/src/middleware.ts", import.meta.url),
  "utf8",
);

describe("הטמעות המנטור מול ה-CSP", () => {
  it("יש הנחיית frame-src בכלל", () => {
    expect(
      MIDDLEWARE,
      "בלי frame-src חל default-src, וכל הטמעה נחסמת בשקט",
    ).toContain('"frame-src"');
  });

  /*
   * ‎**הרשימה נגזרת ואינה מועתקת.** העתקה הייתה מסכימה ביום
   * ‏שנכתבה: ספק שיתווסף לפענוח היה מתקבל, נשמר, ומוצג כמסגרת
   * ‏ריקה — כי ה-CSP לא ידע עליו.
   */
  it("frame-src נגזרת מ-EMBED_ORIGINS ולא מרשימה כתובה ביד", () => {
    expect(MIDDLEWARE).toMatch(/"frame-src":\s*\[\s*\.\.\.Object\.values\(EMBED_ORIGINS\)/u);
  });

  /*
   * ‏והצד השני: אם מישהו בכל זאת יחליף את הנגזרת ברשימה כתובה,
   * ‏הבדיקה הזו דורשת שכל מקור יופיע בה בשמו.
   */
  it.each(Object.entries(EMBED_ORIGINS))("המקור של %s מגיע ל-CSP", (kind, origin) => {
    const derived = /"frame-src":\s*\[\s*\.\.\.Object\.values\(EMBED_ORIGINS\)/u.test(MIDDLEWARE);
    expect(derived || MIDDLEWARE.includes(origin), `${kind}: ${origin}`).toBe(true);
  });

  /*
   * ‏מסגרת שנטענת מאיתנו היא הדרך להטמיע את המערכת באתר אחר
   * ‏ולהוציא ממנה נתונים בקליק שהמשתמש חושב שהוא שלנו. ההטמעה
   * ‏כאן היא **החוצה**, ואינה נוגעת בזה.
   */
  it("ואיש אינו מרשה להטמיע אותנו", () => {
    expect(MIDDLEWARE).toMatch(/"frame-ancestors":\s*\["'none'"\]/u);
  });
});
