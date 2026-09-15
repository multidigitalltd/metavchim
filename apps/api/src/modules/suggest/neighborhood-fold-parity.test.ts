import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DASHES, PREFIX, QUOTES, WHITESPACE } from "./neighborhood-vocabulary";

/**
 * ‎**הקיפול שבמיגרציה מול הקיפול שרץ — ולמה הפער הזה שקט.**
 *
 * ‏מפתחות השכונות של הקונה יושבים בעמודה (`buyers.neighborhood_keys`),
 * ‏ונכתבים משני צדדים: הקוד כותב אותם בכל שמירה, והמיגרציה מילאה
 * ‏אותם פעם אחת לכל מה שכבר היה במסד. שני הצדדים חייבים לקפל בדיוק
 * ‏אותו דבר — אחרת קונה ותיק והקונה שנשמר היום נושאים שני מפתחות
 * ‏שונים לאותה שכונה, והסינון מוצא רק אחד מהם.
 *
 * ## למה שער ולא הערה
 *
 * ‏מיגרציה היא היסטוריה ואינה רצה שוב. מי שיתקן בעתיד את הקיפול
 * ‏החי לא יראה שום שגיאה: הכתיבות החדשות יהיו נכונות, והשורות
 * ‏הישנות יישארו עם המפתח הישן — כלומר קונים שנעלמים מהסינון בלי
 * ‏שאיש שינה בהם דבר. השער נשבר בדיוק שם, והתיקון הנכון הוא
 * ‏מיגרציה חדשה שממלאת מחדש.
 *
 * ## ומה עם הזהות מול JavaScript
 *
 * ‏שלוש המחלקות האלה נבדקות מול `neighborhoodKey` של החבילה
 * ‏המשותפת ב-`neighborhood-vocabulary.int.test.ts`, מול מסד אמיתי.
 * ‏כאן נבדק רק שהעותק הקפוא במיגרציה זהה לחי — ההשוואה השנייה כבר
 * ‏מכוסה.
 */

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20260914210000_buyer_neighborhood_keys/migration.sql",
);

describe("‏הקיפול במיגרציה זהה לקיפול החי", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it.each([
    ["רווחים", WHITESPACE],
    ["גרשיים", QUOTES],
    ["מקפים", DASHES],
    ["הקידומת", PREFIX],
  ])("‏מחלקת %s מופיעה במיגרציה מילה במילה", (_name, expression) => {
    expect(sql).toContain(`'${expression}'`);
  });

  /*
   * ‏שני מקורות ⟵ שני קיפולים. אחד מהם בלבד היה משאיר חצי מהמפתחות
   * ריקים בשורות הישנות: שכונות שהוקלדו כן, ושמות נעיצות לא.
   */
  it("‏מקפל את שני המקורות", () => {
    expect(sql).toContain("'neighborhoods'");
    expect(sql).toContain("'searchAreas'");
    expect(sql.split("lower(btrim(regexp_replace(").length - 1).toBe(2);
  });

  /*
   * ‎**שורה פגומה אחת אינה מפילה מיגרציה.** `jsonb_array_elements`
   * ‏על ערך סקלרי זורק, וקונה בודד שאצלו השדה אינו מערך — ייבוא
   * ישן, תיקון ידני — היה עוצר את ההגירה של כל המערכת.
   */
  it("‏שני המקורות מוגנים ב-jsonb_typeof", () => {
    expect(sql.split("jsonb_typeof(").length - 1).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ‎**מה שאפשר לסנן לפיו חייב להיות מוצע.**
 *
 * ‏הבורר בעמוד הקונים שואב מאוצר השכונות, והסינון עצמו עובד על
 * ‏העמודה. אם השניים יקראו ממקורות שונים, תיווצר שכונה שהסינון
 * ‏מוצא והבורר לעולם אינו מציע — סינון שרק מי שמנחש את השם המדויק
 * ‏יוכל להפעיל, וזו בדיוק חוויית ה„לא עובד” שאין עליה שגיאה.
 */
describe("‏האוצר קורא את אותם שני מקורות כמו העמודה", () => {
  const vocabulary = readFileSync(join(__dirname, "neighborhood-vocabulary.ts"), "utf8");

  it("‏גם השכונות המוקלדות וגם שמות הנעיצות", () => {
    expect(vocabulary).toContain("b.requirements -> 'neighborhoods'");
    expect(vocabulary).toContain("b.requirements -> 'searchAreas'");
  });

  /* ‏וצמצום העיר חל על שניהם — הוא מוגדר פעם אחת ומורכב לשניהם */
  it("‏וצמצום העיר מוגדר פעם אחת ומשמש את שניהם", () => {
    expect(vocabulary.split("const buyerCity = ").length - 1).toBe(1);
    expect(vocabulary.split("${buyerCity}").length - 1).toBe(2);
  });
});
