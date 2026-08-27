import { describe, expect, it } from "vitest";
import {
  INTAKE_SELLER_NOTES_MAX,
  intakeSellerRejectionReason,
  isIntakeSide,
  pickSellerPrefill,
  sellerPropertyFields,
  sellerSummaryLines,
  type IntakeSellerAnswers,
} from "./intake-seller.js";

const minimal: IntakeSellerAnswers = { dealType: "sale", city: "חיפה" };

describe("צד המוכר — מה נדרש", () => {
  it("סוג עסקה ועיר מספיקים לקישור שכבר יש לו איש קשר", () => {
    expect(intakeSellerRejectionReason(minimal, { needsIdentity: false })).toBeNull();
  });

  it("בלי סוג עסקה נדחה — נכס בלי מכירה/השכרה אינו נכס", () => {
    expect(
      intakeSellerRejectionReason({ city: "חיפה" }, { needsIdentity: false }),
    ).toBe("נא לבחור מכירה או השכרה");
  });

  it("בלי עיר נדחה — בלעדיה לסוכן אין למה לחזור", () => {
    expect(
      intakeSellerRejectionReason({ dealType: "rent" }, { needsIdentity: false }),
    ).toBe("נא למלא את העיר");
  });

  it("עיר של רווחים בלבד אינה עיר", () => {
    expect(
      intakeSellerRejectionReason(
        { dealType: "sale", city: "   " },
        { needsIdentity: false },
      ),
    ).toBe("נא למלא את העיר");
  });

  it("קישור פתוח דורש שם וטלפון", () => {
    expect(intakeSellerRejectionReason(minimal, { needsIdentity: true })).toBe(
      "נא למלא שם מלא",
    );
    expect(
      intakeSellerRejectionReason(
        { ...minimal, fullName: "דנה כהן" },
        { needsIdentity: true },
      ),
    ).toBe("נא למלא מספר טלפון");
  });

  it("מספר מקובל בכל צורה שאדם מקליד בה", () => {
    for (const phone of ["050-123-4567", "+972 50 123 4567", "0501234567"]) {
      expect(
        intakeSellerRejectionReason(
          { ...minimal, fullName: "דנה כהן", phone },
          { needsIdentity: true },
        ),
        phone,
      ).toBeNull();
    }
  });

  it("מספר שאינו ישראלי נדחה", () => {
    expect(
      intakeSellerRejectionReason(
        { ...minimal, fullName: "דנה כהן", phone: "+1 555 0100" },
        { needsIdentity: true },
      ),
    ).toBe("מספר הטלפון אינו תקין");
  });

  it("„פנוי מ-” בלי תאריך נדחה — שדה חצי-מלא אינו תשובה", () => {
    expect(
      intakeSellerRejectionReason(
        { ...minimal, entryType: "from_date" },
        { needsIdentity: false },
      ),
    ).toBe("נא למלא מתי הנכס יהיה פנוי");
    expect(
      intakeSellerRejectionReason(
        { ...minimal, entryType: "from_date", entryDate: "2026-09-01" },
        { needsIdentity: false },
      ),
    ).toBeNull();
  });

  it("„מיידי” ו„גמיש” אינם דורשים תאריך", () => {
    for (const entryType of ["immediate", "flexible"] as const) {
      expect(
        intakeSellerRejectionReason({ ...minimal, entryType }, { needsIdentity: false }),
      ).toBeNull();
    }
  });

  it("הערה ארוכה מדי נדחית", () => {
    expect(
      intakeSellerRejectionReason(
        { ...minimal, notes: "א".repeat(INTAKE_SELLER_NOTES_MAX + 1) },
        { needsIdentity: false },
      ),
    ).toBe("ההערה ארוכה מדי");
  });
});

describe("התשובות → שדות הנכס", () => {
  it("מה שלא נענה אינו נכתב — ולא נכתב כאפס", () => {
    const fields = sellerPropertyFields(minimal);
    expect(fields).toEqual({ dealType: "sale", city: "חיפה" });
    expect("rooms" in fields).toBe(false);
    expect("floor" in fields).toBe(false);
    expect("priceAgorot" in fields).toBe(false);
  });

  it("קומה 0 נשמרת — היא תשובה ולא חוסר", () => {
    expect(sellerPropertyFields({ ...minimal, floor: 0 })["floor"]).toBe(0);
  });

  it("מאפיין שסומן „אין” נשמר כ-false, ומה שלא נשאל נעדר", () => {
    const fields = sellerPropertyFields({
      ...minimal,
      features: { hasElevator: true, hasParking: false },
    });
    expect(fields["hasElevator"]).toBe(true);
    expect(fields["hasParking"]).toBe(false);
    expect("hasBalcony" in fields).toBe(false);
  });

  it("מחרוזות מנוקות, וריקות נעלמות", () => {
    const fields = sellerPropertyFields({
      ...minimal,
      street: "  הרצל  ",
      neighborhood: "   ",
    });
    expect(fields["street"]).toBe("הרצל");
    expect("neighborhood" in fields).toBe(false);
  });

  it("תאריך נלווה ל-from_date בלבד", () => {
    expect(
      sellerPropertyFields({
        ...minimal,
        entryType: "immediate",
        entryDate: "2026-09-01",
      })["entryDate"],
    ).toBeUndefined();
    expect(
      sellerPropertyFields({
        ...minimal,
        entryType: "from_date",
        entryDate: "2026-09-01",
      })["entryDate"],
    ).toBe("2026-09-01");
  });

  it("NaN אינו נשמר — מספר שלא נקרא אינו מספר", () => {
    expect("rooms" in sellerPropertyFields({ ...minimal, rooms: Number.NaN })).toBe(
      false,
    );
  });

  it("הסטטוס אינו נקבע כאן — הטיוטה היא ברירת המחדל של הטבלה", () => {
    expect("status" in sellerPropertyFields(minimal)).toBe(false);
  });

  it("הזהות אינה דולפת לשדות הנכס", () => {
    const fields = sellerPropertyFields({
      ...minimal,
      fullName: "דנה כהן",
      phone: "0501234567",
    });
    expect("fullName" in fields).toBe(false);
    expect("phone" in fields).toBe(false);
  });
});

