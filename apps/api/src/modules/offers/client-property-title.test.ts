import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ‎**שם הנכס שיוצא ללקוח — כלל אחד לכל השולחים.**
 *
 * ‏שליחת הצעת נכס נפלה ל-`propertyType` הגולמי, ולכן לקוח קיבל
 * ‏מייל שנושאו „apartment — שם המשרד” (נמצא בבדיקת QA מול המערכת
 * ‏החיה). הצעת נכס ודף השוואה גזרו נוסחה אחרת, שקראה לכל נכס
 * ‏„דירה”. עכשיו שניהם קוראים ל-`clientPropertyTitle` מהחבילה
 * ‏המשותפת, שם גם נבדקת ההתנהגות עצמה.
 */

const SENDERS = [
  { what: "‏הצעת נכס ודף השוואה", file: join(import.meta.dirname, "offers.service.ts") },
  { what: "‏שליחת הצעת נכס לקונים", file: join(import.meta.dirname, "..", "property-pitch", "property-pitch.service.ts") },
  { what: "‏דף הנחיתה של הנכס", file: join(import.meta.dirname, "..", "properties", "landing.service.ts") },
];

describe.each(SENDERS)("$what", ({ file }) => {
  const source = readFileSync(file, "utf8");

  it("בונה את השם דרך הכלל המשותף", () => {
    expect(source).toContain("clientPropertyTitle({");
  });

  it("אינו נופל לערך הגולמי ואינו גוזר שם משלו", () => {
    expect(source).not.toMatch(/\?\?\s*\w+\.propertyType/u);
    expect(source).not.toContain("דירת ${");
  });
});
