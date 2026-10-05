import { describe, expect, it } from "vitest";
import { SHARED_TABU_PROPERTY_TYPE } from "@metavchim/shared";
import { fieldsToColumns } from "../properties/property.mapper";
import { RecruitmentService } from "./recruitment.service";
import type { PrismaService } from "../../core/prisma.service";
import type { PropertiesService } from "../properties/properties.service";

/**
 * ‎**הסוג הוותיק והדגל על שורת הגיוס — ולעולם לא סותרים**
 * ‏(ביקורת Codex, P2).
 *
 * ‏הסכימה מקבלת `propertyType: "shared_tabu"` בלי הדגל — דרך ה-API
 * ‏ודרך `/import/recruitment` — והעמודה נופלת אז ל-`false`. השורה
 * ‏נושאת סוג שאומר „מושאע” ודגל שאומר „לא”, וההמרה שולחת את הצירוף
 * ‏הזה ל-`fieldsToColumns` — שקורא אותו כ„פרישת הייצוג הישן” ומוחק
 * ‏את שניהם. נוצר נכס בלי סוג ובלי האזהרה המשפטית, והוא מוצע
 * ‏לקונים שסירבו במפורש.
 *
 * ‏שני צדדים, ואותה פונקציה משותפת (`isSharedTabuProperty`) בשניהם:
 * ‏הכתיבה מנרמלת, וההמרה גוזרת — כדי ששורה שנכתבה לפני התיקון לא
 * ‏תאבד את העובדה בהמרה.
 */

const service = new RecruitmentService(
  {} as unknown as PrismaService,
  {} as unknown as PropertiesService,
);

const priv = service as unknown as {
  writable: (
    input: Record<string, unknown>,
    current?: { propertyType: string | null },
  ) => Record<string, unknown>;
  fieldsOf: (row: Record<string, unknown>) => Record<string, unknown>;
};
const writable = (
  input: Record<string, unknown>,
  current?: { propertyType: string | null },
): Record<string, unknown> => priv.writable.call(service, input, current);
const fieldsOf = (row: Record<string, unknown>): Record<string, unknown> =>
  priv.fieldsOf.call(service, {
    city: null,
    neighborhood: null,
    street: null,
    houseNumber: null,
    propertyType: null,
    dealType: null,
    sharedTabu: false,
    rooms: null,
    areaSqm: null,
    floor: null,
    totalFloors: null,
    priceAgorot: null,
    ...row,
  });

describe("כתיבת שורת גיוס — הסוג הוותיק מדליק את הדגל", () => {
  it("סוג ותיק בלי דגל ⇒ הדגל נדלק", () => {
    expect(writable({ propertyType: SHARED_TABU_PROPERTY_TYPE })["sharedTabu"]).toBe(true);
  });

  /*
   * ‎**ולעולם לא מכבה.** עדכון שנוגע רק בסוג אינו אומר דבר על
   * ‏הדגל, וגזירה סימטרית הייתה מוחקת סימון מפורש של המתווך ברגע
   * ‏שמישהו שינה „דירה” ל„פנטהאוז”.
   */
  it("סוג אחר בלי דגל ⇒ הדגל לא נכתב בכלל", () => {
    expect("sharedTabu" in writable({ propertyType: "penthouse" })).toBe(false);
    expect("sharedTabu" in writable({ city: "חיפה" })).toBe(false);
  });

  /*
   * ‎**ו„לא” מפורש פורש את הסוג הישן** (ביקורת Codex, P2, שוב).
   *
   * ‏בלי זה מתווך שמוריד את הסימון בשורה ותיקה רואה אותה נשמרת
   * ‏בלי סימון — והסוג שנשאר מחזיר את העובדה בהמרה. הוא סימן „לא”,
   * ‏ונוצר נכס „כן”.
   */
  it("‏„לא” מפורש פורש את הסוג הישן — גם כשהוא נשלח", () => {
    const out = writable({ propertyType: SHARED_TABU_PROPERTY_TYPE, sharedTabu: false });
    expect(out["sharedTabu"]).toBe(false);
    expect(out["propertyType"]).toBeNull();
  });

  /* ‏וגם כשהסוג לא נשלח כלל — הוא נקרא מהשורה הקיימת */
  it("‏„לא” מפורש פורש אותו גם בעדכון חלקי", () => {
    const out = writable({ sharedTabu: false }, { propertyType: SHARED_TABU_PROPERTY_TYPE });
    expect(out["sharedTabu"]).toBe(false);
    expect(out["propertyType"]).toBeNull();
  });

  it("‏„לא” על שורה רגילה אינו נוגע בסוג", () => {
    const out = writable({ sharedTabu: false }, { propertyType: "penthouse" });
    expect(out["sharedTabu"]).toBe(false);
    expect("propertyType" in out).toBe(false);
  });
});

describe("ההמרה — הזוג שיוצא ממנה אינו נקרא כפרישה", () => {
  it("שורה סותרת שנכתבה לפני התיקון עדיין מומרת כמושאע", () => {
    const fields = fieldsOf({ propertyType: SHARED_TABU_PROPERTY_TYPE, sharedTabu: false });
    expect(fields["sharedTabu"]).toBe(true);

    /* ‏וזו הטענה עצמה: הצד השני שומר את שניהם */
    const columns = fieldsToColumns(fields);
    expect(columns.sharedTabu).toBe(true);
    expect(columns.propertyType).toBe(SHARED_TABU_PROPERTY_TYPE);
  });

  /*
   * ‏והצד השני של אותו זוג: אחרי הפרישה השורה אינה סותרת, ולכן
   * ‏הגזירה בהמרה מחזירה „לא” — מה שהמתווך אמר.
   */
  it("שורה שנפרשה מומרת כרגילה, לא כמושאע", () => {
    const fields = fieldsOf({ propertyType: null, sharedTabu: false });
    expect(fields["sharedTabu"]).toBe(false);
    expect(fieldsToColumns(fields).sharedTabu).toBe(false);
  });

  it("שורה רגילה עוברת כמות שהיא", () => {
    const fields = fieldsOf({ propertyType: "penthouse", sharedTabu: true });
    expect(fieldsToColumns(fields).sharedTabu).toBe(true);
    const plain = fieldsOf({ propertyType: "penthouse", sharedTabu: false });
    expect(fieldsToColumns(plain).sharedTabu).toBe(false);
    expect(fieldsToColumns(plain).propertyType).toBe("penthouse");
  });
});
