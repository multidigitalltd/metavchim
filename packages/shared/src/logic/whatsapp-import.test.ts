import { describe, expect, it } from "vitest";
import {
  IMPORT_FEATURE,
  IMPORT_KIND_CAPABILITY,
  IMPORT_KIND_LABELS,
  IMPORT_ROW_LIMIT,
  importDoneText,
  importKindFromText,
  importPreviewText,
  sheetFormat,
  WHATSAPP_IMPORT_KINDS,
} from "./whatsapp-import";

describe("importKindFromText — מה המתווך אמר", () => {
  /*
   * ‎**„נכסים לגיוס” מכיל גם „נכס”.** הבדיקה הזו היא כל הסיבה
   * ‏שהסדר בפונקציה הוא סדר ולא רשימה: „גיוס” נבדק ראשון.
   */
  it("גיוס מנצח את „נכס” שבתוכו", () => {
    expect(importKindFromText("נכסים לגיוס")).toBe("recruitment");
    expect(importKindFromText("מודעות שאספתי")).toBe("recruitment");
  });

  /*
   * ‎**„מודעה” אומרת מאין הקובץ, לא מה יש בו.**
   *
   * ‏שני הניסוחים כאן הם הנפוצים ביותר לקובץ לידים ולקובץ קונים,
   * ‏ושניהם מכילים „מודע”. כשהיא נבדקה לפני מילות הישות, שניהם
   * ‏נפתחו כנכסים לגיוס — מאה רשומות בטבלה הלא נכונה, שמנקים
   * ‏ביד שורה-שורה (ביקורת Codex).
   */
  it("ומילת הישות מנצחת את מילת המקור", () => {
    expect(importKindFromText("לידים מהמודעות")).toBe("leads");
    expect(importKindFromText("לקוחות ממודעות פייסבוק")).toBe("buyers");
    expect(importKindFromText("פניות מהמודעה באתר")).toBe("leads");
    expect(importKindFromText("קונים שהגיעו ממודעות")).toBe("buyers");
    /* ‏וכשלא נאמרה ישות — המקור עדיין מכריע */
    expect(importKindFromText("מודעות פייסבוק")).toBe("recruitment");
  });

  it("הניסוחים שמתווך באמת כותב", () => {
    for (const text of ["קונים", "לקוחות מהמערכת הישנה", "רוכשים", "קליינטים"]) {
      expect(importKindFromText(text), text).toBe("buyers");
    }
    for (const text of ["לידים", "לידים מהקמפיין", "פניות מהאתר"]) {
      expect(importKindFromText(text), text).toBe("leads");
    }
  });

  /*
   * ‎**`null` ולא ניחוש.** ניחוש שגוי פותח מאה כרטיסי קונה מקובץ
   * ‏של לידים, וזו טעות שמנקים ביד שורה-שורה.
   */
  it("מה שלא נאמר מחזיר null והסוכן ישאל", () => {
    for (const text of ["", "   ", "הקובץ מצורף", "תראה את זה"]) {
      expect(importKindFromText(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe("sheetFormat — מה הקובץ", () => {
  /*
   * ‎**זו הבדיקה שמצדיקה את שני הקלטים.** העברת קובץ בין
   * ‏אפליקציות בנייד מגיעה כ-`application/octet-stream` — קובץ
   * ‏תקין לגמרי שהסתמכות על ה-MIME לבדו הייתה דוחה.
   */
  it("הסיומת מספיקה כשה-MIME אבד", () => {
    expect(sheetFormat("application/octet-stream", "לקוחות.xlsx")).toBe("xlsx");
    expect(sheetFormat("application/octet-stream", "leads.CSV")).toBe("csv");
  });

  it("וה-MIME מספיק כשאין סיומת", () => {
    expect(
      sheetFormat(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "document",
      ),
    ).toBe("xlsx");
    expect(sheetFormat("text/csv", "document")).toBe("csv");
  });

  /* ‏`.xls` הישן אינו ZIP, ולכן הקורא לא יקרא אותו — וזה נאמר */
  it("מה שלא ייקרא מסומן כלא נתמך", () => {
    expect(sheetFormat("application/vnd.ms-excel", "ישן.xls")).toBe("unsupported");
    expect(sheetFormat("application/pdf", "חוזה.pdf")).toBe("unsupported");
    expect(sheetFormat("image/jpeg", "תמונה.jpg")).toBe("unsupported");
  });
});

describe("הטקסטים", () => {
  /*
   * ‏העמודות שלא זוהו הן העיקר: במסך יש להן מיפוי ידני, ובטלפון
   * ‏אין. מי שלא רואה אותן מגלה את הפרטים החסרים חודש אחר כך.
   */
  it("התצוגה המקדימה אומרת מה יֵרד", () => {
    const text = importPreviewText({
      kind: "buyers",
      rows: 42,
      total: 42,
      unmapped: ["תקציב מקסימלי", "אזור"],
      filename: "לקוחות.xlsx",
    });
    expect(text).toContain("42 שורות");
    expect(text).toContain("קונים");
    expect(text).toContain("תקציב מקסימלי");
    expect(text).toContain("לייבא?");
  });

  it("בלי עמודות חסרות אין פסקה מיותרת", () => {
    const text = importPreviewText({
      kind: "leads",
      rows: 3,
      total: 3,
      unmapped: [],
      filename: "a.csv",
    });
    expect(text).not.toContain("לא זוהו");
  });

  /*
   * ‎**קובץ שנחתך אומר את זה לפני האישור.**
   *
   * ‏„קראתי 500 שורות” על קובץ של 900 הוא אישור לייבוא שנראה שלם,
   * ‏ו-400 הלקוחות שלא נכנסו מתגלים חודש אחר כך כשמחפשים אחד מהם
   * ‏ולא מוצאים (ביקורת Codex).
   */
  it("והחיתוך נאמר, עם המספר המקורי", () => {
    const text = importPreviewText({
      kind: "buyers",
      rows: IMPORT_ROW_LIMIT,
      total: 900,
      unmapped: [],
      filename: "הכול.xlsx",
    });
    expect(text).toContain("900 שורות");
    expect(text).toContain(String(900 - IMPORT_ROW_LIMIT));
    expect(text).toContain("מסך הייבוא");
  });

  it("וקובץ שנכנס במלואו אינו מקבל אזהרת חיתוך", () => {
    const text = importPreviewText({
      kind: "buyers",
      rows: IMPORT_ROW_LIMIT,
      total: IMPORT_ROW_LIMIT,
      unmapped: [],
      filename: "בדיוק.xlsx",
    });
    expect(text).not.toContain("לא ייכנסו");
  });

  /*
   * ‎**„הייבוא הושלם” על קובץ שמחציתו נפלה** הוא הדיווח שמתגלה
   * ‏כשמחפשים לקוח ולא מוצאים אותו. הכישלונות נאמרים.
   */
  it("התוצאה נושאת את מה שלא נכנס", () => {
    const text = importDoneText("leads", {
      created: 8,
      failed: [
        { row: 3, error: "חסר טלפון" },
        { row: 9, error: "מספר לא תקין" },
      ],
      warnings: [{ row: 4, warning: "אוחד" }],
    });
    expect(text).toContain("נכנסו 8");
    expect(text).toContain("2 שורות לא נכנסו");
    expect(text).toContain("שורה 3: חסר טלפון");
    expect(text).toContain("1 שורות נכנסו עם הערה");
  });

  it("קובץ שנקרא ולא נתן שורות אינו „הצלחה”", () => {
    const text = importDoneText("buyers", { created: 0, failed: [], warnings: [] });
    expect(text).toContain("לא נכנסה אף שורה");
  });
});

describe("שלמות הקטלוג", () => {
  it("לכל סוג יש תווית ויכולת", () => {
    for (const kind of WHATSAPP_IMPORT_KINDS) {
      expect(IMPORT_KIND_LABELS[kind], kind).toBeTruthy();
      expect(IMPORT_KIND_CAPABILITY[kind], kind).toBeTruthy();
    }
  });

  /*
   * ‎**נכסים אינם סוג, וזו החלטה.** קובץ נכסים נכנס למאגר שממנו
   * ‏יוצאות הצעות לקונים, והמסך נותן לו מיפוי עמודות ותצוגה
   * ‏מקדימה. „כן” על טלפון קטן אינו תחליף. שורה שתוסיף אותו כאן
   * ‏תיתקל בבדיקה הזו ותצטרך להסביר את עצמה.
   */
  it("ייבוא נכסים אינו עובר בוואטסאפ", () => {
    expect(WHATSAPP_IMPORT_KINDS).not.toContain("properties");
  });

  /*
   * ‏הפיצ'ר הוא זה שהבקר דורש — `data_io`. בדיקה מבנית בצד ה-API
   * ‏משווה את הערך הזה למה שכתוב על `ImportController`.
   */
  it("והייבוא נמכר בפיצ'ר אחד, שנקרא מכאן", () => {
    expect(IMPORT_FEATURE).toBe("data_io");
  });
});
