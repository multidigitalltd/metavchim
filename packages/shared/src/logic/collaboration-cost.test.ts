import { describe, expect, it } from "vitest";
import {
  COMMISSION_SPLIT_OPTIONS,
  DEFAULT_COMMISSION_SPLIT,
  DEFAULT_LEAD_SOURCES,
  MAX_COMMISSION_SHARE,
  MIN_COMMISSION_SHARE,
  commissionSplitOptionsWith,
  commissionSplitRejectionReason,
  describeCommissionSplit,
  UNPRICED_SOURCE_COST,
  coopOfferCost,
  leadPriceRejectionReason,
  leadSourceLabel,
} from "./collaboration-cost.js";

describe("coopOfferCost", () => {
  it("ביקוש של משרד אחר — חינם, בכל מסלול", () => {
    // רשת שרק המסלולים הגבוהים נמצאים בה אינה רשת
    expect(coopOfferCost("network")).toBe(0);
  });

  it("ליד חיצוני — עולה קרדיטים", () => {
    expect(coopOfferCost("kanko")).toBe(1);
  });

  it("מקור לא מתומחר נחשב בתשלום ולא חינם", () => {
    // מקור שנוסף ושכחו לתמחר עדיף שייחסם על ידי יתרה מאשר שיחולק
    // בחינם בלי שאיש ישים לב
    expect(coopOfferCost("brand_new")).toBe(UNPRICED_SOURCE_COST);
    expect(coopOfferCost("")).toBe(UNPRICED_SOURCE_COST);
  });

  it("מחיר לכל מקור בנפרד — זו כל הנקודה", () => {
    const prices = [
      { source: "network", label: "רשת", creditsCost: 0 },
      { source: "kanko", label: "Kanko", creditsCost: 2 },
      { source: "yad2", label: "יד2", creditsCost: 5 },
    ];
    expect(coopOfferCost("kanko", prices)).toBe(2);
    expect(coopOfferCost("yad2", prices)).toBe(5);
    expect(coopOfferCost("network", prices)).toBe(0);
  });

  it("מחיר פגום נקרא כחינם ולא מפיל את החישוב", () => {
    const prices = [{ source: "x", label: "x", creditsCost: Number.NaN }];
    expect(coopOfferCost("x", prices)).toBe(0);
  });

  it("מחיר שלילי אינו הנחה", () => {
    expect(coopOfferCost("x", [{ source: "x", label: "x", creditsCost: -3 }])).toBe(0);
  });
});

describe("leadSourceLabel", () => {
  it("שם לתצוגה", () => {
    expect(leadSourceLabel("kanko")).toBe("Kanko");
  });

  it("מקור לא מוכר מוצג כמזהה שלו ולא כריק", () => {
    expect(leadSourceLabel("other")).toBe("other");
  });
});

describe("leadPriceRejectionReason", () => {
  const ok = { source: "yad2", label: "יד2", creditsCost: 3 };

  it("שורה תקינה עוברת", () => {
    expect(leadPriceRejectionReason(ok)).toBeNull();
  });

  it("אפס הוא מחיר תקין — כך מוגדר מקור חינמי", () => {
    expect(leadPriceRejectionReason({ ...ok, creditsCost: 0 })).toBeNull();
  });

  it("מזהה עם רווחים או עברית נדחה", () => {
    expect(leadPriceRejectionReason({ ...ok, source: "יד 2" })).not.toBeNull();
  });

  it("מחיר שלילי או שבור נדחה", () => {
    expect(leadPriceRejectionReason({ ...ok, creditsCost: -1 })).not.toBeNull();
    expect(leadPriceRejectionReason({ ...ok, creditsCost: 1.5 })).not.toBeNull();
  });
});

describe("ברירות המחדל", () => {
  it("כוללות את הרשת בחינם", () => {
    expect(DEFAULT_LEAD_SOURCES.find((p) => p.source === "network")?.creditsCost).toBe(0);
  });
});

