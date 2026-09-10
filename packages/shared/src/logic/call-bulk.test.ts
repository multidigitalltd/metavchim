import { describe, expect, it } from "vitest";
import {
  CALL_BULK_ACTIONS,
  CALL_BULK_LIMIT,
  callBulkConfirm,
  callBulkOutcome,
  callBulkRejectionReason,
} from "./call-bulk.js";

describe("התקרה", () => {
  it("בחירה ריקה נדחית — ועם סיבה", () => {
    expect(callBulkRejectionReason(0)).toContain("לא נבחרו");
  });

  it("ובחירה בגודל התקרה עוברת", () => {
    expect(callBulkRejectionReason(1)).toBeNull();
    expect(callBulkRejectionReason(CALL_BULK_LIMIT)).toBeNull();
  });

  /*
   * ‎**התקרה היא מה שהמסך יכול להציג.** `GET /calls` מוגבל ל-200,
   * ‏ולכן „הכול” אינו יכול לחרוג ממנה — ותקרה נמוכה ממנה הייתה
   * ‏דוחה בחירה חוקית לגמרי.
   */
  it("ומעליה — נדחית", () => {
    expect(callBulkRejectionReason(CALL_BULK_LIMIT + 1)).toContain(String(CALL_BULK_LIMIT));
  });
});

describe("האישור", () => {
  /*
   * ‎**מחיקת שיחה היא קשה, לא ארכיון.** „סימון לא רלוונטי” נשמע
   * ‏הפיך, והאישור הוא המקום היחיד לתקן את הרושם לפני שהוא עולה
   * ‏בנתונים.
   */
  it("מחיקה אומרת „לצמיתות” ונוקבת במספר", () => {
    const text = callBulkConfirm("delete", 12);
    expect(text).toContain("12");
    expect(text).toContain("לצמיתות");
  });

  /*
   * ‎**העברה מוציאה כרטיס מידיו של מישהו.** אישור שמזכיר רק את מי
   * ‏שמקבל מסתיר את חצי הפעולה שאי אפשר לראות מהמסך.
   */
  it("והעברה אומרת גם מי מפסיק לראות", () => {
    const text = callBulkConfirm("assign", 5, "דנה");
    expect(text).toContain("5");
    expect(text).toContain("דנה");
    expect(text).toContain("יפסיק לראות");
  });

  it("ופתיחת ליד אינה דורשת אישור", () => {
    expect(callBulkConfirm("open_lead", 5)).toBeNull();
  });

  it("ולכל פעולה יש הכרעה — הוספת פעולה בלי אישור תיפול בקומפילציה", () => {
    for (const action of CALL_BULK_ACTIONS) {
      expect(() => callBulkConfirm(action, 1)).not.toThrow();
    }
  });
});

describe("משפט התוצאה", () => {
  it("מספר אחד כשאין דילוגים", () => {
    expect(callBulkOutcome("delete", { done: 7 })).toBe("7 נמחקו");
  });

  /*
   * ‎**„כבר היה כך” אינו כישלון ואינו שינוי.** בלי המספר הנפרד הוא
   * ‏נספר באחד מהם ומשקר: „0 לידים נפתחו” על עשרים שיחות שכולן
   * ‏כבר נשאו ליד נקרא ככישלון מלא.
   */
  it("ושלושת המצבים כשיש", () => {
    expect(callBulkOutcome("open_lead", { done: 2, already: 18 })).toBe(
      "2 לידים נפתחו, 18 כבר היה להן ליד",
    );
    expect(callBulkOutcome("assign", { done: 4, already: 1, skipped: 2 })).toBe(
      "4 הועברו, 1 כבר היו אצלו, 2 דולגו",
    );
  });

  it("ואפס אינו מוזכר — שורה שאומרת „0 דולגו” היא רעש", () => {
    expect(callBulkOutcome("assign", { done: 3, already: 0, skipped: 0 })).toBe("3 הועברו");
  });
});
