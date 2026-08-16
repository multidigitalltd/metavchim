import { describe, expect, it } from "vitest";
import {
  CUSTOM_FEATURE_PREFIX,
  MAX_CUSTOM_FEATURES,
  customFeatureKey,
  customFeatureMap,
  featureCatalogue,
  isCustomFeature,
  normalizeCustomFeatures,
  normalizeFeatureKey,
} from "./custom-features.js";

describe("normalizeFeatureKey", () => {
  it("מאחד כתיבים של אותו מאפיין", () => {
    const forms = ["מיזוג מרכזי", "מיזוג-מרכזי", "  מיזוג   מרכזי  ", "מיזוג מרכזי."];
    const keys = new Set(forms.map((f) => normalizeFeatureKey(f)));
    expect(keys.size).toBe(1);
  });

  it("מסיר גרשיים", () => {
    expect(normalizeFeatureKey('ממ"ד פרטי')).toBe(normalizeFeatureKey("ממד פרטי"));
  });

  /*
   * זו הרגרסיה שהנרמול קיים בשבילה: מקף חייב להפוך לרווח ולא
   * להיעלם, אחרת "מיזוג-מרכזי" מתלכד עם "מיזוגמרכזי" — מפתח שאיש
   * לא יקליד — במקום עם "מיזוג מרכזי".
   */
  it("מקף הופך לרווח ולא נעלם", () => {
    expect(normalizeFeatureKey("מיזוג-מרכזי")).toBe("מיזוג מרכזי");
  });

  it("טקסט ריק מחזיר ריק, כדי שהקורא ידחה בלי לנחש", () => {
    expect(normalizeFeatureKey("   ")).toBe("");
    expect(customFeatureKey("  ")).toBe("");
  });
});

describe("customFeatureKey", () => {
  it("מוסיף קידומת שמבדילה מהקבועים", () => {
    expect(customFeatureKey("סורגים")).toBe(`${CUSTOM_FEATURE_PREFIX}סורגים`);
    expect(isCustomFeature(customFeatureKey("סורגים"))).toBe(true);
    expect(isCustomFeature("hasElevator")).toBe(false);
  });

  /* משרד שיקרא למאפיין שלו בשם של שדה קבוע לא ידרוס אותו */
  it("שם שזהה לשדה קבוע אינו מתנגש", () => {
    expect(customFeatureKey("hasElevator")).not.toBe("hasElevator");
  });
});

describe("normalizeCustomFeatures", () => {
  it("מאחד כפילויות והאחרון גובר", () => {
    const out = normalizeCustomFeatures([
      { label: "מיזוג מרכזי", value: true },
      { label: "מיזוג-מרכזי", value: false },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.value).toBe(false);
  });

  it("זורק שורות בלי תוכן", () => {
    expect(normalizeCustomFeatures([{ label: "  ", value: true }])).toHaveLength(0);
  });

  it("נעצר בתקרה", () => {
    const many = Array.from({ length: MAX_CUSTOM_FEATURES + 5 }, (_, i) => ({
      label: `מאפיין ${i}`,
      value: true,
    }));
    expect(normalizeCustomFeatures(many)).toHaveLength(MAX_CUSTOM_FEATURES);
  });

  it("שומר את התווית כפי שהוקלדה, ולא את המפתח", () => {
    const [only] = normalizeCustomFeatures([{ label: "מיזוג-מרכזי", value: true }]);
    expect(only?.label).toBe("מיזוג-מרכזי");
    expect(only?.key).toBe("custom:מיזוג מרכזי");
  });
});

describe("customFeatureMap", () => {
  it("מפתח → יש/אין, ומה שאינו ברשימה נשאר לא ידוע", () => {
    const map = customFeatureMap(normalizeCustomFeatures([{ label: "סורגים", value: false }]));
    expect(map["custom:סורגים"]).toBe(false);
    expect(map["custom:מיזוג"]).toBeUndefined();
  });
});

describe("featureCatalogue", () => {
  it("מסדר לפי שכיחות — מה שכבר בשימוש מוצע ראשון", () => {
    const catalogue = featureCatalogue([
      { customFeatures: normalizeCustomFeatures([{ label: "מיזוג", value: true }]) },
      { customFeatures: normalizeCustomFeatures([{ label: "מיזוג", value: true }]) },
      { customFeatures: normalizeCustomFeatures([{ label: "סורגים", value: true }]) },
    ]);
    expect(catalogue.map((c) => c.label)).toEqual(["מיזוג", "סורגים"]);
    expect(catalogue[0]?.count).toBe(2);
  });

  it("כתיבים שונים נספרים כמאפיין אחד", () => {
    const catalogue = featureCatalogue([
      { customFeatures: normalizeCustomFeatures([{ label: "מיזוג מרכזי", value: true }]) },
      { customFeatures: normalizeCustomFeatures([{ label: "מיזוג-מרכזי", value: true }]) },
    ]);
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]?.count).toBe(2);
  });
});