describe("סיכום למשימה", () => {
  it("שורה ראשונה אומרת מכירה או השכרה", () => {
    expect(sellerSummaryLines(minimal)[0]).toBe("למכירה");
    expect(sellerSummaryLines({ ...minimal, dealType: "rent" })[0]).toBe("להשכרה");
  });

  it("הכתובת מורכבת ממה שיש, בלי פסיקים מיותמים", () => {
    expect(sellerSummaryLines({ ...minimal, street: "הרצל", houseNumber: "12" })).toContain(
      "הרצל 12, חיפה",
    );
    expect(sellerSummaryLines(minimal)).toContain("חיפה");
  });

  it("המחיר מוצג בשקלים עם מפריד אלפים", () => {
    expect(sellerSummaryLines({ ...minimal, priceAgorot: 185_000_000 })).toContain(
      "מחיר מבוקש: 1,850,000 ₪",
    );
  });

  it("„גמיש” נאמר רק כשהמוכר אמר אותו", () => {
    expect(
      sellerSummaryLines({ ...minimal, priceAgorot: 100_000_000, priceFlexible: true }),
    ).toContain("מחיר מבוקש: 1,000,000 ₪ (גמיש)");
    expect(
      sellerSummaryLines({ ...minimal, priceAgorot: 100_000_000 }),
    ).toContain("מחיר מבוקש: 1,000,000 ₪");
  });

  it("רק מאפיינים שסומנו „יש” מופיעים", () => {
    const lines = sellerSummaryLines({
      ...minimal,
      features: { hasElevator: true, hasParking: false, hasSafeRoom: true },
    });
    expect(lines).toContain("מעלית, ממ״ד");
  });

  it("מה שלא נענה אינו מופיע כ„לא ידוע”", () => {
    expect(sellerSummaryLines(minimal).join("\n")).not.toContain("—");
  });

  it("ההערה החופשית נכנסת כמות שהיא", () => {
    expect(sellerSummaryLines({ ...minimal, notes: "  יש שוכר עד מאי  " })).toContain(
      "יש שוכר עד מאי",
    );
  });
});

describe("הצד נשמר ולא נגזר", () => {
  it("מזהה את שני הערכים בלבד", () => {
    expect(isIntakeSide("buyer")).toBe(true);
    expect(isIntakeSide("seller")).toBe(true);
    expect(isIntakeSide("owner")).toBe(false);
    expect(isIntakeSide(undefined)).toBe(false);
  });
});

describe("ערכי פתיחה לעמוד הציבורי", () => {
  it("שם וטלפון אינם חוזרים — גם אחרי שהטופס מולא", () => {
    /*
     * הקישור הוא מפתח נושא (bearer). אם הזהות חוזרת ממנו, כל מי
     * שמצא אותו שולף שם ומספר של אדם אמיתי.
     */
    const out = pickSellerPrefill({
      fullName: "דנה כהן",
      phone: "+972501234567",
      dealType: "sale",
      city: "חיפה",
    });
    expect(out).toEqual({ dealType: "sale", city: "חיפה" });
    expect("fullName" in out).toBe(false);
    expect("phone" in out).toBe(false);
  });

  it("שדה שאינו ברשימת ההיתר אינו יוצא החוצה", () => {
    const out = pickSellerPrefill({ city: "חיפה", ownerEmail: "a@b.c", secret: 1 });
    expect(out).toEqual({ city: "חיפה" });
  });

  it("טיפוס שגוי נדחה ואינו מגיע לעמוד", () => {
    const out = pickSellerPrefill({
      city: 5,
      rooms: "שלוש",
      priceFlexible: "כן",
      entryType: "מתישהו",
      dealType: "barter",
    });
    expect(out).toEqual({});
  });

  it("מאפיינים עוברים רק כבוליאנים, וריק אינו נשלח", () => {
    expect(
      pickSellerPrefill({ features: { hasElevator: true, hasParking: "כן" } }).features,
    ).toEqual({ hasElevator: true });
    expect("features" in pickSellerPrefill({ features: { nope: true } })).toBe(false);
  });

  it("קלט שאינו אובייקט מחזיר ריק ולא קורס", () => {
    expect(pickSellerPrefill(null)).toEqual({});
    expect(pickSellerPrefill("x")).toEqual({});
    expect(pickSellerPrefill([1, 2])).toEqual({});
  });

  it("מספר שאינו סופי אינו עובר", () => {
    expect("rooms" in pickSellerPrefill({ rooms: Number.NaN })).toBe(false);
  });
});
