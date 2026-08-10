import { describe, expect, it } from "vitest";
import { normalizeIsraeliPhone, parseBuyersCsv } from "./csv-import-buyers.js";

describe("normalizeIsraeliPhone", () => {
  it("מנרמל פורמטים מקומיים ל-E.164", () => {
    expect(normalizeIsraeliPhone("050-1234567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("050 123 4567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("03-6123456")).toBe("+97236123456");
    expect(normalizeIsraeliPhone("972501234567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("+972501234567")).toBe("+972501234567");
  });

  it("דוחה מספרים לא ישראליים או קצרים מדי", () => {
    expect(normalizeIsraeliPhone("12345")).toBeUndefined();
    expect(normalizeIsraeliPhone("+14155551234")).toBeUndefined();
    expect(normalizeIsraeliPhone("01-1234567")).toBeUndefined(); // קידומת 1 לא קיימת
  });
});

describe("parseBuyersCsv", () => {
  it("ממפה כותרות עבריות ומחלץ קונים", () => {
    const csv = [
      "שם,טלפון,ערים,סוג עסקה,תקציב,חדרים,בשלות,מימון",
      'ישראל ישראלי,050-1234567,"תל אביב; רמת גן",קנייה,2500000,3.5,חם,אישור עקרוני',
      "דנה כהן,052-7654321,חיפה,השכרה,6000,2,מתעניין,מזומן",
    ].join("\n");
    const { rows, unmappedHeaders } = parseBuyersCsv(csv);
    expect(unmappedHeaders).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("ישראל ישראלי");
    expect(rows[0]?.phone).toBe("+972501234567");
    expect(rows[0]?.cities).toEqual(["תל אביב", "רמת גן"]);
    expect(rows[0]?.dealType).toBe("sale");
    expect(rows[0]?.budgetMaxAgorot).toBe(250_000_000); // ₪→אגורות
    expect(rows[0]?.roomsMin).toBe(3.5);
    expect(rows[0]?.maturity).toBe("hot");
    expect(rows[0]?.financing).toBe("pre_approved");
    expect(rows[1]?.dealType).toBe("rent");
    expect(rows[1]?.financing).toBe("cash");
  });

  it("ברירת מחדל: עסקת מכירה רק כשהתא ריק", () => {
    const { rows } = parseBuyersCsv("שם,טלפון,עיר,תקציב\nרון,050-1111111,אשדוד,1800000");
    expect(rows[0]?.dealType).toBe("sale");
  });

  it("סוג עסקה לא מזוהה לא הופך בשקט למכירה — מועבר גולמי לדחייה בשרת", () => {
    const { rows } = parseBuyersCsv(
      "שם,טלפון,עיר,סוג עסקה,תקציב\nרון,050-1111111,אשדוד,שכירותת,1800000",
    );
    expect(rows[0]?.dealType).toBe("שכירותת"); // לא "sale"!
  });

  it('תקציב עם נקודה עשרונית: "6,000.00" הוא 6,000 ₪ — לא 600,000', () => {
    const { rows } = parseBuyersCsv(
      'שם,טלפון,עיר,סוג עסקה,תקציב\nרון,050-1111111,חיפה,השכרה,"6,000.00"',
    );
    expect(rows[0]?.budgetMaxAgorot).toBe(600_000); // 6,000₪ באגורות
  });

  it("טלפון שלא ניתן לנרמל נשאר כמו שהוא — השרת ידחה עם שגיאה ברורה", () => {
    const { rows } = parseBuyersCsv("שם,טלפון,עיר,תקציב\nרון,אין,אשדוד,1800000");
    expect(rows[0]?.phone).toBe("אין");
  });

  it("מדווח כותרות לא מזוהות ו-CSV ריק", () => {
    expect(parseBuyersCsv("שם,שטויות\nא,ב").unmappedHeaders).toContain("שטויות");
    expect(parseBuyersCsv("").rows).toHaveLength(0);
  });
});

describe("הגיליון האמיתי שנדחה — שם/טלפון/תקציב/סוג עסקה/סטטוס/הערות/מקור", () => {
  const CSV = [
    "שם,טלפון,תקציב,סוג עסקה,סטטוס,הערות,מקור הגעה",
    'משה כהן,050-1234567,"2,500,000",קנייה,חם,מחפש דחוף,פייסבוק',
    "דנה לוי,052-7654321,8000,שכירות,בטיפול,,המלצה",
  ].join("\n");

  it("כל הכותרות מזוהות — אין עמודה שנזרקת בשקט", () => {
    const { unmappedHeaders } = parseBuyersCsv(CSV);
    expect(unmappedHeaders).toEqual([]);
  });

  it("השורות נקלטות בלי עמודת עיר בכלל", () => {
    const { rows } = parseBuyersCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "משה כהן",
      phone: "+972501234567",
      budgetMaxAgorot: 250_000_000,
      dealType: "sale",
      maturity: "hot",
      source: "פייסבוק",
      cities: [],
    });
  });

  it("סטטוס לא מזוהה לא מפיל את השורה — הוא עובר להערות", () => {
    const { rows } = parseBuyersCsv(CSV);
    expect(rows[1]?.maturity).toBeUndefined();
    expect(rows[1]?.agentNotes).toContain("סטטוס: בטיפול");
  });

  it("כותרת עם רווחים, כוכבית או רישיות שונה עדיין מזוהה", () => {
    const messy = 'שם מלא *, טלפון , "מקור הגעה"\nרון,0501111111,אתר';
    const { rows, unmappedHeaders } = parseBuyersCsv(messy);
    expect(unmappedHeaders).toEqual([]);
    expect(rows[0]?.source).toBe("אתר");
  });

  it("הערות מהקובץ ומעמודת הסטטוס חיות יחד", () => {
    const csv = "שם,טלפון,סטטוס,הערות\nרון,0501111111,בטיפול,לקוח ותיק";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.agentNotes).toContain("לקוח ותיק");
    expect(rows[0]?.agentNotes).toContain("סטטוס: בטיפול");
  });
});

describe("עדיפות שם — לא תלוית סדר עמודות (ביקורת Codex)", () => {
  it("contactFullName גובר גם כשהוא מופיע לפני callerFirstName", () => {
    const csv = "contactFullName,callerFirstName,phoneNumber\nמשה כהן,משה,0501234567";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.name).toBe("משה כהן");
  });

  it("contactFullName גובר גם כשהוא מופיע אחרי", () => {
    const csv = "callerFirstName,contactFullName,phoneNumber\nמשה,משה כהן,0501234567";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.name).toBe("משה כהן");
  });

  it("כשאין שם מלא — השם הפרטי משמש", () => {
    const csv = "callerFirstName,contactFullName,phoneNumber\nזיוה,,0501234567";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.name).toBe("זיוה");
  });

  it("אין שם בכלל אבל יש טלפון — הטלפון נהיה השם והשורה נקלטת", () => {
    /*
     * 210 שורות מהקובץ האמיתי נדחו על "חסר שם" למרות שהיה בהן טלפון
     * תקין. כרטיס שאפשר להתקשר אליו עדיף על שורה שנזרקת.
     */
    const csv = "שם,טלפון,תקציב\n,0501234567,1500000";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.name).toBe("+972501234567");
    expect(rows[0]?.phone).toBe("+972501234567");
  });

  it("אין שם וגם אין טלפון — השורה נשארת בלי שם (והשרת ידחה אותה)", () => {
    const csv = "שם,טלפון,תקציב\n,,1500000";
    const { rows } = parseBuyersCsv(csv);
    expect(rows[0]?.name).toBeUndefined();
  });
});
