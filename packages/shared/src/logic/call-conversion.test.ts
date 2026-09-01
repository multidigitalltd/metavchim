import { describe, expect, it } from "vitest";
import { callConversionHint } from "./call-conversion.js";
import type { CallHighlights } from "./call-summary.js";

const hint = (side?: CallHighlights["side"]): ReturnType<typeof callConversionHint> =>
  callConversionHint(side === undefined ? {} : { side });

describe("מה השיחה אומרת על ההמשך", () => {
  /*
   * ‎**זו ההבחנה שמשנה את כל העבודה שאחריה:** למי שמחפש שולחים
   * נכסים, ממי שמוכר מבקשים בלעדיות. סדר הפוך מציב את הטופס הלא
   * נכון ראשון בדיוק כשהמתווך זוכר את השיחה הכי טוב.
   */
  it("מוכר ומשכיר — המרה לנכס ראשונה", () => {
    expect(hint("seller").sellerFirst).toBe(true);
    expect(hint("landlord").sellerFirst).toBe(true);
  });

  it("קונה ושוכר — המרה לקונה ראשונה", () => {
    expect(hint("buyer").sellerFirst).toBe(false);
    expect(hint("renter").sellerFirst).toBe(false);
  });

  /*
   * שיחה בלי זיהוי צד היא ברוב המכריע פנייה של מחפש, וזה גם המסלול
   * הנפוץ יותר. חשוב מזה: היא אינה מוצגת כאילו זוהה בה משהו.
   */
  it("בלי זיהוי — קונה ראשון, ובלי משפט", () => {
    expect(hint(undefined)).toEqual({ sellerFirst: false, sentence: "" });
    expect(callConversionHint(undefined)).toEqual({ sellerFirst: false, sentence: "" });
  });

  /*
   * ‎**שכירות נגזרת, קנייה לא.** „קונה” הוא כבר ברירת המחדל של
   * הטופס, וקביעה מפורשת שלו הייתה מוחקת את ההבחנה בין „השיחה
   * אמרה” לבין „לא זוהה דבר”.
   */
  it("שוכר ומשכיר גוררים שכירות; קונה ומוכר אינם גוררים דבר", () => {
    expect(hint("renter").dealType).toBe("rent");
    expect(hint("landlord").dealType).toBe("rent");
    expect(hint("buyer").dealType).toBeUndefined();
    expect(hint("seller").dealType).toBeUndefined();
  });

  /*
   * ‎**המשפט אומר מה זוהה — ומיד מוסר את ההחלטה למתווך.** זיהוי
   * אוטומטי טועה לפעמים, וניסוח שמציג אותו כעובדה גורם לאנשים
   * ללכת אחריו גם כשהם יודעים אחרת.
   */
  it("המשפט נאמר בלשון המתווך ומשאיר לו את ההכרעה", () => {
    expect(hint("seller").sentence).toBe("הלקוח מוכר נכס — אבל ההחלטה שלכם.");
    expect(hint("renter").sentence).toBe("הלקוח מחפש לשכור — אבל ההחלטה שלכם.");
  });

  /* כל צד מוכר מקבל משפט — צד שנוסף בלי ניסוח היה מציג את שם השדה. */
  it("לכל צד יש ניסוח", () => {
    for (const side of ["buyer", "renter", "seller", "landlord"] as const) {
      expect(hint(side).sentence, side).not.toBe("");
      expect(hint(side).sentence, side).not.toContain(side);
    }
  });
});
