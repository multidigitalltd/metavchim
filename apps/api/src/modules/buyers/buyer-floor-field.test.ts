import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**שדה שאפשר למלא, ואי אפשר לראות, ואיש אינו קורא.**
 *
 * זה הכשל שהמערכת הזו כבר ספגה פעם: `propertyTypes` היה במודל,
 * מנוע ההתאמות פסל לפיו, ציון המוכנות ספר אותו — ולא היה מסך אחד
 * שבו אפשר להזין אותו. וב-`MATCH_CRITERIA` היה `floor` בלי משקל,
 * בלי תווית ובלי קוד שמייצר אותו.
 *
 * „קומה רצויה” נוגעת בדיוק באותן ארבע נקודות, ולכן היא נשמרת
 * בארבעתן:
 *
 * 1. ‎**שני הטפסים** — יצירה ועריכה. טופס אחד בלבד פירושו שדה
 *    שנשאל אחרי שהשיחה עם הלקוח נגמרה, ובפועל אינו ממולא.
 * 2. ‎**שני הטפסים שולחים אותו** — רכיב שמצויר ולא נקרא מה-`FormData`
 *    הוא שדה שנראה עובד ואינו נשמר.
 * 3. ‎**הכרטיס מציג** — אחרת אין דרך לדעת מה נשמר.
 * 4. ‎**המנוע קורא** — אחרת זו הערה, לא דרישה.
 */

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const WEB = (path: string): string => read(`../../../../web/src/app/${path}`);
const SHARED = (path: string): string => read(`../../../../../packages/shared/src/${path}`);

describe("קומה רצויה — השדה קיים בכל ארבע הנקודות", () => {
  it.each([
    ["buyers/new/page.tsx", "טופס קונה חדש"],
    ["buyers/[id]/edit/page.tsx", "טופס עריכת קונה"],
  ])("%s — מצייר את השדה **וגם** קורא אותו", (path) => {
    const src = WEB(path);
    expect(src, "הרכיב אינו מצויר").toMatch(/<FloorPreferenceField/u);
    /*
     * ‎**הקריאה מה-`FormData`, ולא רק ה-`import`.** רכיב שמצויר
     * ושדהו אינו נקרא בשליחה הוא שדה שהמתווך ממלא ושנעלם — הכשל
     * הכי שקט שיש, כי המסך נראה תקין.
     */
    expect(src, "הערך אינו נשלח").toMatch(
      /floorPreference: readFloorPreference\(f\.get\("floorPreference"\)\)/u,
    );
  });

  it("כרטיס הקונה מציג את מה שנשמר", () => {
    const card = WEB("buyers/[id]/page.tsx");
    expect(card).toContain("floorPreferenceText(");
    expect(card).toContain("קומה רצויה");
  });

  /*
   * ‎**והמנוע קורא.** בלי הענף הזה השדה הוא הערה חופשית: המתווך
   * מסמן „קרקע או ראשונה”, וההתאמות ממשיכות להציע קומה שביעית.
   */
  it("מנוע ההתאמות קורא אותו, ולא רק שומר", () => {
    const engine = SHARED("logic/matching.ts");
    expect(engine).toContain("floorMatches(buyer.floorPreference, property.floor)");
    expect(engine).toMatch(/criterion: "floor"/u);
  });

  /*
   * ‎**קריטריון בלי משקל או בלי תווית** הוא בדיוק מה שהוציא את
   * ‎`floor` מהרשימה בפעם הקודמת: צ׳יפ ריק על המסך, וציון שנשען על
   * ‎`undefined`. הטיפוסים אוכפים את זה בקומפילציה — והבדיקה כאן
   * אומרת למה, כדי שמי שימחק לא יחשוב שזה נוי.
   */
  it("ויש לו משקל ותווית", () => {
    const engine = SHARED("logic/matching.ts");
    expect(engine).toMatch(/floor: 0\.05,/u);
    expect(engine).toMatch(/floor: "קומה",/u);
  });

  /*
   * ‎**ואינו פוסל.** „קרקע או ראשונה” היא העדפה חזקה ולא תנאי, ונכס
   * בקומה שנייה מצוין בכל השאר צריך להישאר ברשימה. הוספתו לאחת
   * משלוש הרשימות הפוסלות הייתה מעלימה התאמות בשקט.
   */
  it.each([
    ["HARD_MATCH_CRITERIA"],
    ["MANDATORY_MATCH_CRITERIA"],
    ["CORE_MATCH_CRITERIA"],
  ])("ואינו נכנס ל-%s", (listName) => {
    const engine = SHARED("logic/matching.ts");
    const start = engine.indexOf(`export const ${listName}`);
    expect(start, `${listName} לא נמצאה`).toBeGreaterThan(-1);
    const list = engine.slice(start, engine.indexOf("];", start));
    expect(list).not.toContain('"floor"');
  });
});
