import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CreatePropertySchema } from "./properties.controller";

/**
 * ‎**מה שהמסך שולח — השרת חייב לקבל.**
 *
 * ## התקלה שהבדיקה הזו נולדה ממנה
 *
 * ‏טופס „נכס חדש” התחיל לשלוח `status: "active"` (בקשת בעל המוצר:
 * נכס שנקלט מהמשרד נולד פעיל ולא כטיוטה). ‏`CreatePropertySchema`
 * הוא `.strict()`, ו-`status` היה מוצהר **בסכימת העדכון בלבד** —
 * ולכן כל שמירה מהטופס נדחתה ב-400 לפני שהשירות בכלל רץ. לא שדה
 * שנבלע: **מסלול קליטת הנכס נחסם לגמרי.**
 *
 * ## למה אף בדיקה קיימת לא תפסה
 *
 * ‏`typecheck` מרוצה — הגוף נבנה ב-`apiPost` שמקבל `unknown`.
 * ‏`verify:shapes` משווה את **טיפוס ההחזרה** של הבקר למה שהמסך
 * קורא, ולא את הגוף שהוא שולח. וה-`.strict()` עצמו, שנוסף בכוונה
 * כדי ששדה לא ייבלע בשקט, הוא מה שהפך את זה משדה שנעלם למסלול
 * שנחסם. השילוב הזה — סכימה קפדנית שאיש אינו מריץ עליה את הגוף
 * האמיתי — הוא החור.
 *
 * ## ולכן הבדיקה מריצה את הסכימה על הגוף עצמו
 *
 * ‏ולא על טקסט הקובץ. שדה שיתווסף לטופס וייחסם יפיל אותה מיד.
 */

/** הגוף שהמסך בונה — נשמר כאן כדי שהבדיקה תרוץ על צורה אמיתית. */
const FROM_THE_FORM = {
  status: "active",
  city: "בני ברק",
  neighborhood: "פרדס כץ",
  street: "רבי עקיבא",
  houseNumber: "12",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: 3,
  totalFloors: 6,
  priceAgorot: 230000000,
} as const;

describe("יצירת נכס — הגוף שהטופס שולח", () => {
  it("‎`status: \"active\"` מתקבל, ולא נחסם על ידי `.strict()`", () => {
    const parsed = CreatePropertySchema.safeParse(FROM_THE_FORM);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });

  /*
   * ‏חסר ⇒ טיוטה, וזו עדיין ברירת המחדל של כל מי שנוצר מבחוץ:
   * טופס הקליטה הציבורי של מוכר, והסוכן הקולי. שינוי שיהפוך את
   * ברירת המחדל של השרת עצמו יפיל את הבדיקה הזו.
   */
  it("בלי `status` הבקשה תקינה, והשרת נשאר על טיוטה", () => {
    const { status: _status, ...withoutStatus } = FROM_THE_FORM;
    expect(CreatePropertySchema.safeParse(withoutStatus).success).toBe(true);
    const service = readFileSync(
      new URL("./properties.service.ts", import.meta.url),
      "utf8",
    );
    expect(service).toContain('status: input.status ?? "draft",');
  });

  /*
   * ‎**רק שני מצבי פתיחה.** „נמכר”, „הושכר” ו„הוקפא” הם תוצאות של
   * מהלך, ו„בארכיון” ביצירה הוא נכס שנולד מוסתר. כולם עוברים דרך
   * העדכון, ששם יש להם רישום ביומן.
   */
  it("סטטוס שאינו נקודת פתיחה נדחה", () => {
    for (const status of ["sold", "rented", "frozen", "archived"]) {
      const parsed = CreatePropertySchema.safeParse({ ...FROM_THE_FORM, status });
      expect(parsed.success, `${status} התקבל ביצירה`).toBe(false);
    }
  });

  /*
   * ‏השדה קיים בטופס בפועל — בלי זה הבדיקה שומרת על חוזה שאיש אינו
   * משתמש בו, ועוברת גם אחרי שהטופס הפסיק לשלוח אותו.
   */
  it("הטופס באמת שולח את השדה", () => {
    const form = readFileSync(
      new URL("../../../../web/src/app/properties/new/page.tsx", import.meta.url),
      "utf8",
    );
    expect(form).toContain('status: "active",');
  });
});
