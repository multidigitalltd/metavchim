import { describe, expect, it } from "vitest";
import {
  canonicalTwinPair,
  MAX_TWINS_PER_PROPERTY,
  propertyHeadline,
  TWIN_NOTE_MAX,
  twinLimitRejectionReason,
  twinNoteRejectionReason,
  twinPairKey,
} from "./property-twins";

describe("canonicalTwinPair", () => {
  it("מחזירה את אותו זוג בשני הכיוונים", () => {
    /*
     * זו כל הסימטריה. אילו הסדר היה תלוי בסדר הקלט, האינדקס הייחודי
     * היה מאפשר שתי שורות לאותו קשר — והכרטיס היה מציג את הנכס
     * פעמיים ומסיר רק אחת מהן.
     */
    expect(canonicalTwinPair("A", "B")).toEqual({ first: "A", second: "B" });
    expect(canonicalTwinPair("B", "A")).toEqual({ first: "A", second: "B" });
  });

  it("נכס אינו תאום של עצמו", () => {
    expect(canonicalTwinPair("A", "A")).toBeNull();
  });

  it("ממיינת לפי סדר לקסיקוגרפי, לא לפי אורך", () => {
    expect(canonicalTwinPair("01JZ", "01JA")).toEqual({
      first: "01JA",
      second: "01JZ",
    });
  });
});

describe("twinPairKey", () => {
  it("מפתח זהה לשני הכיוונים", () => {
    expect(twinPairKey("A", "B")).toBe(twinPairKey("B", "A"));
  });

  it("null לאותו נכס", () => {
    expect(twinPairKey("A", "A")).toBeNull();
  });
});

describe("twinNoteRejectionReason", () => {
  it("הערה ריקה חוקית — ההערה רשות", () => {
    expect(twinNoteRejectionReason("")).toBeNull();
    expect(twinNoteRejectionReason("   ")).toBeNull();
  });

  it("הערה סבירה עוברת", () => {
    expect(twinNoteRejectionReason("אותו בניין, קומה גבוהה יותר")).toBeNull();
  });

  it("ארוכה מדי נדחית", () => {
    expect(twinNoteRejectionReason("א".repeat(TWIN_NOTE_MAX + 1))).toContain(
      String(TWIN_NOTE_MAX),
    );
  });

  it("רווחים בקצוות אינם מכריעים את הגבול", () => {
    /* מי שהדביק טקסט עם רווח בסוף לא כתב תו נוסף. */
    expect(twinNoteRejectionReason(`  ${"א".repeat(TWIN_NOTE_MAX)}  `)).toBeNull();
  });
});

describe("twinLimitRejectionReason", () => {
  it("מתחת לתקרה — מותר", () => {
    expect(twinLimitRejectionReason(0)).toBeNull();
    expect(twinLimitRejectionReason(MAX_TWINS_PER_PROPERTY - 1)).toBeNull();
  });

  it("בתקרה — נחסם, וההודעה אומרת מה לעשות", () => {
    const reason = twinLimitRejectionReason(MAX_TWINS_PER_PROPERTY);
    expect(reason).not.toBeNull();
    expect(reason).toContain(String(MAX_TWINS_PER_PROPERTY));
    expect(reason).toContain("הסירו");
  });
});

describe("propertyHeadline", () => {
  it("חדרים ואז כתובת מלאה", () => {
    expect(
      propertyHeadline({
        rooms: 4,
        street: "הרצל",
        houseNumber: "12",
        neighborhood: "מרכז",
        city: "רמת גן",
      }),
    ).toBe("4 חדרים · הרצל 12, מרכז, רמת גן");
  });

  it("מדלגת על מה שאין, בלי פסיקים מיותמים", () => {
    expect(propertyHeadline({ rooms: 3, city: "חולון" })).toBe(
      "3 חדרים · חולון",
    );
    expect(propertyHeadline({ street: "ביאליק", city: "רמת גן" })).toBe(
      "ביאליק, רמת גן",
    );
  });

  it("מספר בית בלי רחוב אינו הופך לכתובת", () => {
    /* „12, רמת גן” אינו זיהוי — הוא נראה כמו תקלה. */
    expect(propertyHeadline({ houseNumber: "12", city: "רמת גן" })).toBe(
      "רמת גן",
    );
  });

  it("נכס ריק מקבל שורה שאפשר ללחוץ עליה", () => {
    expect(propertyHeadline({})).toBe("נכס ללא כתובת");
  });

  it("שדה ריק אינו נספר ככתובת", () => {
    expect(propertyHeadline({ rooms: 5, city: "", street: "" })).toBe(
      "5 חדרים",
    );
  });
});
