import { describe, expect, it } from "vitest";
import { demandChips, entryChip, presentationChips } from "./network-card.js";

const base = {
  dealType: "sale",
  cities: ["פתח תקווה"],
  budgetMaxAgorot: 240_000_000,
  mustFeatures: [],
};

describe("demandChips", () => {
  it("מציג את כל מה שידוע, ולא רק ערים ותקציב", () => {
    const chips = demandChips({
      ...base,
      propertyTypes: ["apartment"],
      roomsMin: 4,
      roomsMax: 4,
      areaSqmMin: 90,
      neighborhoods: ["כפר גנים"],
      entryType: "immediate",
      financing: "pre_approved",
      maturity: "very_hot",
      mustFeatures: ["hasElevator"],
      niceFeatures: ["hasParking"],
    });
    const text = chips.map((c) => c.text);
    expect(text).toContain("דירה");
    expect(text).toContain("4 חדרים");
    expect(text).toContain("מ-90 מ״ר");
    expect(text).toContain("כפר גנים");
    expect(text).toContain("כניסה מיידית");
    expect(text).toContain("אישור עקרוני ביד");
    expect(text).toContain("חם מאוד");
    expect(text).toContain("מעלית");
    expect(text).toContain("חניה");
  });

  /*
   * זו הבדיקה שהמודול קיים בשבילה: השדות היחידים שלא עוברים הם אלה
   * שמזהים אדם. אם מישהו יוסיף שם או טלפון לביקוש, הכרטיס לא יציג
   * אותם — ואם הוא כן יתחיל להציג, השורה הזו תיפול.
   */
  it("אינו מציג פרטי קשר גם אם הועברו", () => {
    const chips = demandChips({
      ...base,
      ...({
        name: "ישראל ישראלי",
        phone: "0501234567",
        email: "a@b.c",
      } as object),
    });
    const all = chips.map((c) => `${c.icon}${c.text}`).join(" ");
    expect(all).not.toContain("ישראל");
    expect(all).not.toContain("050");
    expect(all).not.toContain("@");
  });

  it("תקציב בלי מינימום מנוסח כתקרה ולא כטווח מ-0", () => {
    const [budget] = demandChips(base).filter((c) => c.tone === "money");
    expect(budget?.text).toBe("עד 2,400,000 ₪");
  });

  it("טווח תקציב מוצג משני הצדדים", () => {
    const [budget] = demandChips({
      ...base,
      budgetMinAgorot: 180_000_000,
    }).filter((c) => c.tone === "money");
    expect(budget?.text).toBe("1,800,000 ₪–2,400,000 ₪");
  });

  /* בלי הגבלת חדרים אין חוסר לסמן — הקונה פשוט פתוח ליותר נכסים */
  it("בלי טווח חדרים אין תגית חדרים, ובוודאי לא ?–?", () => {
    const text = demandChips(base).map((c) => c.text);
    expect(text.some((t) => t.includes("חדרים"))).toBe(false);
    expect(text.some((t) => t.includes("?"))).toBe(false);
  });

  /* "מתעניין" היא ברירת המחדל של כל קונה — תגית שאינה אומרת דבר */
  it("בשלות רגילה אינה מייצרת תגית", () => {
    const text = demandChips({ ...base, maturity: "interested" }).map(
      (c) => c.text,
    );
    expect(text).not.toContain("מתעניין");
  });

  it("מאפיין מותאם מוצג בשמו בלי הקידומת הפנימית", () => {
    const text = demandChips({
      ...base,
      mustFeatures: ["custom:מיזוג מרכזי"],
    }).map((c) => c.text);
    expect(text).toContain("מיזוג מרכזי");
    expect(text.some((t) => t.includes("custom:"))).toBe(false);
  });
});

describe("entryChip", () => {
  it("מכסה גם את אוצר המילים של הנכס וגם של הקונה", () => {
    expect(entryChip("immediate", undefined)?.text).toBe("כניסה מיידית");
    expect(entryChip("flexible", undefined)?.text).toBe("מועד כניסה גמיש");
    expect(entryChip("by_date", "2026-09-01")?.text).toContain("עד");
    expect(entryChip("from_date", "2026-09-01")?.text).toContain("מ-");
  });

  /* ערך לא מוכר לא הופך לתגית — שדה חסר עדיף על שדה שקרי */
  it("ערך לא מוכר אינו מייצר תגית", () => {
    expect(entryChip("whatever", undefined)).toBeNull();
    expect(entryChip(undefined, undefined)).toBeNull();
  });

  /* תאריך פגום לא מדפיס Invalid Date על מסך של מתווך */
  it("תאריך פגום נופל למצב בלבד", () => {
    expect(entryChip("by_date", "not-a-date")?.text).toBe("מועד כניסה מוגדר");
  });
});

describe("presentationChips", () => {
  it("מציג את הנכס שהוצע במלואו — למעט כתובת מדויקת ובעלים", () => {
    const chips = presentationChips({
      city: "גבעתיים",
      neighborhood: "בורוכוב",
      propertyType: "apartment",
      dealType: "sale",
      rooms: 4,
      areaSqm: 95,
      floor: 7,
      totalFloors: 8,
      condition: "renovated",
      priceAgorot: 230_000_000,
      entryType: "flexible",
      features: ["hasElevator", "hasParking"],
    });
    const text = chips.map((c) => c.text);
    expect(text).toContain("דירה");
    expect(text).toContain("95 מ״ר");
    expect(text).toContain("קומה 7 מתוך 8");
    expect(text).toContain("משופץ");
    expect(text).toContain("2,300,000 ₪");
    expect(text).toContain("בורוכוב, גבעתיים");
    expect(text).toContain("מעלית");
  });

  it("קומה בלי סך קומות אינה ממציאה מספר", () => {
    const [chip] = presentationChips({ floor: 3 }).filter(
      (c) => c.icon === "stairs",
    );
    expect(chip?.text).toBe("קומה 3");
  });
});

/*
 * הרגרסיה שבגללה השמות קיימים: גרסה קודמת החזירה אימוג'ים, והם נראו
 * זרים לצד ערכת הקווים של שאר המערכת. אם מישהו יחזיר אימוג'י לשדה
 * הזה, השורה הזו תיפול לפני שהוא יגיע למסך.
 */
describe("שם האייקון ולא אימוג'י", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;

  it("שום תגית אינה נושאת אימוג'י", () => {
    const chips = [
      ...demandChips({
        ...base,
        propertyTypes: ["apartment"],
        roomsMin: 3,
        areaSqmMin: 80,
        neighborhoods: ["מרכז"],
        budgetMinAgorot: 180_000_000,
        entryType: "immediate",
        financing: "cash",
        maturity: "hot",
        mustFeatures: ["hasElevator"],
        niceFeatures: ["hasParking"],
      }),
      ...presentationChips({
        city: "חולון",
        propertyType: "penthouse",
        dealType: "rent",
        rooms: 5,
        areaSqm: 120,
        floor: 2,
        condition: "new",
        priceAgorot: 800_000,
        entryType: "on_date",
        entryDate: "2026-10-01",
        features: ["hasStorage"],
      }),
    ];
    expect(chips.length).toBeGreaterThan(10);
    for (const chip of chips) {
      expect(EMOJI.test(chip.icon), chip.icon).toBe(false);
      expect(chip.icon).toMatch(/^[a-z]+$/);
    }
  });
});
