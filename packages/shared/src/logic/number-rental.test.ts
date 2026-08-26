import { describe, expect, it } from "vitest";
import {
  build015AvailableNumbersUrl,
  build015DescriptionUrl,
  build015PurchaseUrl,
  build015ReleaseUrl,
  describeRentalStatus,
  formatRentalNumber,
  parse015AvailableNumbers,
  parse015Envelope,
  rentalCheckoutRejection,
} from "./number-rental.js";

const AUTH = { authUsername: "user", authPassword: "p&ss" };

describe("בניית כתובות ה-API של 015", () => {
  it("רשימת הפנויים — ingroup חובה והסיסמה מקודדת", () => {
    const url = build015AvailableNumbersUrl(AUTH, { ingroup: "123", count: 20 });
    expect(url).toBe(
      "https://www.015pbx.net/local/api/json/numbers/available/list/?auth_username=user&auth_password=p%26ss&ingroup=123&count=20",
    );
  });

  it("תפיסה ושחרור — אותה צורה, פעולה אחרת", () => {
    expect(build015PurchaseUrl(AUTH, "0722776123")).toContain("/numbers/purchase/?");
    expect(build015ReleaseUrl(AUTH, "0722776123")).toContain("/numbers/delete/?");
    expect(build015PurchaseUrl(AUTH, "0722776123")).toContain("number=0722776123");
  });

  it("תיאור בעברית מקודד כראוי", () => {
    const url = build015DescriptionUrl(AUTH, { number: "0722776123", description: "משרד דירומקס" });
    expect(url).toContain(`description=${encodeURIComponent("משרד דירומקס")}`);
  });
});

describe("פענוח מעטפת 015", () => {
  it("200 ו-204 הם הצלחה", () => {
    expect(parse015Envelope({ responses: [{ code: "200", key: "", message: "OK" }] }).ok).toBe(true);
    expect(parse015Envelope({ responses: [{ code: "204", key: "", message: "OK" }] }).ok).toBe(true);
  });

  it("קוד כישלון נושא את ההודעה", () => {
    const parsed = parse015Envelope({
      responses: [{ code: "403", key: "plan", message: "Your rate plan does not allow this" }],
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("403");
    expect(parsed.message).toContain("rate plan");
  });

  it("גוף שאינו במבנה המוכר אינו הצלחה", () => {
    expect(parse015Envelope(null).ok).toBe(false);
    expect(parse015Envelope("OK").ok).toBe(false);
    expect(parse015Envelope({ responses: [] }).ok).toBe(false);
  });
});

describe("רשימת המספרים הפנויים", () => {
  it("מחרוזות ספרתיות נשמרות, רעש נזרק", () => {
    expect(
      parse015AvailableNumbers({
        responses: [{ code: "200", key: "", message: "OK" }],
        data: ["0722776123", 722776124, "not-a-number", "", { number: "0722776125" }],
      }),
    ).toEqual(["0722776123", "722776124"]);
  });

  it("תשובת כישלון — רשימה ריקה, לא זריקה", () => {
    expect(
      parse015AvailableNumbers({ responses: [{ code: "401", key: "", message: "auth" }] }),
    ).toEqual([]);
  });
});

describe("חוקי הרכישה", () => {
  it("מחיר שלא הוגדר חוסם רכישה", () => {
    expect(rentalCheckoutRejection({ monthlyAgorot: null, number: "0722776123" })).toContain(
      "מחיר",
    );
    expect(rentalCheckoutRejection({ monthlyAgorot: 0, number: "0722776123" })).toContain("מחיר");
  });

  it("מספר שאינו ספרות נדחה", () => {
    expect(rentalCheckoutRejection({ monthlyAgorot: 5_000, number: "abc" })).toContain("אינו תקין");
  });

  it("קלט תקין עובר", () => {
    expect(rentalCheckoutRejection({ monthlyAgorot: 5_000, number: "0722776123" })).toBeNull();
  });
});

describe("תצוגה", () => {
  it("מספר בן עשר ספרות מפורמט לקריאה", () => {
    expect(formatRentalNumber("0722776123")).toBe("072-277-6123");
    expect(formatRentalNumber("031234567")).toBe("03-123-4567");
    expect(formatRentalNumber("12345")).toBe("12345");
  });

  it("לכל מצב יש תיאור בעברית", () => {
    for (const status of ["pending", "active", "past_due", "cancelled", "released"] as const) {
      expect(describeRentalStatus(status).length).toBeGreaterThan(2);
    }
  });
});
