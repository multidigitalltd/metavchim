import { describe, expect, it } from "vitest";
import {
  agorotToShekelString,
  CSV_BOM,
  DEAL_TYPE_LABELS_HE,
  escapeCsvCell,
  PROPERTY_STATUS_LABELS_HE,
  PROPERTY_TYPE_LABELS_HE,
  toCsv,
} from "./csv-export.js";
import { parseCsvRecords, parsePropertiesCsv, unsanitizeFormulaCell } from "./csv-import.js";
import { PropertyTypeSchema } from "../schemas/property.js";

describe("escapeCsvCell", () => {
  it("עוטף ערכים עם פסיק וגרשיים", () => {
    expect(escapeCsvCell("דירה, משופצת")).toBe('"דירה, משופצת"');
    expect(escapeCsvCell('כולל "ממ"ד"')).toBe('"כולל ""ממ""ד"""');
    expect(escapeCsvCell("רגיל")).toBe("רגיל");
  });

  it("מנטרל נוסחאות גיליון (CSV Injection) באופן הפיך", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell("+972-501234567")).toBe("'+972-501234567");
    expect(escapeCsvCell("@import")).toBe("'@import");
    expect(escapeCsvCell("-מינוס טקסט")).toBe("'-מינוס טקסט");
    expect(escapeCsvCell("-1")).toBe("-1"); // מספר שלילי נשאר מספר
    // הפיך בייבוא
    expect(unsanitizeFormulaCell("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unsanitizeFormulaCell("'רגיל")).toBe("'רגיל"); // גרש לגיטימי לא נמחק
  });
});

describe("parseCsvRecords — תאים מרובי-שורות", () => {
  it("שורה חדשה בתוך תא מצוטט נשארת בתא", () => {
    const records = parseCsvRecords('עיר,כותרת\r\nחיפה,"שורה ראשונה\nשורה שנייה"\r\n');
    expect(records).toHaveLength(2);
    expect(records[1]?.[1]).toBe("שורה ראשונה\nשורה שנייה");
  });

  it("Round-trip של כותרת מרובת-שורות דרך הפרסר המלא", () => {
    const csv = toCsv(["עיר", "כותרת"], [["חיפה", "שורה 1\nשורה 2"]]);
    const { rows } = parsePropertiesCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.marketingTitle).toBe("שורה 1\nשורה 2");
  });
});

describe("toCsv", () => {
  it("בונה קובץ עם BOM ושורות CRLF", () => {
    const csv = toCsv(["עיר", "מחיר"], [["חיפה", 100], ["תל אביב", undefined]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("עיר,מחיר\r\n");
    expect(csv).toContain("תל אביב,\r\n");
  });

  it("Round-trip: ייצוא נכס ניתן לייבוא חזרה עם אותם ערכים, כולל סטטוס", () => {
    const csv = toCsv(
      ["עיר", "רחוב", "חדרים", "מחיר", "סוג", "סטטוס"],
      [[
        "בני ברק", "רבי עקיבא", 4,
        agorotToShekelString(265_000_000),
        PROPERTY_TYPE_LABELS_HE.apartment,
        PROPERTY_STATUS_LABELS_HE.active,
      ]],
    );
    const { rows, unmappedHeaders } = parsePropertiesCsv(csv);
    expect(unmappedHeaders).toHaveLength(0);
    expect(rows[0]?.fields.city).toBe("בני ברק");
    expect(rows[0]?.fields.rooms).toBe(4);
    expect(rows[0]?.fields.priceAgorot).toBe(265_000_000);
    expect(rows[0]?.fields.propertyType).toBe("apartment");
    expect(rows[0]?.status).toBe("active");
  });

  /*
   * הרשימה נגזרת מהסכימה ואינה נכתבת כאן ביד: רשימה מקבילה הייתה
   * מפספסת בשקט כל סוג נכס חדש — כלומר הבדיקה שנועדה לתפוס בדיוק
   * את הפער הזה הייתה עוברת בלעדיו.
   */
  it("כל סוגי הנכס בסכימה מקבלים תווית ייצוא", () => {
    for (const type of PropertyTypeSchema.options) {
      expect(PROPERTY_TYPE_LABELS_HE[type], type).toBeTruthy();
    }
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
