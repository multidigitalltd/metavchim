import { describe, expect, it } from "vitest";
import { formatPropertyAddress, propertyAddressOr } from "./property-address";

describe("כתובת נכס", () => {
  it("מספר הבית נצמד לרחוב, והשאר בפסיקים", () => {
    expect(
      formatPropertyAddress({
        street: "אחוזה",
        houseNumber: "5",
        neighborhood: "נווה זמר",
        city: "רעננה",
      }),
    ).toBe("אחוזה 5, נווה זמר, רעננה");
  });

  /*
   * ‏זה המקרה שהמשתמש דיווח עליו: המספר קיים במסד ולא הופיע בשום
   * ‏מקום, כי כל מסך הרכיב `street` ו-`city` בלבד.
   */
  it("בלי מספר — הכתובת כמו שהייתה", () => {
    expect(formatPropertyAddress({ street: "אחוזה", city: "רעננה" })).toBe("אחוזה, רעננה");
  });

  /*
   * ‏מספר בלי רחוב נראה כאילו הוא אומר משהו, ואינו אומר דבר.
   * ‏„5, רעננה” גרוע מ„רעננה”.
   */
  it("מספר בלי רחוב מושמט", () => {
    expect(formatPropertyAddress({ houseNumber: "5", city: "רעננה" })).toBe("רעננה");
  });

  it("רווחים בלבד נחשבים כריק", () => {
    expect(formatPropertyAddress({ street: "  ", houseNumber: " ", city: "רעננה" })).toBe(
      "רעננה",
    );
  });

  it("null ו-undefined מטופלים כמו ריק", () => {
    expect(formatPropertyAddress({ street: null, houseNumber: undefined, city: "חיפה" })).toBe(
      "חיפה",
    );
  });

  it("נכס בלי כתובת כלל — מחרוזת ריקה, והחלופה נבחרת במסך", () => {
    expect(formatPropertyAddress({})).toBe("");
    expect(propertyAddressOr({}, "ללא כתובת")).toBe("ללא כתובת");
    expect(propertyAddressOr({ city: "אילת" }, "ללא כתובת")).toBe("אילת");
  });
});
