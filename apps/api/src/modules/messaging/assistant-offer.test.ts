import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**„כן” על מה שהסוכן הרגע הציע — החיווט.**
 *
 * הכללים עצמם נבדקים בהתנהגות ב-`shared/agent/offer.test.ts`. מה
 * שנשאר כאן הוא הסדר בתוך השירות, שאין עליו קומפיילר: שההצעה
 * נלכדת בזמן הרינדור, שהיא נשמרת על התור, ושהיא נבדקת **אחרי**
 * ההצעה הממתינה ולא לפניה.
 */

const SERVICE = readFileSync(
  new URL("./whatsapp-assistant.service.ts", import.meta.url),
  "utf8",
);

describe("ההצעה שהסוכן העלה", () => {
  it("נלכדת מצעד ההמשך — אותו משפט שהכפתור נושא", () => {
    expect(SERVICE).toContain("if (steps[0] !== undefined) offer = steps[0].text;");
    // גם רשת הביטחון המנוסחת, שנפלטת דווקא כשאין צעדים
    expect(SERVICE).toContain('case "suggestion":\n          offer = segment.text;');
  });

  it("נשמרת על התור, ולכן שורדת עד ההודעה הבאה", () => {
    expect(SERVICE).toContain("...(offer === undefined ? {} : { offer }),");
  });

  /*
   * ‎**הסדר הוא ההתנהגות.** „כן” על הצעה ממתינה הוא אישור ביצוע
   * (`awaiting: "confirm"`), ורק בהיעדרה הוא הסכמה להצעת המשך.
   * היפוך הסדר היה גורם ל„כן” להריץ שאילתה במקום לאשר פעולה
   * שהמתווך כבר ראה ואישר.
   */
  it("נבדקת רק כשאין הצעה ממתינה", () => {
    const confirmAt = SERVICE.indexOf('pending.awaiting === "confirm" && isConfirmMessage(text)');
    const offerAt = SERVICE.indexOf("const offered = isConfirmMessage(text) ? lastOffer(");
    expect(confirmAt).toBeGreaterThan(0);
    expect(offerAt, "ההצעה הממתינה קודמת").toBeGreaterThan(confirmAt);
  });

  /*
   * המשפט מוזרם למנוע כאילו הוקלד — אותו מסלול של כפתור ההמשך.
   * מסלול ביצוע שני היה עוקף את האישור שפעולה שכותבת דורשת.
   */
  it("המשפט מוזרם למנוע ואינו מבוצע ישירות", () => {
    const branch = SERVICE.slice(
      SERVICE.indexOf("const offered = isConfirmMessage(text) ? lastOffer("),
      SERVICE.indexOf("return withHeard(await this.propose(chat, text, null, speaker), heard);"),
    );
    expect(branch).toContain("this.propose(chat, offered, null, speaker)");
    expect(branch, "ביצוע ישיר עוקף את האישור").not.toContain("runProposal");
  });
});
