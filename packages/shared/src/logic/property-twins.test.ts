import { describe, expect, it } from "vitest";
import {
  canonicalTwinPair,
  MAX_TWINS_PER_PROPERTY,
  propertyHeadline,
  TWIN_NOTE_MAX,
  twinBatchRejectionReason,
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

  it("נכס אינו תואם לעצמו", () => {
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

/**
 * ‎**סימון של כמה נכסים בבת אחת** — הבורר מאפשר את זה, ולכן השאלה
 * ‏אינה עוד „האם יש מקום לאחד” אלא „האם יש מקום לכולם”.
 */
describe("twinBatchRejectionReason", () => {
  it("כשיש מקום לכולם — מותר", () => {
    expect(twinBatchRejectionReason(0, MAX_TWINS_PER_PROPERTY)).toBeNull();
    expect(twinBatchRejectionReason(MAX_TWINS_PER_PROPERTY - 3, 3)).toBeNull();
  });

  /*
   * ‎**זו התקלה שהפונקציה נכתבה בשבילה.** בלעדיה חמישה נבחרים
   * ‏כשיש מקום לשניים היו נשמרים חלקית — שניים נכנסים, שלושה
   * ‏נופלים — והמתווך היה מגלה זאת מהרשימה ולא מהמסך.
   */
  it("וכשאין מקום לכולם — נחסם לפני השליחה, ואומר לכמה יש מקום", () => {
    const reason = twinBatchRejectionReason(MAX_TWINS_PER_PROPERTY - 2, 5);
    expect(reason).not.toBeNull();
    expect(reason).toContain("2");
    expect(reason).toContain("5");
  });

  /* ‏„עוד נכס אחד” ולא „עוד 1 נכסים” */
  it("ומדבר עברית כשנשאר מקום לאחד", () => {
    expect(twinBatchRejectionReason(MAX_TWINS_PER_PROPERTY - 1, 2)).toContain(
      "עוד 1 נכס ",
    );
  });

  /*
   * ‎**ובתקרה מלאה — אותה הודעה של הבדיקה הבודדת.** „אפשר לסמן עוד
   * ‏0” אינו משפט, ומי שם צריך לשמוע מה לעשות ולא כמה נשאר.
   */
  it("ובתקרה מלאה — ההודעה אומרת להסיר", () => {
    const reason = twinBatchRejectionReason(MAX_TWINS_PER_PROPERTY, 3);
    expect(reason).toContain("הסירו");
    expect(reason).not.toContain("עוד 0");
  });

  /*
   * ‎**כלל אחד ולא שניים.** הבדיקה הבודדת היא מקרה פרטי של הזו,
   * ‏אחרת שתיהן היו נפרדות בשקט ביום שהמספר משתנה.
   */
  it("והבדיקה הבודדת היא בדיוק „אחד” מכאן", () => {
    for (const current of [0, 5, MAX_TWINS_PER_PROPERTY - 1, MAX_TWINS_PER_PROPERTY]) {
      expect(twinLimitRejectionReason(current), String(current)).toBe(
        twinBatchRejectionReason(current, 1),
      );
    }
  });

  /* ‏„לא נבחר דבר” אינו חריגה — ההודעה עליו היא של הבורר */
  it("ובחירה ריקה אינה חריגה מהתקרה", () => {
    expect(twinBatchRejectionReason(MAX_TWINS_PER_PROPERTY, 0)).toBeNull();
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