describe("חלוקת עמלה", () => {
  it("חצי-חצי עובר", () => {
    expect(commissionSplitRejectionReason(DEFAULT_COMMISSION_SPLIT)).toBeNull();
  });

  it("המינימום והתקרה עצמם תקינים", () => {
    expect(commissionSplitRejectionReason(MIN_COMMISSION_SHARE)).toBeNull();
    expect(commissionSplitRejectionReason(MAX_COMMISSION_SHARE)).toBeNull();
  });

  it("פחות משליש נדחה — משני הכיוונים", () => {
    // מי שלוקח 68% משאיר 32% לצד השני; המגבלה דו-כיוונית מעצם ההגדרה
    expect(commissionSplitRejectionReason(32)).not.toBeNull();
    expect(commissionSplitRejectionReason(68)).not.toBeNull();
  });

  it("התקרה נגזרת מהמינימום ולא נכתבת בנפרד", () => {
    expect(MAX_COMMISSION_SHARE).toBe(100 - MIN_COMMISSION_SHARE);
  });

  it("שבר נדחה", () => {
    expect(commissionSplitRejectionReason(50.5)).not.toBeNull();
  });

  it("הניסוח מציג את שני הצדדים", () => {
    expect(describeCommissionSplit(60)).toBe("60% / 40%");
    expect(describeCommissionSplit(50)).toBe("50% / 50%");
  });
});

describe("commissionSplitOptionsWith", () => {
  it("ערך שברשימה אינו מוסיף כפילות", () => {
    expect(commissionSplitOptionsWith(DEFAULT_COMMISSION_SPLIT)).toEqual(
      COMMISSION_SPLIT_OPTIONS,
    );
  });

  it("null מחזיר את הרשימה כמות שהיא", () => {
    expect(commissionSplitOptionsWith(null)).toEqual(COMMISSION_SPLIT_OPTIONS);
  });

  it("ערך שאינו ברשימה נכנס אליה במקומו הממוין", () => {
    /*
     * 37 תקין בשרת אך אינו נופל על החמישיות. בלי ההוספה הבורר היה
     * נפתח על ערך אחר, ושמירה הייתה משנה בשקט תנאי שסוכם.
     */
    const options = commissionSplitOptionsWith(37);
    expect(options).toContain(37);
    expect(commissionSplitRejectionReason(37)).toBeNull();
    expect([...options]).toEqual([...options].sort((a, b) => a - b));
    expect(options.length).toBe(COMMISSION_SPLIT_OPTIONS.length + 1);
  });
});

describe("COMMISSION_SPLIT_OPTIONS", () => {
  it("כוללות את ברירת המחדל", () => {
    // רשימה שנבנית מהמינימום בקפיצות של 5 מדלגת בדיוק על 50, ומשאירה
    // בורר שאי אפשר לבחור בו את הערך שהוא מציג
    expect(COMMISSION_SPLIT_OPTIONS).toContain(DEFAULT_COMMISSION_SPLIT);
  });

  it("כוללות את שני הקצוות", () => {
    expect(COMMISSION_SPLIT_OPTIONS).toContain(MIN_COMMISSION_SHARE);
    expect(COMMISSION_SPLIT_OPTIONS).toContain(MAX_COMMISSION_SHARE);
  });

  it("כל אפשרות עוברת את הוולידציה של השרת", () => {
    for (const share of COMMISSION_SPLIT_OPTIONS) {
      expect(commissionSplitRejectionReason(share)).toBeNull();
    }
  });

  it("ממוינות ובלי כפילויות", () => {
    const sorted = [...COMMISSION_SPLIT_OPTIONS].sort((a, b) => a - b);
    expect(COMMISSION_SPLIT_OPTIONS).toEqual(sorted);
    expect(new Set(COMMISSION_SPLIT_OPTIONS).size).toBe(COMMISSION_SPLIT_OPTIONS.length);
  });
});
