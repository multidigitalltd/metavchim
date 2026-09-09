import { describe, expect, it } from "vitest";
import {
  OPEN_RECRUITMENT_STATUSES,
  RECRUITMENT_FIELDS,
  RECRUITMENT_SECTIONS,
  RECRUITMENT_SECTION_LABELS,
  RECRUITMENT_SOURCES,
  RECRUITMENT_SOURCE_LABELS,
  RECRUITMENT_STATUSES,
  RECRUITMENT_STATUS_LABELS,
  canConvertToProperty,
  isOpenRecruitment,
  isValidSourceUrl,
  recruitmentCompleteness,
  recruitmentFieldFilled,
  recruitmentFieldSplit,
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

describe("קטלוג השדות", () => {
  /*
   * ‎**הקטלוג הוא מה שהמסכים מרנדרים ממנו** — כל שדה שנשמר על שורת
   * ‏גיוס חייב להיות בו, אחרת הוא ייכתב בטופס ולא יופיע בתצוגה
   * ‏(וזה בדיוק מה שקרה לארבעה שדות: קומה, קומות בבניין, סוג עסקה
   * ‏וטאבו משותף — הם נוספו לטופס והתצוגה לצפייה בלבד לא ידעה
   * ‏עליהם).
   */
  it("נושא את כל שמונה־עשר השדות, בלי כפילות", () => {
    const keys = RECRUITMENT_FIELDS.map((f) => f.key);
    expect(keys).toHaveLength(18);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("וכל שדה יושב במקטע מוכר עם כותרת", () => {
    for (const field of RECRUITMENT_FIELDS) {
      expect(RECRUITMENT_SECTIONS, field.key).toContain(field.section);
      expect(RECRUITMENT_SECTION_LABELS[field.section], field.key).toBeTruthy();
      expect(field.label.trim(), field.key).not.toBe("");
    }
  });

  /* ‏„שלב בגיוס” הוא הפעולה, ולא מידע להשלמה — הוא נשאר למעלה */
  it("ורק „שלב בגיוס” מוצמד מחוץ לחלוקה", () => {
    expect(RECRUITMENT_FIELDS.filter((f) => f.pinned === true).map((f) => f.key)).toEqual([
      "status",
    ]);
  });
});

describe("מה חסר ומה ידוע", () => {
  /*
   * ‎**אפס הוא ערך.** „קומה 0” היא קומת קרקע. בדיקת אמיתות הייתה
   * ‏מכריזה עליה חסרה, ומחזירה אותה ל„להשלמה” אחרי כל שמירה — כלומר
   * ‏שולחת את המתווך לשאול שוב את הבעלים מה שכבר נאמר.
   */
  it("קומה 0 היא קומת קרקע, לא שדה ריק", () => {
    expect(recruitmentFieldFilled({ floor: 0 }, "floor")).toBe(true);
    expect(recruitmentFieldFilled({ rooms: 0 }, "rooms")).toBe(true);
    expect(recruitmentFieldFilled({ priceAgorot: 0 }, "priceAgorot")).toBe(true);
  });

  /*
   * ‎**„לא סומן” הוא תשובה.** העמודה `NOT NULL`: `false` פירושו
   * ‏„נבדק ואינו מושאע”. שדה בוליאני שיֵחשב חסר כשהוא כבוי לא היה
   * ‏יורד מרשימת ההשלמה לעולם.
   */
  it("וטאבו משותף כבוי הוא תשובה, לא חוסר", () => {
    expect(recruitmentFieldFilled({ sharedTabu: false }, "sharedTabu")).toBe(true);
  });

  it("ומה שאין, ומחרוזת של רווחים — חסר", () => {
    expect(recruitmentFieldFilled({}, "city")).toBe(false);
    expect(recruitmentFieldFilled({ city: undefined }, "city")).toBe(false);
    expect(recruitmentFieldFilled({ city: null }, "city")).toBe(false);
    expect(recruitmentFieldFilled({ city: "   " }, "city")).toBe(false);
    expect(recruitmentFieldFilled({ rooms: Number.NaN }, "rooms")).toBe(false);
  });

  /*
   * ‎**שני הצדדים מאותה חלוקה.** שדה שנופל בין „חסר” ל„ידוע” היה
   * ‏נעלם מהמסך; שדה שנספר בשניהם היה מופיע גם בטופס ההשלמה וגם
   * ‏ברשימת הידוע, ושתי עריכות שלו היו דורסות זו את זו.
   */
  it("כל שדה נמצא בדיוק בצד אחד", () => {
    const target = { status: "new", city: "בני ברק", floor: 0, sharedTabu: false };
    const { missing, filled } = recruitmentFieldSplit(target);
    const keys = [...missing, ...filled].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    /* ‏המוצמד אינו בשום צד — הוא אינו חלק בשאלה */
    expect(keys).not.toContain("status");
    expect(keys).toHaveLength(RECRUITMENT_FIELDS.length - 1);
  });

  it("ושורה ריקה — הכול חסר, כלום לא ידוע", () => {
    const { missing, filled } = recruitmentFieldSplit({ status: "new" });
    expect(filled).toEqual([]);
    expect(missing).toHaveLength(RECRUITMENT_FIELDS.length - 1);
  });

  /* ‏הסדר בקטלוג הוא סדר התצוגה — ושתי החלוקות שומרות עליו */
  it("והסדר נשמר בשני הצדדים", () => {
    const order = RECRUITMENT_FIELDS.filter((f) => f.pinned !== true).map((f) => f.key);
    const { missing, filled } = recruitmentFieldSplit({ city: "חיפה", rooms: 3 });
    for (const side of [missing, filled]) {
      const keys = side.map((f) => f.key);
      expect(keys).toEqual([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    }
  });

  /* ‏המונה נגזר מאותה חלוקה — ולא נספר בנפרד ומסתדר אחרת */
  it("והמונה מסכים עם החלוקה", () => {
    const target = { city: "חיפה", rooms: 3, sharedTabu: false };
    const { missing, filled } = recruitmentFieldSplit(target);
    expect(recruitmentCompleteness(target)).toEqual({
      filled: filled.length,
      total: filled.length + missing.length,
    });
    expect(recruitmentCompleteness(target).total).toBe(RECRUITMENT_FIELDS.length - 1);
  });
});
