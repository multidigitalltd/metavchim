import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**עותק אחד של `@prisma/client` בכל המאגר.**
 *
 * ‏‎`@prisma/client`‎ מצהיר על `typescript` כ-peer, ו-pnpm יוצר עותק נפרד לכל
 * ‏גרסה של TypeScript שה-peer נפתר אליה. ‏‎`prisma generate`‎ כותב את הקליינט
 * ‏לעותק אחד בלבד — ולכן חבילה שנפתרה לעותק השני מקבלת קליינט בלי טיפוסים,
 * ‏והבנייה נופלת (‎`Type '{}' is not assignable`‎).
 *
 * ‏כך בדיוק קרה בשדרוג ל-Nest 12: ‏‎`@nestjs/cli`‎ משך TypeScript 6, וה-Workers,
 * ‏שלא הצהירו על TypeScript בעצמם, נפתרו אליו. ‏הבדיקות המקומיות עברו (‏node_modules
 * ‏ישן), ורק בניית ה-Docker — שרצה ב-CI על main בלבד — נשברה. השער כאן תופס את
 * ‏זה כבר בבדיקות היחידה: חבילה שמשתמשת ב-Prisma מצהירה על אותה TypeScript.
 */

const LOCKFILE = readFileSync(join(import.meta.dirname, "../../../../pnpm-lock.yaml"), "utf8");

describe("‏@prisma/client — עותק אחד", () => {
  it("בקובץ הנעילה יש וריאנט יחיד של @prisma/client", () => {
    const variants = [...LOCKFILE.matchAll(/^ {2}'@prisma\/client@[^']*\(.*\)':$/gmu)].map((m) => m[0].trim());
    expect(variants, "חבילה שמשתמשת ב-Prisma צריכה להצהיר על typescript באותה גרסה").toHaveLength(1);
  });
});
