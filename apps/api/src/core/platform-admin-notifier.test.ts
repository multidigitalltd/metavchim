import { describe, expect, it } from "vitest";

import { platformAdminRecipients } from "./platform-admin-notifier.service";

describe("נמעני התראת הפלטפורמה", () => {
  it("מאחד את המנהלים עם הכתובות הנוספות", () => {
    expect(platformAdminRecipients(["a@x.co.il", "b@x.co.il"], ["desk@x.co.il"])).toEqual([
      "a@x.co.il",
      "b@x.co.il",
      "desk@x.co.il",
    ]);
  });

  /*
   * ‎**כתובת התמיכה היא לרוב גם כתובת של מנהל.** בלי איחוד היה מגיע
   * לשם אותו מייל פעמיים — בדיוק הצורה שגורמת לאנשים לכבות התראות.
   */
  it("כתובת שמופיעה פעמיים מקבלת עותק אחד", () => {
    expect(platformAdminRecipients(["a@x.co.il"], ["a@x.co.il"])).toEqual(["a@x.co.il"]);
  });

  it("רישיות אינה יוצרת נמען שני", () => {
    expect(platformAdminRecipients(["a@x.co.il"], [" A@X.co.il "])).toEqual(["a@x.co.il"]);
  });

  /*
   * ההגדרה מגיעה ממי שהקליד אותה במסך, ולכן היא יכולה להיות ריקה,
   * לא מוגדרת, או טקסט שאינו כתובת. שליחה לכזו נכשלת אצל הספק —
   * כלומר קריאת רשת מיותרת ושורת אזהרה ביומן על כל פנייה.
   */
  it("ריק, `undefined` ומה שאינו כתובת אינם נמענים", () => {
    expect(platformAdminRecipients([], ["", null, undefined, "לא כתובת"])).toEqual([]);
  });

  /*
   * ‎**הכתובת נשמרת כפי שנראתה.** החלק שלפני ה-`@` רגיש לרישיות
   * רשמית; איחוד הוא סיבה לזהות כפילות, לא רשות לשנות כתובת.
   */
  it("הכתובת המקורית היא זו שנשלחת", () => {
    expect(platformAdminRecipients([], ["Dana.Levi@X.co.il"])).toEqual(["Dana.Levi@X.co.il"]);
  });
});
