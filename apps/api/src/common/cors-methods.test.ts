import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**רשימת הפעלים ב-CORS מכסה כל פועל שבקר מצהיר עליו.**
 *
 * ## איך זה נשבר, ולמה אף אחד לא ראה
 *
 * ‎`PUT` נעדר מ-`enableCors`, ושלושה מסלולים כאלה כבר קיימים:
 * הרשאות משתמש, תבניות הסכם, ויעדי המנטור. הדפדפן קיבל עליהם
 * ‎`net::ERR_FAILED` — **בלי סטטוס, בלי גוף, ובלי שהבקשה הגיעה
 * לשרת**. במסך זה נראה כמו „שמירה נכשלה” בלי סיבה, ובלוג של השרת
 * לא היה כלום לחפש.
 *
 * ‏ומה שהופך את זה למלכודת: **בייצור זה עובד**. שם
 * ‎`NEXT_PUBLIC_API_URL` ריק, הדפדפן פונה ל-`/api/v1` על אותו מקור,
 * ו-CORS אינו רץ כלל. בפיתוח (‎:3000 מול ‎:3001) הוא כן. כלומר
 * הפיתוח שיקר לגבי הייצור — וזה בדיוק הכיוון המסוכן: תקלה שנראית
 * רק אצל המפתח נסגרת בתור „משהו בסביבה שלי”.
 *
 * ‏הבדיקה גוזרת את הרשימה מהבקרים ולא מרשימה ידנית: הפועל הבא
 * שיצהיר עליו מישהו יתפס כאן, ולא בדפדפן.
 */

const SRC = join(import.meta.dirname, "..");

/** כל קובצי ה-`*.controller.ts` תחת `src`. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (entry.name.endsWith(".controller.ts")) out.push(full);
  }
  return out;
}

/** הפעלים שהבקרים מצהירים עליהם בפועל. */
function declaredMethods(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of controllerFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete|Head|Options)\(/gu)) {
      const verb = match[1]!.toUpperCase();
      const files = found.get(verb) ?? [];
      if (!files.includes(file)) files.push(file);
      found.set(verb, files);
    }
  }
  return found;
}

/** מה ש-`enableCors` מתיר. */
function allowedMethods(): string[] {
  const main = readFileSync(join(SRC, "main.ts"), "utf8");
  const block = /methods:\s*\[([^\]]*)\]/u.exec(main);
  if (block === null) return [];
  return [...block[1]!.matchAll(/"([A-Z]+)"/gu)].map((m) => m[1]!);
}

describe("CORS — הפעלים המותרים מכסים את הבקרים", () => {
  it("יש בקרים ופעלים לבדוק בכלל", () => {
    /*
     * ‏המשוכה מול „ירוק על אפס”: סריקה שלא מצאה בקרים הייתה עוברת
     * את הבדיקה למטה בלי לומר מילה — וזה בדיוק הכשל שהיא נועדה
     * למנוע.
     */
    expect(controllerFiles(SRC).length).toBeGreaterThan(20);
    expect(declaredMethods().size).toBeGreaterThan(3);
    expect(allowedMethods().length).toBeGreaterThan(3);
  });

  it("כל פועל שמוצהר בבקר מותר ב-CORS", () => {
    const allowed = new Set(allowedMethods());
    /*
     * ‎`HEAD` ו-`OPTIONS` אינם נדרשים ברשימה: הדפדפן שולח אותם
     * בעצמו כחלק מהפרוטוקול, והשרת עונה עליהם לפני שהרשימה נקראת.
     */
    const exempt = new Set(["HEAD", "OPTIONS"]);
    const missing = [...declaredMethods().entries()]
      .filter(([verb]) => !exempt.has(verb) && !allowed.has(verb))
      .map(([verb, files]) => `${verb} (למשל ${files[0]!.replace(SRC, "src")})`);

    expect(missing).toEqual([]);
  });

  it("‎`PUT` ברשימה — הפועל שנעדר ממנה ושבר שלושה מסכים", () => {
    // הרגרסיה עצמה, בשמה, כדי שהיא לא תחזור בשקט
    expect(allowedMethods()).toContain("PUT");
  });
});
