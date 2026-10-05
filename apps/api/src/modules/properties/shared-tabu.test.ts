import { describe, expect, it } from "vitest";
import { PropertyFieldsSchema } from "@metavchim/shared";
import { fieldsToColumns, rowToFields } from "./property.mapper";

/**
 * ‎**„טאבו משותף” (מושאע) — עובדה משפטית, ולכן שדה ולא מאפיין.**
 *
 * ‏רישום בטאבו משותף משנה את כל אופן העסקה: אין חלקה נפרדת, נדרשת
 * ‏הסכמת שותפים, והמימון מורכב יותר. מתווך שמגלה את זה בשלב מתקדם
 * ‏מגלה שהעסקה שבנה אינה אפשרית בצורה שתכנן (בקשת בעל המוצר).
 *
 * ## ‏למה `false` ולא `null`
 *
 * ‏חמשת המאפיינים (מעלית, חניה…) הם „כן / לא / טרם נשאל”, כי הם
 * ‏נאספים בהדרגה. הסימון הזה הוא פעולה של המתווך: או שהוא סימן, או
 * ‏שלא. מצב שלישי „טרם נבדק” הוא מצב שאיש אינו מתחזק, והעמודה
 * ‏`NOT NULL DEFAULT false` בהתאם — ולכן גם המיפוי חייב להיזהר
 * ‏לא להחזיר `null` לעמודה שאינה מקבלת אותו.
 */

describe("טאבו משותף — הנתיב מהמסך אל העמודה", () => {
  it("הסכימה מקבלת את השדה, ומתעלמת ממנו כשלא נשלח", () => {
    expect(PropertyFieldsSchema.safeParse({ sharedTabu: true }).success).toBe(true);
    expect(PropertyFieldsSchema.safeParse({ sharedTabu: false }).success).toBe(true);
    expect(PropertyFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("ולא ערך שאינו בוליאני", () => {
    expect(PropertyFieldsSchema.safeParse({ sharedTabu: "כן" }).success).toBe(false);
  });

  /*
   * ‏העמודה `NOT NULL`, ולכן „נשלח בלי ערך” חייב ליפול ל-`false`
   * ‏ולא ל-`null`. מיפוי שמעביר `null` נדחה במסד — כלומר שמירה
   * ‏שנכשלת על שדה שהמתווך בכלל לא נגע בו.
   */
  it("„נשלח ריק” נכתב כ-false ולא כ-null", () => {
    expect(fieldsToColumns({ sharedTabu: true }).sharedTabu).toBe(true);
    expect(fieldsToColumns({ sharedTabu: false }).sharedTabu).toBe(false);
    expect(fieldsToColumns({ sharedTabu: undefined }).sharedTabu).toBe(false);
  });

  /* ‏ומה שלא נשלח כלל אינו נכתב — `PATCH` חלקי אינו דורס */
  it("ומה שלא נשלח כלל אינו נכתב", () => {
    expect("sharedTabu" in fieldsToColumns({ city: "רעננה" })).toBe(false);
  });

  /*
   * ‏בקריאה הוא חוזר כפי שהוא, בלי `?? undefined`: `false` הוא
   * ‏תשובה ולא היעדר, והמרתו ל-`undefined` הייתה מוחקת את ההבחנה
   * ‏בין „נבדק ואינו משותף” לבין „אין נתון”.
   */
  it("ובקריאה `false` חוזר כ-false ולא כ-undefined", () => {
    const row = { sharedTabu: false } as never;
    expect(rowToFields(row).sharedTabu).toBe(false);
    expect(rowToFields({ sharedTabu: true } as never).sharedTabu).toBe(true);
  });
});
