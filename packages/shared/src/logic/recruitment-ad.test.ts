import { describe, expect, it } from "vitest";
import {
  AD_NOTES_MAX,
  buildRecruitmentAdPrompt,
  parseRecruitmentAd,
  recruitmentAdSummary,
  RECRUITMENT_AD_SCHEMA,
} from "./recruitment-ad";
import { PROPERTY_TYPE_LABELS } from "../agent/vocabulary";

/**
 * ‎**מה שנבדק כאן הוא שהמודל לא ממציא — גם כשהוא כן.**
 *
 * ‏נכס לגיוס הוא שיחה עם בעלים. מחיר שנוחש שולח את המתווך לפתוח
 * ‏במספר שגוי, ועיר שנוחשה מהרקע שולחת אותו לכתובת שאינה קיימת.
 * ‏הפרומפט מבקש `null`, והפענוח כאן **אוכף** — כי בקשה אינה
 * ‏אכיפה, והמודל הוא צד שאי אפשר לסמוך עליו שיציית.
 */

const FULL = {
  source: "sign",
  city: "חיפה",
  neighborhood: "הדר",
  street: "הרצל",
  houseNumber: "12",
  propertyType: "apartment",
  dealType: "sale",
  rooms: 4,
  areaSqm: 95,
  floor: 3,
  totalFloors: 5,
  priceShekels: 1_850_000,
  ownerPhone: "052-1234567",
  ownerName: "משה",
  notes: "למכירה, גמיש במחיר, ללא תיווך",
};

describe("parseRecruitmentAd — מה שנקרא", () => {
  it("מודעה מלאה — כל השדות, והמחיר באגורות", () => {
    const read = parseRecruitmentAd(FULL);
    expect(read).not.toBeNull();
    expect(read?.city).toBe("חיפה");
    expect(read?.rooms).toBe(4);
    expect(read?.priceAgorot).toBe(185_000_000);
    expect(read?.source).toBe("sign");
    expect(read?.notes).toContain("ללא תיווך");
  });

  /*
   * ‎**הטלפון מנורמל לצורה הישראלית האחידה**, כי זו הצורה
   * ‏שמאפשרת לזהות אחר כך שהבעלים הזה כבר קיים אצלנו. שתי
   * ‏צורות לאותו מספר הן שני אנשים.
   */
  it("טלפון מנורמל, ומה שאינו מספר יורד", () => {
    expect(parseRecruitmentAd(FULL)?.ownerPhone).toBe("+972521234567");
    expect(parseRecruitmentAd({ ...FULL, ownerPhone: "ראה מודעה" })?.ownerPhone).toBeNull();
    expect(parseRecruitmentAd({ ...FULL, ownerPhone: "123" })?.ownerPhone).toBeNull();
  });
});

describe("parseRecruitmentAd — מה שלא נכנס", () => {
  /*
   * ‎**הבדיקה המרכזית של הקובץ.** „3” על שלט יכול להיות חדרים,
   * ‏קומה או מספר בית, ומספר שנקרא מהמקום הלא נכון נכנס לשדה
   * ‏הלא נכון. מה שמחוץ לתחום הסבירות יורד — המתווך ימלא, ולא
   * ‏יתקן מה שנראה כאילו כבר מולא.
   */
  it("מספר לא סביר יורד ל-null ואינו „מתוקן”", () => {
    const read = parseRecruitmentAd({
      ...FULL,
      rooms: 400,
      areaSqm: 3,
      floor: 900,
      totalFloors: 0,
      priceShekels: 120,
    });
    expect(read?.rooms).toBeNull();
    expect(read?.areaSqm).toBeNull();
    expect(read?.floor).toBeNull();
    expect(read?.totalFloors).toBeNull();
    expect(read?.priceAgorot).toBeNull();
  });

  /*
   * ‏קומת מרתף היא ערך אמיתי, וחצי חדר הוא איך שמוכרים דירות
   * ‏בישראל. הגבול נועד לחסום קריאה שגויה, לא מציאות.
   */
  it("קומה שלילית וחצי חדר — ערכים אמיתיים, ונשמרים", () => {
    const read = parseRecruitmentAd({ ...FULL, floor: -1, rooms: 3.5 });
    expect(read?.floor).toBe(-1);
    expect(read?.rooms).toBe(3.5);
  });

  /*
   * ‎**ערך שאינו בקטלוג יורד.** מודל שמחזיר „דירה” במקום
   * ‏`apartment` היה כותב למסד ערך שאף מסך אינו יודע להציג.
   */
  it("סוג נכס מחוץ לקטלוג יורד", () => {
    expect(parseRecruitmentAd({ ...FULL, propertyType: "דירה" })?.propertyType).toBeNull();
    expect(parseRecruitmentAd({ ...FULL, propertyType: "villa" })?.propertyType).toBeNull();
    expect(parseRecruitmentAd({ ...FULL, dealType: "מכירה" })?.dealType).toBeNull();
    expect(parseRecruitmentAd({ ...FULL, propertyType: "penthouse" })?.propertyType).toBe(
      "penthouse",
    );
  });

  it("מקור לא מוכר נופל ל-other ואינו מפיל את הקריאה", () => {
    expect(parseRecruitmentAd({ ...FULL, source: "instagram" })?.source).toBe("other");
  });
});

