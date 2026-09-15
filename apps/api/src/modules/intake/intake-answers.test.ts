import { describe, expect, it } from "vitest";
import {
  AnswersSchema,
  SellerAnswersSchema,
  normalizeAnswers,
  normalizeSellerAnswers,
} from "./intake.controller";

/**
 * ‎**שדה שהסכימה מקבלת ו„המנרמל” משמיט נעלם בשקט.**
 *
 * זה בדיוק מה שקרה עם הרישום המשותף: הטופס הציבורי לא שאל, הסכימה
 * לא הכירה, והטיוטה שנוצרה נשאה את ברירת המחדל של הטבלה — כלומר
 * ‎**טענה** רישום נפרד בשם מוכר שלא נשאל, והוצעה לקונים שסירבו
 * למושאע במפורש (ביקורת Codex, P1).
 *
 * המנרמל אינו „העתקה”: הוא זה שממיר `null` ל-NaN אצל הקונה ומחזיר
 * טיפוס נקוב ולא `Record<string, unknown>`, ולכן הוא נכתב שדה-שדה.
 * שורה שנשכחת בו אינה שוברת כלום — הבקשה נענית ב-200, והערך פשוט
 * אינו מגיע לכרטיס.
 *
 * הלולאה סגורה בשני צדדיה: הקבוע חייב לענות על **כל** שדה בסכימה,
 * ולכן שדה חדש מפיל את הבדיקה כאן לפני שהוא מגיע למנרמל.
 */
const HONEYPOT = "website";

function assertPassThrough(
  shape: Record<string, unknown>,
  fixture: Record<string, unknown>,
  normalized: Record<string, unknown>,
): void {
  expect(Object.keys(fixture).sort()).toEqual(Object.keys(shape).sort());
  for (const key of Object.keys(shape)) {
    if (key === HONEYPOT) continue;
    expect(key in normalized, key).toBe(true);
  }
}

describe("כל שדה שהסכימה מקבלת מגיע לצד השני", () => {
  it("צד הקונה", () => {
    const fixture = {
      fullName: "דנה כהן",
      phone: "050-1234567",
      dealType: "sale",
      cities: ["חיפה"],
      propertyTypes: ["apartment"],
      roomsMin: 3,
      roomsMax: 4,
      budgetMinAgorot: 100_000_000,
      budgetMaxAgorot: 200_000_000,
      areaSqmMin: 80,
      features: { hasElevator: "must" },
      entryType: "immediate",
      entryBy: "2026-09-01",
      notes: "ליד בית ספר",
      [HONEYPOT]: "",
    };
    const { website: _honeypot, ...answers } = AnswersSchema.parse(fixture);
    assertPassThrough(AnswersSchema.shape, fixture, normalizeAnswers(answers));
  });

  it("צד המוכר", () => {
    const fixture = {
      fullName: "דנה כהן",
      phone: "050-1234567",
      dealType: "sale",
      city: "חיפה",
      neighborhood: "הדר",
      street: "הרצל",
      houseNumber: "12",
      propertyType: "apartment",
      sharedTabu: true,
      rooms: 4,
      areaSqm: 100,
      floor: 2,
      totalFloors: 5,
      priceAgorot: 150_000_000,
      priceFlexible: true,
      features: { hasElevator: true },
      entryType: "from_date",
      entryDate: "2026-09-01",
      notes: "שוכר בנכס",
      [HONEYPOT]: "",
    };
    const { website: _honeypot, ...answers } = SellerAnswersSchema.parse(fixture);
    assertPassThrough(
      SellerAnswersSchema.shape,
      fixture,
      normalizeSellerAnswers(answers),
    );
  });
});
