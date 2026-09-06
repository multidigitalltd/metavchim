import { describe, expect, it } from "vitest";
import {
  OPEN_RECRUITMENT_STATUSES,
  RECRUITMENT_SOURCES,
  RECRUITMENT_SOURCE_LABELS,
  RECRUITMENT_STATUSES,
  RECRUITMENT_STATUS_LABELS,
  canConvertToProperty,
  isOpenRecruitment,
  isValidSourceUrl,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
  sourceUrlHost,
} from "./recruitment.js";

describe("שלבי הגיוס", () => {
  it("שלושת השלבים שנתבקשו קיימים בשמם", () => {
    expect(RECRUITMENT_STATUS_LABELS.called).toBe("קיבל שיחה");
    expect(RECRUITMENT_STATUS_LABELS.awaiting_reply).toBe("אמר שיחזיר תשובה");
    expect(RECRUITMENT_STATUS_LABELS.recruited).toBe("גויס");
  });

  it("לכל שלב יש תווית — הוספת שלב בלי תווית תפיל את הקומפילציה", () => {
    for (const status of RECRUITMENT_STATUSES) {
      expect(RECRUITMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  /*
   * ‏„פתוח” הוא מה שדורש עבודה. „גויס” אינו פתוח — הנכס עבר להיות
   * נכס רגיל, והשורה כאן היא תיעוד ולא משימה.
   */
  it("השלבים הפתוחים הם אלה שדורשים עבודה", () => {
    expect(isOpenRecruitment("new")).toBe(true);
    expect(isOpenRecruitment("awaiting_reply")).toBe(true);
    expect(isOpenRecruitment("recruited")).toBe(false);
    expect(isOpenRecruitment("declined")).toBe(false);
    expect(isOpenRecruitment("lost")).toBe(false);
  });

  it("כל שלב פתוח הוא שלב מוכר", () => {
    for (const status of OPEN_RECRUITMENT_STATUSES) {
      expect(RECRUITMENT_STATUSES).toContain(status);
    }
  });

  it("שלב שאינו מוכר אינו פתוח", () => {
    expect(isOpenRecruitment("bogus")).toBe(false);
    expect(isOpenRecruitment("")).toBe(false);
  });
});

describe("ההמרה לנכס", () => {
  /*
   * ‎**רק „גויס”.** כפתור שמופיע על שורה שסורבה ואז נדחה בשרת הוא
   * מסך ששיקר — ולכן התנאי חי כאן, ושני הצדדים קוראים אותו.
   */
  it("רק „גויס” ניתן להמרה", () => {
    expect(canConvertToProperty("recruited")).toBe(true);
    for (const status of RECRUITMENT_STATUSES) {
      if (status === "recruited") continue;
      expect(canConvertToProperty(status)).toBe(false);
    }
  });

  it("שלב שאינו מוכר אינו ניתן להמרה", () => {
    expect(canConvertToProperty("converted")).toBe(false);
  });
});

describe("מקור הנכס", () => {
  it("יד2 קיים כמקור, ובעברית", () => {
    expect(RECRUITMENT_SOURCES).toContain("yad2");
    expect(RECRUITMENT_SOURCE_LABELS.yad2).toBe("יד2");
  });

  it("לכל מקור יש תווית", () => {
    for (const source of RECRUITMENT_SOURCES) {
      expect(RECRUITMENT_SOURCE_LABELS[source]).toBeTruthy();
    }
  });

  it("מקור לא מוכר מוחזר כמות שהוא ולא כ-undefined", () => {
    expect(recruitmentSourceLabel("yad2")).toBe("יד2");
    expect(recruitmentSourceLabel("winner")).toBe("winner");
    expect(recruitmentStatusLabel("called")).toBe("קיבל שיחה");
    expect(recruitmentStatusLabel("nope")).toBe("nope");
  });
});

describe("הקישור למודעה", () => {
  it("מקבל כתובת רגילה", () => {
    expect(isValidSourceUrl("https://www.yad2.co.il/item/abc123")).toBe(true);
    expect(isValidSourceUrl("http://madlan.co.il/listings/9")).toBe(true);
    expect(isValidSourceUrl("  https://yad2.co.il/x  ")).toBe(true);
  });

  /* ‏מי שמדביק מהדפדפן מדביק לפעמים סכמה באותיות גדולות — היא תקינה */
  it("מקבל סכמה באותיות גדולות", () => {
    expect(isValidSourceUrl("HTTPS://www.yad2.co.il/item/1")).toBe(true);
    expect(isValidSourceUrl("Http://madlan.co.il/a")).toBe(true);
    expect(sourceUrlHost("HTTPS://www.yad2.co.il/item/1")).toBe("yad2.co.il");
  });

  /*
   * ‎**זו בדיקת אבטחה ולא ניקיון.** הקישור נשמר כדי להיות נלחץ,
   * ו-`javascript:` שנשמר ומרונדר כ-`href` מריץ קוד אצל כל מי
   * שלוחץ — כשהתוקף הוא כל מי שיכול להזין שורה.
   */
  it("דוחה סכמות שאינן http/https", () => {
    expect(isValidSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isValidSourceUrl("JavaScript:alert(1)")).toBe(false);
    expect(isValidSourceUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidSourceUrl("file:///etc/passwd")).toBe(false);
    expect(isValidSourceUrl("mailto:a@b.com")).toBe(false);
    expect(isValidSourceUrl("tel:0501234567")).toBe(false);
  });

  it("דוחה מה שאינו כתובת בכלל", () => {
    expect(isValidSourceUrl("")).toBe(false);
    expect(isValidSourceUrl("   ")).toBe(false);
    expect(isValidSourceUrl("yad2.co.il/item/1")).toBe(false);
    expect(isValidSourceUrl("סתם טקסט")).toBe(false);
  });

  it("דוחה כתובת ארוכה מדי", () => {
    expect(isValidSourceUrl(`https://yad2.co.il/${"a".repeat(2100)}`)).toBe(false);
  });
});

describe("שם האתר להצגה", () => {
  it("מקצר לשם האתר ומוריד www", () => {
    expect(sourceUrlHost("https://www.yad2.co.il/item/abc123?x=1")).toBe("yad2.co.il");
    expect(sourceUrlHost("https://madlan.co.il/a")).toBe("madlan.co.il");
  });

  /* ‏קישור שבור לא יוצג כקישור — לכן `null` ולא מחרוזת ריקה */
  it("מחזיר null על קישור שאינו תקין", () => {
    expect(sourceUrlHost("javascript:alert(1)")).toBeNull();
    expect(sourceUrlHost("סתם טקסט")).toBeNull();
    expect(sourceUrlHost("")).toBeNull();
  });
});