describe("parseRecruitmentAd — מתי אין בכלל מה לשמור", () => {
  /*
   * ‏בלי כתובת, בלי טלפון ובלי מחיר — „נכס לגיוס” שנוצר הוא שורה
   * ‏ריקה שמישהו יצטרך למחוק. עדיף לומר שהתמונה לא נקראה מאשר
   * ‏להעמיס ניקוי על מי שרק צילם שלט.
   */
  it("בלי כתובת, טלפון ומחיר — null, ולא שורה ריקה", () => {
    expect(
      parseRecruitmentAd({ source: "sign", notes: "למכירה", city: null, ownerPhone: null }),
    ).toBeNull();
    expect(parseRecruitmentAd(null)).toBeNull();
    expect(parseRecruitmentAd("למכירה")).toBeNull();
  });

  it("אחד מהשלושה מספיק", () => {
    for (const field of [
      { ownerPhone: "0521234567" },
      { priceShekels: 1_000_000 },
      { city: "תל אביב" },
      { street: "דיזנגוף" },
    ]) {
      expect(parseRecruitmentAd({ source: "sign", notes: "", ...field })).not.toBeNull();
    }
  });

  it("הטקסט החופשי נחתך ואינו מפיל את הקריאה", () => {
    const read = parseRecruitmentAd({ ...FULL, notes: "א".repeat(AD_NOTES_MAX + 500) });
    expect(read?.notes.length).toBe(AD_NOTES_MAX);
  });
});

describe("הפרומפט והסכימה", () => {
  /*
   * ‎**אוצר המונחים נגזר ואינו נכתב פעמיים.** סוג נכס שנוסף
   * ‏לקטלוג ולא לרשימה שהמודל רואה פשוט לא ייבחר לעולם מתמונה,
   * ‏בלי שאיש ישים לב.
   */
  it("כל סוגי הנכס שבקטלוג מגיעים למודל — בפרומפט ובסכימה", () => {
    const prompt = buildRecruitmentAdPrompt();
    const schemaTypes = (
      (RECRUITMENT_AD_SCHEMA["properties"] as Record<string, { enum?: string[] }>)["propertyType"]
        ?.enum ?? []
    );
    for (const key of Object.keys(PROPERTY_TYPE_LABELS)) {
      expect(prompt, `${key} חסר בפרומפט`).toContain(key);
      expect(schemaTypes, `${key} חסר בסכימה`).toContain(key);
    }
  });

  /* ‏הכלל שכל הקובץ עומד עליו חייב להיאמר למודל במפורש. */
  it("הפרומפט אוסר ניחוש במפורש", () => {
    expect(buildRecruitmentAdPrompt()).toContain("null");
    expect(buildRecruitmentAdPrompt()).toContain("אל תנחש");
  });
});

describe("recruitmentAdSummary", () => {
  it("אומר מה נקלט — ולא „נשמר בהצלחה”", () => {
    const read = parseRecruitmentAd(FULL)!;
    const text = recruitmentAdSummary(read, "הרצל 12, חיפה");
    expect(text).toContain("הרצל 12, חיפה");
    expect(text).toContain("1,850,000");
    expect(text).toContain("4 חדרים");
    expect(text).toContain("דירה");
  });

  /*
   * ‎**מה שלא נקרא נאמר במפורש.** „נשמר” בלי הסתייגות על מודעה
   * ‏שהמחיר שלה לא נקרא שולח את המתווך להתקשר בלי המספר שהוא
   * ‏הכי צריך — והוא יגלה את זה רק על הקו.
   */
  it("מונה את מה שלא נקרא", () => {
    const read = parseRecruitmentAd({ source: "sign", notes: "", city: "חיפה" })!;
    const text = recruitmentAdSummary(read, "חיפה");
    expect(text).toContain("לא הצלחתי לקרוא");
    expect(text).toContain("טלפון");
    expect(text).toContain("מחיר");
  });

  it("כשהכול נקרא — אין שורת חסרים", () => {
    const read = parseRecruitmentAd(FULL)!;
    expect(recruitmentAdSummary(read, "הרצל 12, חיפה")).not.toContain("לא הצלחתי לקרוא");
  });
});
