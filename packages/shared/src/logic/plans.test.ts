import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANS,
  PLAN_FEATURES,
  defaultPlan,
  effectiveFeatures,
  downgradeWarnings,
  featureLabel,
  formatPlanPrice,
  isPlanFeature,
  limitState,
  planAllows,
  planPriceLabel,
  planRejectionReason,
  sanitizeFeatures,
  yearlySavingPercent,
  type PlanDefinition,
} from "./plans.js";

const basePlan = (over: Partial<PlanDefinition> = {}): PlanDefinition => ({
  code: "test",
  name: "מסלול בדיקה",
  description: "",
  monthlyPriceAgorot: 10_000,
  yearlyPriceAgorot: 100_000,
  maxUsers: 5,
  maxProperties: 100,
  maxNetworkListings: null,
  maxNetworkDemands: null,
  features: ["whatsapp"],
  trialDays: 14,
  isPublic: true,
  sortOrder: 10,
  ...over,
});

describe("קטלוג הפיצ'רים", () => {
  it("כל קוד ייחודי", () => {
    const codes = PLAN_FEATURES.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("לכל פיצ'ר יש תווית ותיאור בעברית", () => {
    for (const feature of PLAN_FEATURES) {
      expect(feature.label.length).toBeGreaterThan(2);
      expect(feature.description.length).toBeGreaterThan(10);
    }
  });

  it("isPlanFeature מזהה קוד מוכר ודוחה אחר", () => {
    expect(isPlanFeature("analytics")).toBe(true);
    expect(isPlanFeature("analytic")).toBe(false);
  });

  it("featureLabel נופל בחזרה לקוד ולא מתרסק", () => {
    expect(featureLabel("analytics")).toBe("דוחות וביצועי סוכנים");
    expect(featureLabel("לא-קיים")).toBe("לא-קיים");
  });
});

describe("sanitizeFeatures", () => {
  it("זורק קוד לא מוכר", () => {
    expect(sanitizeFeatures(["analytics", "משהו"])).toEqual(["analytics"]);
  });

  it("מוריד כפילויות", () => {
    expect(sanitizeFeatures(["whatsapp", "whatsapp"])).toEqual(["whatsapp"]);
  });

  it("מחזיר בסדר הקטלוג ולא בסדר הקלט — שתי רשימות זהות נראות זהות", () => {
    expect(sanitizeFeatures(["whatsapp", "analytics"])).toEqual(
      sanitizeFeatures(["analytics", "whatsapp"]),
    );
  });

  it("רשימה ריקה", () => {
    expect(sanitizeFeatures([])).toEqual([]);
  });
});

describe("מסלולי ברירת המחדל", () => {
  it("קודים ייחודיים", () => {
    const codes = DEFAULT_PLANS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("כולם עוברים את בדיקת התקינות", () => {
    for (const plan of DEFAULT_PLANS) {
      expect(planRejectionReason(plan)).toBeNull();
    }
  });

  it("כל הפיצ'רים שמופיעים בהם מוכרים", () => {
    // ההשוואה על קבוצות ולא על מערכים: sanitizeFeatures מחזיר בסדר
    // הקטלוג, וברירות המחדל כתובות בסדר קריא לאדם
    for (const plan of DEFAULT_PLANS) {
      expect([...sanitizeFeatures(plan.features)].sort()).toEqual([...plan.features].sort());
    }
  });

  it("מסלול גבוה יותר לא מצמצם פיצ'רים של הנמוך ממנו", () => {
    // סולם עולה: מי שמשלם יותר לא אמור לאבד משהו
    const ordered = [...DEFAULT_PLANS].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < ordered.length; i += 1) {
      for (const feature of ordered[i - 1]!.features) {
        expect(ordered[i]!.features).toContain(feature);
      }
    }
  });

  it("defaultPlan מחזיר undefined לקוד לא מוכר", () => {
    expect(defaultPlan("basic")?.name).toBe("בסיסי");
    expect(defaultPlan("nope")).toBeUndefined();
  });
});

describe("planAllows", () => {
  it("מסלול שמכיל את הפיצ'ר", () => {
    expect(planAllows(basePlan({ features: ["analytics"] }), "analytics")).toBe(true);
  });

  it("מסלול שלא מכיל", () => {
    expect(planAllows(basePlan({ features: ["whatsapp"] }), "analytics")).toBe(false);
  });

  it("מסלול לא מוכר לא מזכה בכלום — הכיוון הבטוח", () => {
    expect(planAllows(undefined, "analytics")).toBe(false);
  });
});

describe("limitState", () => {
  it("מתחת למגבלה", () => {
    expect(limitState(3, 5)).toEqual({ blocked: false, remaining: 2, percent: 60, warn: false });
  });

  it("בדיוק על המגבלה — הפעולה הבאה חסומה", () => {
    // 5 מתוך 5 אינו חריגה; הששי כן
    expect(limitState(5, 5).blocked).toBe(true);
    expect(limitState(5, 5).remaining).toBe(0);
  });

  it("מעל המגבלה — לא נותן שארית שלילית", () => {
    expect(limitState(9, 5).remaining).toBe(0);
    expect(limitState(9, 5).percent).toBe(100);
  });

  it("אזהרה מ-80% ומעלה", () => {
    expect(limitState(7, 10).warn).toBe(false);
    expect(limitState(8, 10).warn).toBe(true);
  });

  it("null = ללא הגבלה", () => {
    expect(limitState(9999, null)).toEqual({
      blocked: false,
      remaining: null,
      percent: null,
      warn: false,
    });
  });

  it("מגבלת אפס מטופלת כללא הגבלה ולא כחסימה מוחלטת", () => {
    // מסלול ששמור בו 0 הוא כמעט תמיד שדה ריק, לא כוונה לחסום הכול
    expect(limitState(1, 0).blocked).toBe(false);
  });
});

describe("formatPlanPrice", () => {
  it("שקלים שלמים", () => {
    expect(formatPlanPrice(29_900)).toBe("299 ₪");
  });

  it("אפס = לפי הצעה", () => {
    expect(formatPlanPrice(0)).toBe("לפי הצעה");
  });

  it("אגורות נשמרות ולא נקטעות", () => {
    expect(formatPlanPrice(29_950)).toContain("299.5");
  });
});

describe("yearlySavingPercent", () => {
  it("חיסכון אמיתי", () => {
    // 12×100 ₪ מול 1,000 ₪ = 17%
    expect(yearlySavingPercent(basePlan({ monthlyPriceAgorot: 10_000, yearlyPriceAgorot: 100_000 }))).toBe(17);
  });

  it("בלי מחיר שנתי", () => {
    expect(yearlySavingPercent(basePlan({ yearlyPriceAgorot: null }))).toBeNull();
  });

  it("בלי חיסכון בפועל — לא מציגים 0%", () => {
    expect(
      yearlySavingPercent(basePlan({ monthlyPriceAgorot: 10_000, yearlyPriceAgorot: 120_000 })),
    ).toBeNull();
  });

  it("מסלול לפי הצעה", () => {
    expect(yearlySavingPercent(basePlan({ monthlyPriceAgorot: 0 }))).toBeNull();
  });
});

describe("planRejectionReason", () => {
  it("מסלול תקין", () => {
    expect(planRejectionReason(basePlan())).toBeNull();
  });

  it("שם קצר מדי", () => {
    expect(planRejectionReason(basePlan({ name: "א" }))).toContain("שם");
  });

  it("מחיר שלילי", () => {
    expect(planRejectionReason(basePlan({ monthlyPriceAgorot: -1 }))).toContain("שלילי");
  });

  it("אפס משתמשים — מסלול שאי אפשר להשתמש בו", () => {
    expect(planRejectionReason(basePlan({ maxUsers: 0 }))).toContain("משתמש");
  });

  it("ללא הגבלה תקין", () => {
    expect(planRejectionReason(basePlan({ maxUsers: null, maxProperties: null }))).toBeNull();
  });

  it("תקופת ניסיון ארוכה מדי", () => {
    expect(planRejectionReason(basePlan({ trialDays: 120 }))).toContain("ניסיון");
  });

  it("מחיר שנתי גבוה מ-12 חודשיים — ספרה עודפת", () => {
    expect(
      planRejectionReason(basePlan({ monthlyPriceAgorot: 10_000, yearlyPriceAgorot: 1_000_000 })),
    ).toContain("ספרה");
  });

  it("מסלול לפי הצעה לא נפסל על המחיר השנתי", () => {
    expect(
      planRejectionReason(basePlan({ monthlyPriceAgorot: 0, yearlyPriceAgorot: 500_000 })),
    ).toBeNull();
  });
});

describe("downgradeWarnings", () => {
  const from = basePlan({ features: ["analytics", "whatsapp"], maxUsers: 20, maxProperties: null });

  it("מפרט פיצ'רים שייסגרו", () => {
    const to = basePlan({ features: ["whatsapp"], maxUsers: 20, maxProperties: null });
    const warnings = downgradeWarnings(from, to, { users: 3, properties: 10 });
    expect(warnings.join(" ")).toContain("דוחות");
  });

  it("מזהיר על חריגה במשתמשים", () => {
    const to = basePlan({ features: from.features, maxUsers: 2, maxProperties: null });
    expect(downgradeWarnings(from, to, { users: 7, properties: 10 }).join(" ")).toContain("7");
  });

  it("מזהיר על חריגה בנכסים", () => {
    const to = basePlan({ features: from.features, maxUsers: null, maxProperties: 50 });
    expect(downgradeWarnings(from, to, { users: 3, properties: 90 }).join(" ")).toContain("90");
  });

  it("שדרוג לא מייצר אזהרות", () => {
    const to = basePlan({
      features: [...from.features, "telephony"],
      maxUsers: null,
      maxProperties: null,
    });
    expect(downgradeWarnings(from, to, { users: 30, properties: 900 })).toEqual([]);
  });

  it("בלי מסלול קודם — אין מה לאבד, אבל חריגות עדיין מדווחות", () => {
    const to = basePlan({ maxUsers: 2, maxProperties: null });
    const warnings = downgradeWarnings(undefined, to, { users: 5, properties: 1 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("5");
  });
});

describe("מכסות רשת בקטלוג המובנה", () => {
  /*
   * מסלול השת"פ החינמי הוסר מהקטלוג המובנה — המסלולים נקבעים
   * ידנית ב-/platform. מה שנשאר לנעול כאן הוא שהמכסות אינן מופיעות
   * בשקט על מסלול בתשלום: מכסת פרסום שנשתלה בטעות במסלול משלם
   * מגבילה לקוח ששילם, וזו בדיוק תקלה שאיש לא מדווח עליה.
   */
  it("אף מסלול מובנה אינו מוגבל בפרסום ברשת", () => {
    for (const plan of DEFAULT_PLANS) {
      expect(plan.maxNetworkListings).toBeNull();
      expect(plan.maxNetworkDemands).toBeNull();
    }
  });
});

describe("effectiveFeatures — חריגי הפלטפורמה", () => {
  it("בלי חריגים מחזיר את המסלול כמות שהוא", () => {
    expect(effectiveFeatures(["whatsapp", "analytics"])).toEqual(["analytics", "whatsapp"]);
  });

  it("הענקה פותחת תכונה שאינה במסלול", () => {
    const open = effectiveFeatures(["whatsapp"], { grants: ["telephony"], denials: [] });
    expect(open).toContain("telephony");
    expect(open).toContain("whatsapp");
  });

  it("דחייה סוגרת תכונה שכן במסלול", () => {
    expect(effectiveFeatures(["whatsapp", "analytics"], { grants: [], denials: ["analytics"] })).toEqual(
      ["whatsapp"],
    );
  });

  /*
   * הכלל שקובע את כל השאר. סגירה חייבת להיות ודאית: מי שסוגר תכונה
   * בגלל חוב או שימוש לרעה צריך שהסגירה תחזיק גם אם אותה תכונה
   * הוענקה קודם ונשכחה.
   */
  it("דחייה גוברת על הענקה של אותה תכונה", () => {
    expect(
      effectiveFeatures([], { grants: ["telephony"], denials: ["telephony"] }),
    ).not.toContain("telephony");
  });

  it("דחייה של תכונה שאינה במסלול אינה משנה דבר", () => {
    expect(effectiveFeatures(["whatsapp"], { grants: [], denials: ["telephony"] })).toEqual([
      "whatsapp",
    ]);
  });

  it("קוד שאינו בקטלוג נושר במקום להבטיח תכונה שאינה נאכפת", () => {
    expect(effectiveFeatures(["whatsapp"], { grants: ["nope"], denials: [] })).toEqual(["whatsapp"]);
  });
});

describe("planPriceLabel", () => {
  it("מסלול ציבורי ב-0 הוא חינם", () => {
    expect(planPriceLabel(basePlan({ monthlyPriceAgorot: 0, isPublic: true }))).toBe("חינם");
  });

  it("מסלול מוסתר ב-0 נסגר בשיחה", () => {
    expect(planPriceLabel(basePlan({ monthlyPriceAgorot: 0, isPublic: false }))).toBe("לפי הצעה");
  });

  it("מסלול בתשלום מוצג במחירו", () => {
    expect(planPriceLabel(basePlan({ monthlyPriceAgorot: 29_900 }))).toBe("299 ₪");
  });
});

describe("מכסות הרשת באימות ובאזהרות", () => {
  it("מכסה של 0 נדחית — היא הייתה נקראת כללא הגבלה", () => {
    // ראו את ההערה ב-planRejectionReason ואת הבדיקה ב-limitState
    expect(planRejectionReason(basePlan({ maxNetworkListings: 0 }))).toContain("לפחות 1");
    expect(planRejectionReason(basePlan({ maxNetworkDemands: 0 }))).toContain("לפחות 1");
  });

  it("מכסה ריקה או חיובית תקינה", () => {
    expect(planRejectionReason(basePlan({ maxNetworkListings: null }))).toBeNull();
    expect(planRejectionReason(basePlan({ maxNetworkDemands: 10 }))).toBeNull();
  });

  it("ירידת מסלול מזהירה על מודעות שמעבר למכסה, ומבהירה שהן נשארות", () => {
    const warnings = downgradeWarnings(
      basePlan({ features: [] }),
      basePlan({ features: [], maxNetworkListings: 3, maxNetworkDemands: 10 }),
      { users: 1, properties: 5, networkListings: 8, networkDemands: 2 },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("8");
    expect(warnings[0]).toContain("יישארו");
  });

  it("קורא שאינו מוסר את ספירת הרשת אינו מקבל אזהרה שגויה", () => {
    // השדות אופציונליים; היעדרם אינו "0 מפורסמים" שחורג ממכסה
    expect(
      downgradeWarnings(
        basePlan({ features: [] }),
        basePlan({ features: [], maxNetworkListings: 3 }),
        { users: 1, properties: 5 },
      ),
    ).toEqual([]);
  });
});
