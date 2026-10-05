import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECORDING_IMPORT_QUEUE_LIMIT, TELEPHONY_PROVIDERS } from "@metavchim/shared";

/**
 * ‎**ייבוא הקלטות — מה שהוא מבטיח בפועל.**
 *
 * ## הכשל שזה מונע
 *
 * הייבוא **אינו** מוריד אודיו. הוא מסמן שיחות, ומאפס עליהן את
 * חותמת הניסיון — מה שמכניס כל אחת מהן לראש **התור המשותף לכל
 * המשרדים**. הלולאה הייתה בלי תקרה, ולכן לחיצה אחת על טווח של
 * תשעים יום הכניסה מאות שיחות של משרד אחד לתור והשביתה את המשיכה
 * אצל כל השאר לשעות. איש לא ביקש זאת ואיש לא ראה זאת: מבחוץ
 * הייבוא פשוט „הצליח”.
 *
 * ## למה מבנית
 *
 * שתי שורות — `break` ותנאי — שאפשר להסיר בלי ששום בדיקה תרגיש,
 * ושהתוצאה שלהן מופיעה רק אצל **משרד אחר** ורק שעות אחר כך. זו
 * בדיוק הצורה שאין לה בדיקת התנהגות סבירה.
 */

const source = readFileSync(new URL("./recording-fetch.service.ts", import.meta.url), "utf8");

describe("תקרת התור בייבוא הקלטות", () => {
  /*
   * ‎**התקרה על `linked` דווקא, ולא על מספר השורות שנסרקו.**
   *
   * שורה שכבר סומנה, שורה בלי שיחה, ושורה של שיחה שלא נענתה —
   * שלושתן אינן תופסות מקום בתור (`pendingFor` מסנן את השלישית
   * ב-`outcome: { notIn: UNANSWERED_OUTCOMES }`). תקרה על מספר
   * השורות הייתה חוסמת ייבוא שכולו כבר-סומן אחרי מאה שורות, ומחייבת
   * עשר לחיצות כדי לא לסמן דבר.
   */
  it("הלולאה נעצרת על מה שנכנס לתור, ולא על מה שנסרק", () => {
    expect(source).toMatch(/if \(linked >= RECORDING_IMPORT_QUEUE_LIMIT\) break;/u);
    expect(RECORDING_IMPORT_QUEUE_LIMIT).toBeGreaterThan(0);
  });

  /*
   * ‏מה שלא נבדק חייב לחזור למסך. בלי זה לחיצה על טווח גדול נראית
   * כמו סיום, והמשרד נשאר עם שאר ההקלטות אצל הספק עד שיימחקו שם.
   */
  it("מה שלא נבדק נספר ומוחזר", () => {
    expect(source).toContain("const remaining = rows.length - examined;");
    expect(source).toMatch(/return \{[^}]*\bremaining,/su);
  });

  /*
   * ‎**קצב הסבב מיובא ולא נכתב שוב.** המסך אומר למי שלחץ כמה זמן
   * זה ייקח, והמשפט נגזר מהמספרים האלה. שני עותקים היו מסכימים רק
   * ביום שנכתבו — וזה הכשל ש-`RECORDING_GIVE_UP_MS` כבר תוקן בו.
   */
  it("קצב הסבב מגיע מהחבילה המשותפת", () => {
    expect(source).toContain("const TICK_MS = RECORDING_SWEEP_TICK_MS;");
    expect(source).toContain("const MAX_PER_SWEEP = RECORDING_SWEEP_MAX;");
  });
});

describe("איזה ספק בכלל יודע למשוך", () => {
  /*
   * ‎**הדגל בקטלוג חייב להסכים עם השאילתה שבסבב.**
   *
   * ‏שני מסכים מציעים „ייבוא הקלטות” — של המשרד ושל שולחן החיבורים —
   * ‏ושניהם שואלים את `recordingImport`. המנוע לעומת זאת מדבר עם
   * ‏ספק אחד בלבד, וזה כתוב ב-`PULLING_CONNECTION`. אם הדגל יסטה
   * ‏ממנו, המסך יזמין פעולה שחוזרת ב-400 ויאשים את המשתמש במה
   * ‏שהוא עצמו הציע.
   */
  it("`recordingImport` מסכים עם `PULLING_CONNECTION`", () => {
    const match = /const PULLING_CONNECTION = \{[^}]*provider: "([^"]+)"/su.exec(source);
    expect(match, "לא נמצא הספק ב-PULLING_CONNECTION").not.toBeNull();
    expect(TELEPHONY_PROVIDERS.filter((p) => p.recordingImport).map((p) => p.id)).toEqual([
      match?.[1],
    ]);
  });
});
