import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ‎**רשת הביטחון של התמלול — מה שאסור להסיר.**
 *
 * ## הסיכון שהשער הזה שומר מפניו
 *
 * הבנת השיחה עברה למודל שפה, וזה שיפור אמיתי: המודל יודע מי דיבר
 * ומה הצד, ו-regex לעולם לא יידע. אבל הוא גם מביא איתו שלוש
 * תכונות שלא היו קודם — הוא עולה כסף, הוא נשען על רשת, והוא יכול
 * להמציא.
 *
 * שלוש ההגנות שנבנו סביבו נראות כמו קוד הגנתי מיותר ברגע שהמודל
 * עובד טוב, וזה בדיוק הרגע שבו מוחקים אותן. השער כאן קיים כדי
 * שהמחיקה תיפול בבנייה ולא אצל מתווך שמצטט ללקוח מספר שלא נאמר.
 *
 * ## למה על המקור
 *
 * ה-Worker דורש מסד נתונים, Redis, שירות תמלול ומפתח Gemini כדי
 * לרוץ. מה שצריך לשמור הוא **צורה** — שהחילוץ הישן עדיין רץ,
 * שהכשל אינו נזרק, ושהמספרים נבדקים — וזה נבדק על הקוד, כמו שאר
 * השערים המבניים כאן.
 */

const API = join(import.meta.dirname, "..", "..");
const WORKER = readFileSync(
  join(API, "..", "..", "workers", "src", "main.ts"),
  "utf8",
);
const INTEL = readFileSync(
  join(API, "..", "..", "..", "packages", "shared", "src", "logic", "call-intel.ts"),
  "utf8",
);

describe("החילוץ הדטרמיניסטי נשאר רשת הביטחון", () => {
  /*
   * ‎`summarizeCall` אינו נשען על רשת, אינו עולה כסף ואינו ממציא.
   * הסרתו הייתה הופכת כל תקלה אצל הספק — מפתח שפג, מכסה שנגמרה,
   * פסק זמן — לשיחה בלי שום סיכום.
   */
  it("summarizeCall עדיין רץ, ותוצאתו ממוזגת", () => {
    expect(WORKER).toContain("summarizeCall(plain)");
    expect(WORKER).toContain("mergeCallIntel(");
  });

  it("הכשל של המודל מוחזר כ-null ואינו נזרק", () => {
    const start = WORKER.indexOf("async function callIntel(");
    expect(start).toBeGreaterThan(-1);
    const scope = WORKER.slice(start, WORKER.indexOf("\n}\n", start));
    expect(scope).toContain("catch");
    expect(scope).toContain("return null;");
    expect(scope, "כשל של המודל נזרק ומפיל את התמלול").not.toMatch(/catch[^}]*throw/u);
  });

  /*
   * מפתח שלא הוגדר הוא המצב הרגיל בהתקנה חדשה, לא תקלה. הוא חייב
   * לחזור מוקדם ובשקט — קריאה בלי מפתח היא 400 בכל שיחה.
   */
  it("בלי מפתח מוגדר המודל אינו נקרא כלל", () => {
    expect(WORKER).toContain("if (config === null || transcript.trim() === \"\") return null;");
  });

  it("תמלול שהמודל לא פיצל נשאר כפי שהיה", () => {
    expect(WORKER).toContain("intel.turns.length > 0 ? formatRoleTranscript(intel.turns) : diarizedText");
  });
});

describe("שלוש ההגנות מפני המצאה", () => {
  /*
   * מודל שנשמע חכם וממציא פרט אחד גרוע ממשפט יבש שכולו נכון —
   * המתווך יצטט אותו ללקוח.
   */
  it("כל מספר נבדק מול התמלול", () => {
    expect(INTEL).toContain("groundedNumbers");
    expect(INTEL).toContain("return groundedNumbers(String(n), [transcript]) ? n : undefined;");
  });

  it("הסיכום נפסל כולו על מספר שלא נאמר, ולא נחתך", () => {
    expect(INTEL).toContain(
      "rawSummary !== undefined && groundedNumbers(rawSummary, [transcript]) ? rawSummary : \"\"",
    );
  });

  it("תורות שהן כתיבה מחדש נפסלות", () => {
    expect(INTEL).toContain("function turnsAreFaithful(");
    expect(INTEL).toContain("turnsAreFaithful(turns, transcript) ? turns : []");
  });

  it("לכל מספר יש טווח שפוי", () => {
    for (const key of ["budget", "rooms", "areaSqm"]) {
      expect(INTEL, `אין טווח ל-${key}`).toContain(`${key}: [`);
    }
  });

  /*
   * ‎`required` בסכמה היה אומר למודל שהשדה חייב להופיע — כלומר
   * מזמין אותו להמציא ערך לשדה שלא נאמר בשיחה.
   */
  it("שום שדה בסכמה אינו חובה", () => {
    const start = INTEL.indexOf("export const CALL_INTEL_SCHEMA");
    const scope = INTEL.slice(start, INTEL.indexOf("\n};", start));
    expect(scope).not.toContain("required");
  });

  it("ההנחיה אומרת במפורש להשמיט ולא לנחש", () => {
    expect(INTEL).toContain("אל תמציא");
    expect(INTEL).toContain("עדיף שדה חסר על שדה שגוי");
  });
});

describe("תאימות מול הספק", () => {
  /*
   * שני מצבים שקורים בייצור ואינם תקלה אצלנו: מודל שהוצא משימוש
   * מחזיר 404, ומודל שאינו תומך ב-`responseSchema` מחזיר 400.
   * בלי הניסיונות האלה שתי התצורות משביתות את הבנת השיחה **בשקט** —
   * כל שיחה נופלת לחילוץ הדטרמיניסטי ואיש אינו יודע למה.
   */
  it("סכמה שנדחתה ב-400 מנוסה שוב בלעדיה", () => {
    expect(WORKER).toContain("out.status === 400");
    expect(WORKER).toContain("once(config.model, false)");
  });

  it("מודל שהוצא משימוש (404) מנוסה בברירת המחדל", () => {
    expect(WORKER).toContain("out.status === 404");
    expect(WORKER).toContain("once(CALL_INTEL_MODEL_DEFAULT, true)");
  });

  /*
   * ניסיון שני על מודל שכבר הוא ברירת המחדל הוא בדיוק אותה בקשה
   * פעם נוספת — עלות בלי סיכוי.
   */
  it("אין ניסיון חוזר כשהמודל כבר ברירת המחדל", () => {
    expect(WORKER).toContain("config.model !== CALL_INTEL_MODEL_DEFAULT");
  });
});

describe("פרטיות", () => {
  /*
   * שם הלקוח מוצפן במנוחה. פענוח שלו כדי לשלוח אותו לספק חיצוני
   * הופך החלטת פרטיות מפורשת על פיה — בשביל רמז.
   */
  it("שם הלקוח אינו נשלח למודל", () => {
    expect(WORKER).not.toContain("contactName");
  });
});
