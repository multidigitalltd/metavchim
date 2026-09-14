import { describe, expect, it } from "vitest";
import {
  EMBED_ORIGINS,
  embedHeight,
  embedUrl,
  MENTOR_CONTENT_KINDS,
  MENTOR_CONTENT_KIND_LABELS,
  parseContentUrl,
} from "./mentor-content";

/**
 * ‎**מה שנשמר הוא כתובת, ומה שמוצג נבנה ממזהה.**
 *
 * ‏„הטמעת סרטון” בניסוח הנאיבי היא הדבקת `<iframe>` שהאתר מרנדר —
 * ‏כלומר הזרקת HTML למסך של כל מתווך במערכת. הבדיקות כאן על הגבול
 * ‏הזה: כתובת נכנסת, מזהה יוצא, וכל מה שאינו נקרא כמזהה **אינו
 * ‏מנוקה ואינו מנוחש** אלא יורד.
 */

describe("parseContentUrl — יוטיוב", () => {
  /*
   * ‏ארבע צורות לאותו סרטון, וכולן מגיעות מהדבקה אמיתית: שיתוף
   * ‏מהנייד נותן `youtu.be`, מהדפדפן `watch?v=`, מכפתור ההטמעה
   * ‏`/embed/`, וסרטון קצר `/shorts/`.
   */
  it("כל צורות הכתובת מחזירות את אותו מזהה", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(parseContentUrl(url), url).toEqual({ kind: "youtube", ref: "dQw4w9WgXcQ" });
    }
  });

  /*
   * ‎**מזהה פגום יורד ואינו „מתוקן”.** כתובת יוטיוב בלי מזהה תקין
   * ‏היא הדבקה חלקית, ושורה שנשמרת ממנה היא כרטיס שלא ינוגן.
   */
  it("מזהה שאינו באורך הנכון יורד", () => {
    expect(parseContentUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseContentUrl("https://youtu.be/way-too-long-to-be-an-id")).toBeNull();
    expect(parseContentUrl("https://www.youtube.com/")).toBeNull();
  });

  /* ‏פרמטרים נוספים (זמן, רשימה) אינם מפריעים — המזהה הוא `v` */
  it("פרמטרים נוספים אינם מפריעים", () => {
    expect(parseContentUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1")).toEqual({
      kind: "youtube",
      ref: "dQw4w9WgXcQ",
    });
  });
});

describe("parseContentUrl — פודקאסטים", () => {
  it("ספוטיפיי — פרק ותוכנית", () => {
    expect(parseContentUrl("https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk")).toEqual({
      kind: "spotify",
      ref: "episode/4rOoJ6Egrf8K2IrywzwOMk",
    });
    expect(parseContentUrl("https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk")).toEqual({
      kind: "spotify",
      ref: "show/4rOoJ6Egrf8K2IrywzwOMk",
    });
  });

  it("ספוטיפיי — נתיב שאינו פרק או תוכנית יורד", () => {
    expect(parseContentUrl("https://open.spotify.com/track/4rOoJ6Egrf8K2Iry")).toBeNull();
    expect(parseContentUrl("https://open.spotify.com/episode/")).toBeNull();
  });

  /*
   * ‏הנתיב של אפל נושא שפה ושם קריא, ולכן המזהה נשלף לפי הצורה
   * ‏(`id` ואז ספרות) ולא לפי מיקום — מיקום משתנה עם השפה.
   */
  it("אפל — המזהה נשלף מכל מקום בנתיב, והפרק מהשאילתה", () => {
    expect(parseContentUrl("https://podcasts.apple.com/il/podcast/some-show/id1234567890")).toEqual({
      kind: "apple",
      ref: "id1234567890",
    });
    expect(
      parseContentUrl("https://podcasts.apple.com/us/podcast/x/id1234567890?i=1000600000000"),
    ).toEqual({ kind: "apple", ref: "id1234567890?i=1000600000000" });
  });
});

describe("parseContentUrl — מה שנדחה", () => {
  /*
   * ‎**הבדיקה החשובה של הקובץ.** `javascript:` בשדה שהופך ל-`href`
   * ‏הוא הרצת קוד בדפדפן של כל מי שלוחץ, והתוקף הוא כל מי שיכול
   * ‏להזין שורה — כלומר מנהל הפלטפורמה, או מי שהשיג את החשבון שלו.
   */
  it("סכמה שאינה https יורדת", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "file:///etc/passwd",
    ]) {
      expect(parseContentUrl(url), url).toBeNull();
    }
  });

  it("מה שאינו כתובת בכלל יורד", () => {
    expect(parseContentUrl("")).toBeNull();
    expect(parseContentUrl("   ")).toBeNull();
    expect(parseContentUrl("תראה את הסרטון הזה")).toBeNull();
    expect(parseContentUrl("<iframe src=x>")).toBeNull();
  });

  /*
   * ‏כתובת https שאינה מוכרת אינה שגיאה: יש פודקאסטים בלי נגן
   * ‏מוטמע, וקישור שנפתח בחוץ עדיף על תוכן שלא נכנס בכלל.
   */
  it("כתובת https אחרת היא קישור חיצוני ולא שגיאה", () => {
    const parsed = parseContentUrl("https://example.com/podcast/42");
    expect(parsed?.kind).toBe("link");
    expect(parsed?.ref).toBe("https://example.com/podcast/42");
  });
});

describe("embedUrl — הכתובת נבנית מהמזהה", () => {
  /*
   * ‎**זו הסיבה שמפענחים בכלל.** הנגן נטען מהמקור הקבוע ומהמזהה,
   * ‏ולא מהמחרוזת שהודבקה — ולכן אין דרך שמחרוזת תגיע ל-`src`.
   */
  it("כל הטמעה יוצאת מהמקור המוצהר שלה", () => {
    expect(embedUrl({ kind: "youtube", ref: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(embedUrl({ kind: "spotify", ref: "episode/abc123" })).toBe(
      "https://open.spotify.com/embed/episode/abc123",
    );
    expect(embedUrl({ kind: "apple", ref: "id1" }).startsWith(EMBED_ORIGINS.apple)).toBe(true);
  });

  it("קישור חיצוני נשאר כפי שהוא", () => {
    expect(embedUrl({ kind: "link", ref: "https://example.com/x" })).toBe("https://example.com/x");
  });
});

describe("שלמות הקטלוג", () => {
  it("לכל סוג יש תווית", () => {
    for (const kind of MENTOR_CONTENT_KINDS) {
      expect(MENTOR_CONTENT_KIND_LABELS[kind], kind).toBeTruthy();
    }
  });

  /*
   * ‏לכל סוג שמוטמע יש מקור מוצהר. סוג חדש בלי מקור היה עובר
   * ‏פענוח ונחסם ב-CSP — מסגרת ריקה בלי שום הודעה.
   */
  it("לכל סוג שמוטמע יש מקור", () => {
    for (const kind of MENTOR_CONTENT_KINDS) {
      if (kind === "link") continue;
      expect(EMBED_ORIGINS[kind], kind).toMatch(/^https:\/\//u);
    }
  });

  it("גובה הנגן נגזר מהסוג", () => {
    expect(embedHeight("youtube")).toBeGreaterThan(embedHeight("spotify"));
  });
});
