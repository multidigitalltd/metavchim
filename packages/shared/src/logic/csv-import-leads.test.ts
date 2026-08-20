import { describe, expect, it } from "vitest";
import { parseLeadsCsv } from "./csv-import-leads.js";

describe("parseLeadsCsv", () => {
  it("מפרק קובץ פניות מלא", () => {
    const csv = [
      "שם,טלפון,אימייל,עניין,מקור,הודעה",
      '"יוסי לוי",050-1234567,Yossi@Example.com,קנייה,פייסבוק,"מתעניין ב-4 חדרים"',
    ].join("\n");
    const { rows, unmappedHeaders } = parseLeadsCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows).toEqual([
      {
        name: "יוסי לוי",
        phone: "+972501234567",
        email: "yossi@example.com",
        intent: "buy",
        source: "פייסבוק",
        summary: "מתעניין ב-4 חדרים",
      },
    ]);
  });

  it("כותרות של ייצוא CRM באנגלית", () => {
    const csv = [
      "contactFullName,callerPhoneNumber,additionalNotes,contactOrigin",
      "משה כהן,0521234567,חוזר מחר,אתר",
    ].join("\n");
    const { rows, unmappedHeaders } = parseLeadsCsv(csv);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: "משה כהן",
      phone: "+972521234567",
      summary: "חוזר מחר",
      source: "אתר",
    });
  });

  it("כוונה לא מזוהה אינה מפילה את השורה — נשמרת בסיכום", () => {
    const csv = ["שם,טלפון,עניין", "דנה,0501111111,מתלבטת"].join("\n");
    const { rows } = parseLeadsCsv(csv);
    expect(rows[0]?.intent).toBeUndefined();
    expect(rows[0]?.summary).toContain("מתלבטת");
  });

  it("אין שם — הטלפון נהיה השם, והשורה נשמרת", () => {
    const csv = ["טלפון,הודעה", "0501234567,ראיתי מודעה"].join("\n");
    const { rows } = parseLeadsCsv(csv);
    expect(rows[0]?.name).toBe("+972501234567");
  });

  it("מיפוי ידני גובר על הזיהוי האוטומטי", () => {
    const csv = ["איש קשר,טל,פירוט", "רות כהן,0529999999,רוצה למכור"].join("\n");
    const auto = parseLeadsCsv(csv);
    expect(auto.unmappedHeaders).toHaveLength(3);
    const { rows, unmappedHeaders } = parseLeadsCsv(csv, {
      "איש קשר": "name",
      טל: "phone",
      פירוט: "summary",
    });
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: "רות כהן",
      phone: "+972529999999",
      summary: "רוצה למכור",
    });
  });
});
