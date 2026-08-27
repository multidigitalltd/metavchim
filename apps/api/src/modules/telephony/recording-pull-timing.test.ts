import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RECORDING_EARLY_RETRY_MS,
  RECORDING_FIRST_ATTEMPT_GRACE_MS,
  RECORDING_GIVE_UP_MS,
  RECORDING_YOUNG_CALL_MS,
} from "@metavchim/shared";

/**
 * ‎**מתי מושכים הקלטה — ומתי מוקדם מדי.**
 *
 * ## מה קרה
 *
 * הסבב בחר כל שיחה שטרם נוסתה, **בלי שום תנאי על גילה**. שיחה
 * שהסתיימה לפני חצי דקה נמשכה בטיק הבא, לפני שהמרכזייה סיימה
 * לכתוב את הקובץ; 015 סירבה, והמשרד ראה „המשיכה נכשלה” על שיחה בת
 * דקה (דיווח מהשטח).
 *
 * ## למה מבנית, ולמה על השאילתה
 *
 * ההכרעה כולה היא **תנאי בשאילתה** — שורות בודדות שאפשר להסיר בלי
 * ששום בדיקה תרגיש, ושהתוצאה שלהן מתגלה רק אצל משרד אמיתי כמה ימים
 * אחר כך. זו בדיוק הצורה שהקובץ הזה נכתב בשבילה.
 *
 * שלושת ההסתעפויות הן שלוש שאלות שונות, ולכן נבדקות בנפרד: „טרם
 * נוסתה”, „צעירה ונכשלה”, ו„ותיקה ונכשלה”.
 */

const source = readFileSync(new URL("./recording-fetch.service.ts", import.meta.url), "utf8");

describe("זמן חסד לפני הניסיון הראשון", () => {
  /*
   * הבדיקה המרכזית. בלי התנאי הזה חוזר בדיוק הבאג שדווח — ובשקט,
   * כי הכול ממשיך לעבוד ורק מוקדם מדי.
   */
  it("שיחה שטרם נוסתה נבחרת רק אחרי שגילה עבר את זמן החסד", () => {
    expect(source).toMatch(
      /providerRecordingAttemptAt:\s*null,\s*\n\s*occurredAt:\s*\{\s*lt:\s*new Date\(now - FIRST_ATTEMPT_GRACE_MS\)/u,
    );
  });

  it("שיחה צעירה שנכשלה מנוסה שוב בקצב הקצר ולא בארוך", () => {
    expect(source).toMatch(
      /providerRecordingAttemptAt:\s*\{\s*lt:\s*new Date\(now - EARLY_RETRY_MS\)\s*\},\s*\n\s*occurredAt:\s*\{\s*gte:\s*new Date\(now - YOUNG_CALL_MS\)/u,
    );
  });

  it("הקצב הארוך נשאר, עם חלון הוויתור שלו", () => {
    expect(source).toMatch(
      /providerRecordingAttemptAt:\s*\{\s*lt:\s*new Date\(now - RETRY_AFTER_MS\)\s*\},\s*\n(?:.*\n)*?\s*occurredAt:\s*\{\s*gte:\s*new Date\(now - GIVE_UP_AFTER_MS\)/u,
    );
  });

  /*
   * ‎**הלחיצה הידנית חייבת לשרוד.** „נסו למשוך שוב” מנקה את החותמת,
   * והמסלול היחיד שמרים שורה כזו הוא זה של „טרם נוסתה”. שיחה ישנה
   * עוברת את תנאי הגיל בקלות — אבל אילו התנאי היה `gte` במקום `lt`,
   * או מודד מהחותמת במקום מהשיחה, הכפתור היה מפסיק לעבוד בשקט. זה
   * כבר קרה כאן פעם אחת (ביקורת Codex על הגרסה הקודמת).
   */
  it("התנאי נמדד על מועד השיחה, כך שלחיצה ידנית על שיחה ישנה עוברת", () => {
    expect(source).not.toMatch(/providerRecordingAttemptAt:\s*null\s*\}/u);
    expect(source).toContain("occurredAt: { lt: new Date(now - FIRST_ATTEMPT_GRACE_MS) }");
  });
});

describe("רצף הסירובים נספר לכל משרד לחוד", () => {
  /*
   * מונה גלובלי אחד היה נותן למשרד אחד — אישורים שגויים, או שלוש
   * שיחות טריות ברצף — להקפיא את התור של כולם.
   */
  it("המונה מפתחי לפי משרד, ולא משתנה יחיד", () => {
    expect(source).toContain("const refusals = new Map<string, number>()");
    expect(source).toContain("nextRefusalStreak(refusals.get(job.tenantId) ?? 0, result)");
    expect(source).not.toContain("let refusalsInARow = 0");
  });

  /*
   * ‎**דילוג ולא `break`.** משרד שנבלם אינו מפיל את השאר, והשורות
   * שלו נשארות בתור בלי חותמת — כלומר בלי לשרוף את חלון הניסיון.
   */
  it("משרד שנבלם מדולג, והסבב ממשיך לשאר", () => {
    expect(source).toContain("if (paused.has(job.tenantId)) continue;");
    expect(source).toContain("paused.add(job.tenantId)");
  });
});

describe("היחסים בין הקבועים — מה שהופך אותם לסולם ולא לערימה", () => {
  it("זמן החסד קצר מהחלון של שיחה צעירה", () => {
    expect(RECORDING_FIRST_ATTEMPT_GRACE_MS).toBeLessThan(RECORDING_YOUNG_CALL_MS);
  });

  it("הניסיון החוזר הקצר אינו ארוך מחלון השיחה הצעירה", () => {
    expect(RECORDING_EARLY_RETRY_MS).toBeLessThanOrEqual(RECORDING_YOUNG_CALL_MS);
  });

  /*
   * שיחה צעירה חייבת להיות בתוך חלון הוויתור, אחרת ההסתעפות שלה
   * מרימה שורות שהמסך כבר הכריז עליהן „נכשלה סופית”.
   */
  it("חלון השיחה הצעירה נמצא בתוך חלון הוויתור", () => {
    expect(RECORDING_YOUNG_CALL_MS).toBeLessThan(RECORDING_GIVE_UP_MS);
  });
});
