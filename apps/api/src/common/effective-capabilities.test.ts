import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * שומר מבני: המסכים לא גוזרים את ההרשאות של המשתמש המחובר מ-
 * `ROLE_CAPABILITIES`.
 *
 * הרקע: `ROLE_CAPABILITIES[role]` היא ברירת המחדל של התפקיד. מרגע
 * שנוספו חריגים ברמת המשתמש (#80), השרת מחשב קבוצה אפקטיבית בכל
 * בקשה — והשתיים נפרדות. מסך שגוזר מהתפקיד מציג כפתור לסוכן שנחסמה
 * לו היכולת (403 בלחיצה), ומסתיר אותו מ-viewer שקיבל אותה במפורש.
 *
 * הפער הזה שקט משני הכיוונים: אין שגיאה, רק מסך שמבטיח משהו שהשרת
 * ידחה או מסתיר משהו שהוא היה מאשר. לכן הכלל נאכף ולא מתועד בהערה.
 *
 * מה שמותר: הצגת **ברירת המחדל של תפקיד** — מסך ניהול ההרשאות מציג
 * בדיוק את זה, ומסמן מעליה את החריגים. ההבדל הוא אם הביטוי מסתמך על
 * המשתמש המחובר (`user`), ורק זה נאסר.
 */

const WEB_SRC = resolve(__dirname, "../../../web/src");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsxFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * מאתר `ROLE_CAPABILITIES[...]` שהאינדקס שלו נגזר מהמשתמש המחובר.
 *
 * מכוון להיות צר: `ROLE_CAPABILITIES[member.role]` בטבלת הצוות אינו
 * הפרה — הוא באמת מתאר את ברירת המחדל של תפקיד של מישהו אחר.
 */
const OFFENDING = /ROLE_CAPABILITIES\[\s*user[\s?.]/u;

/**
 * שורות הערה נזרקות: התיעוד של הכלל מצטט את התבנית שהוא אוסר, וזו
 * בדיוק הסיבה שהוא נכתב. בלי הסינון הזה הבדיקה נופלת על ההסבר של
 * עצמה.
 */
const COMMENT = /^\s*(\/\/|\/?\*)/u;

function violations(source: string): number[] {
  return source
    .split("\n")
    .map((line, index) => (!COMMENT.test(line) && OFFENDING.test(line) ? index + 1 : 0))
    .filter((n) => n > 0);
}

describe("הרשאות במסכים", () => {
  const files = tsxFiles(WEB_SRC);

  it("מוצא את קבצי המסכים", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("הבדיקה עצמה תופסת את התבנית האסורה", () => {
    // בלי האימות הזה, ביטוי רגולרי שבור היה הופך את הבדיקה לירוקה תמיד
    expect(violations('const x = (ROLE_CAPABILITIES[user.role] ?? []).includes("a");')).toEqual([1]);
    expect(violations('const x = ROLE_CAPABILITIES[user?.role ?? ""];')).toEqual([1]);
    // ותופסת רק אותה — ברירת מחדל של תפקיד של מישהו אחר מותרת
    expect(violations("const caps = ROLE_CAPABILITIES[member.role] ?? [];")).toEqual([]);
    // וגם ציטוט התבנית בתוך הערה אינו הפרה
    expect(violations(" * אין לגזור מ-ROLE_CAPABILITIES[user.role]")).toEqual([]);
  });

  it("אף מסך לא גוזר את הרשאות המשתמש המחובר מברירת המחדל של התפקיד", () => {
    const offenders = files
      .filter((file) => violations(readFileSync(file, "utf8")).length > 0)
      .map((file) => file.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
