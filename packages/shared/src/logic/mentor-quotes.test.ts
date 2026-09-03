import { describe, expect, it } from "vitest";
import {
  MENTOR_QUOTES,
  QUOTE_THEME_LABELS,
  QUOTE_THEME_NOTES,
  QUOTE_THEMES,
  quotesByTheme,
  type MentorQuote,
} from "./mentor-quotes.js";

/**
 * ‎**מה שנבדק כאן הוא הייחוס, לא הטעם.**
 *
 * ‏משפטי מוטבציה הם התחום שבו ייחוס שגוי הוא הנורמה, ומתווך שיצטט
 * כאן משהו בפני לקוח וייתפס בטעות — המערכת הזיקה לו. לכן הבדיקות
 * שואלות שאלה אחת חוזרת: האם לכל שורה יש כתובת שאפשר לפתוח, או
 * הודאה מפורשת שאין לה.
 */

/** ‏מקור „בדיק” — כזה שאפשר לפתוח ולאמת בו את המילים. */
const CITABLE =
  /(משלי|תהילים|קהלת|פרקי אבות|תלמוד בבלי|ליקוטי מוהר״ן|אלטנוילנד)/u;
/** ‏הודאה שאין מקור ראשוני. */
const HEDGED = /(מיוחס ל|פתגם עברי)/u;

describe("משפטי המוטבציה — כל שורה נושאת את מי שאמר אותה", () => {
  it("יש ציטוטים לבדוק בכלל", () => {
    /* ‏המשוכה שמונעת „ירוק על אפס”: רשימה ריקה עוברת כל בדיקה שמתחתיה */
    expect(MENTOR_QUOTES.length).toBeGreaterThanOrEqual(10);
  });

  it("לכל ציטוט יש טקסט ומקור, ושניהם אינם ריקים", () => {
    for (const q of MENTOR_QUOTES) {
      expect(q.text.trim().length).toBeGreaterThan(5);
      expect(q.source.trim().length).toBeGreaterThan(2);
    }
  });

  /**
   * ‎**זו הבדיקה שהקובץ קיים בשבילה.**
   *
   * ‏„— אנונימי”, „— מקור לא ידוע” או שם פרטי בלי הקשר הם בדיוק
   * הצורה שבה ציטוט מומצא נכנס פנימה. כל מקור חייב להיות או כתובת
   * שאפשר לפתוח, או הודאה מפורשת שאין כזו.
   */
  it("כל מקור הוא כתובת שאפשר לפתוח, או הודאה שאין כזו", () => {
    const vague = MENTOR_QUOTES.filter(
      (q) => !CITABLE.test(q.source) && !HEDGED.test(q.source),
    );
    /*
     * ‏בן-גוריון הוא היוצא מן הכלל היחיד שמותר: אמירה מתועדת של
     * אדם ידוע, בלי חיבור אחד להצביע עליו. כל שם נוסף שיצטרף לכאן
     * מחייב הכרעה מודעת, ולא הוספה בשקט.
     */
    expect(vague.map((q) => q.source)).toEqual(["דוד בן-גוריון"]);
  });

  it("„מיוחס” אינו מתחפש לציטוט מדויק", () => {
    const ford = MENTOR_QUOTES.find((q) => q.source.includes("פורד"));
    expect(ford?.source).toMatch(/^מיוחס ל/u);
  });

  it("מקור מקראי נושא פרק ופסוק, ולא רק שם הספר", () => {
    const scripture = MENTOR_QUOTES.filter((q) =>
      /(משלי|תהילים|קהלת)/u.test(q.source),
    );
    expect(scripture.length).toBeGreaterThan(2);
    for (const q of scripture) {
      /* ‏„משלי כ״ט, י״ח” — אות גרשיים או גרש, ופסיק בין פרק לפסוק */
      expect(q.source).toMatch(/[״׳].*,/u);
    }
  });

  it("אין כפילויות — לא בטקסט ולא בצמד טקסט-מקור", () => {
    const texts = MENTOR_QUOTES.map((q) => q.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("משפטי המוטבציה — חמש המשפחות", () => {
  it("לכל משפחה יש שם, שורת חיבור, ולפחות שני ציטוטים", () => {
    for (const theme of QUOTE_THEMES) {
      expect(QUOTE_THEME_LABELS[theme]).toBeTruthy();
      expect(QUOTE_THEME_NOTES[theme]).toBeTruthy();
      expect(quotesByTheme(theme).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("כל ציטוט שייך לאחת מחמש המשפחות, ואין יתומים", () => {
    const grouped = QUOTE_THEMES.flatMap((t) => quotesByTheme(t));
    expect(grouped).toHaveLength(MENTOR_QUOTES.length);
  });

  it("שורת החיבור היא בקול המנטור ולא ציטוט מחופש", () => {
    /*
     * ‏השורות האלה נכתבו על ידי המערכת, ולכן אסור שייראו כמצוטטות:
     * מרכאות פותחות בתחילת שורה כזו היו הופכות אותה למשפט של מישהו.
     */
    for (const theme of QUOTE_THEMES) {
      expect(QUOTE_THEME_NOTES[theme].trimStart().startsWith("„")).toBe(false);
    }
  });
});

describe("משפטי המוטבציה — טיפוסים", () => {
  it("הטיפוס אינו מאפשר ציטוט בלי משפחה", () => {
    const q: MentorQuote = { text: "בדיקה בלבד", source: "בדיקה", theme: "vision" };
    expect(QUOTE_THEMES).toContain(q.theme);
  });
});
