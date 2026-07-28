import { describe, expect, it } from "vitest";
import {
  agorotToShekelString,
  CSV_BOM,
  DEAL_TYPE_LABELS_HE,
  escapeCsvCell,
  PROPERTY_TYPE_LABELS_HE,
  toCsv,
} from "./csv-export.js";
import { parsePropertiesCsv } from "./csv-import.js";

describe("escapeCsvCell", () => {
  it("עוטף ערכים עם פסיק וגרשיים", () => {
    expect(escapeCsvCell("דירה, משופצת")).toBe('"דירה, משופצת"');
    expect(escapeCsvCell('כולל "ממ"ד"')).toBe('"כולל ""ממ""ד"""');
    expect(escapeCsvCell("רגיל")).toBe("רגיל");
  });
});

describe("toCsv", () => {
  it("בונה קובץ עם BOM ושורות CRLF", () => {
    const csv = toCsv(["עיר", "מחיר"], [["חיפה", 100], ["תל אביב", undefined]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("עיר,מחיר\r\n");
    expect(csv).toContain("תל אביב,\r\n");
  });

  it("Round-trip: ייצוא נכס ניתן לייבוא חזרה עם אותם ערכים", () => {
    const csv = toCsv(
      ["עיר", "רחוב", "חדרים", "מחיר", "סוג"],
      [["בני ברק", "רבי עקיבא", 4, agorotToShekelString(265_000_000), PROPERTY_TYPE_LABELS_HE.apartment]],
    );
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv.replace(CSV_BOM, ""));
    expect(unmappedHeaders).toHaveLength(0);
    expect(rows[0]?.fields.city).toBe("בני ברק");
    expect(rows[0]?.fields.rooms).toBe(4);
    expect(rows[0]?.fields.priceAgorot).toBe(265_000_000);
    expect(rows[0]?.fields.propertyType).toBe("apartment");
  });
});

describe("תוויות ייצוא", () => {
  it("היפוך המפות בוחר את הצורה הקנונית", () => {
    expect(PROPERTY_TYPE_LABELS_HE.apartment).toBe("דירה");
    expect(DEAL_TYPE_LABELS_HE.sale).toBe("מכירה"); // לא "קנייה"
    expect(DEAL_TYPE_LABELS_HE.rent).toBe("השכרה");
  });

  it("אגורות → שקלים לייצוא", () => {
    expect(agorotToShekelString(265_000_000)).toBe("2650000");
    expect(agorotToShekelString(600_050)).toBe("6000.50");
    expect(agorotToShekelString(undefined)).toBe("");
  });
});
