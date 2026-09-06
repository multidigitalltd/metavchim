import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**מנוי לפני משרד — בכל טרנזקציה שנוגעת בשתיהן.**
 *
 * ## ‏מה זה שומר
 *
 * ‏`UPDATE` נועל את השורות שהוא נוגע בהן, ולכן `tx.tenant.updateMany`
 * ‏הוא נעילה על שורת המשרד בדיוק כמו `SELECT … FOR UPDATE`. שני
 * ‏מסלולים שנוגעים באותן שתי טבלאות בסדר הפוך סוגרים מעגל,
 * ‏ו-Postgres מפיל אחד מהם.
 *
 * ‏וזה קרה: `deletePlan` עדכן משרדים ואז מנויים, בזמן
 * ‏ש-`switchToFreePlan` ו-`close` של המשפך נועלים מנוי ואז משרד.
 * ‏מחיקת מסלול שמתנגשת עם סבב המשפך על משרד באותו מסלול הפילה אחת
 * ‏מהשתיים (ביקורת Codex, P2).
 *
 * ## ‏למה שער ולא הערה
 *
 * ‏`common/locks.ts` נושא את הסולם המלא בכתב, וזו הפעם השלישית
 * ‏שרונג בו נשבר בקוד שנכתב אחריו. הערה אינה נקראת בזמן כתיבה;
 * ‏שער כן.
 *
 * ‏הבדיקה עוברת על **גופי הטרנזקציות** ולא על הקובץ כולו: שתי
 * ‏טרנזקציות נפרדות באותו קובץ אינן נועלות יחד, וטענה ברמת הקובץ
 * ‏הייתה נופלת עליהן לשווא.
 */

const API_SRC = new URL("..", import.meta.url).pathname;

/** ‏הקוד בלי הערות — הערה שמזכירה טבלה אינה נוגעת בה. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");
}

function sourceFiles(dir: string, prefix = ""): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [{ name: rel, code: codeOnly(readFileSync(join(dir, entry.name), "utf8")) }];
  });
}

/**
 * ‏גופי הקולבקים שמקבלים `tx` — כלומר טרנזקציה אחת כל אחד.
 * ‏הגבול נמצא בספירת סוגריים מסולסלים, ולכן הוא עמיד לקינון.
 */
function transactionBodies(code: string): string[] {
  const out: string[] = [];
  const opener = /\(\s*(?:async\s*)?\(\s*tx\b[^)]*\)\s*=>\s*\{/gu;
  for (const match of code.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (; end < code.length; end += 1) {
      if (code[end] === "{") depth += 1;
      else if (code[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(code.slice(start, end));
  }
  return out;
}

/** ‏נגיעה שנועלת: כתיבה דרך Prisma, או `FOR UPDATE` ב-SQL גולמי. */
const TENANT_LOCK = /tx\.tenant\.(?:update|updateMany|upsert|delete|deleteMany|create)\b|FROM tenants\b[^`]*FOR UPDATE/u;
const SUBSCRIPTION_LOCK =
  /tx\.subscription\.(?:update|updateMany|upsert|delete|deleteMany|create)\b|FROM subscriptions\b[^`]*FOR UPDATE/u;

describe("שער: סדר הנעילות — מנוי לפני משרד", () => {
  const files = sourceFiles(API_SRC);
  const bodies = files.flatMap((file) =>
    transactionBodies(file.code).map((body) => ({ name: file.name, body })),
  );

  /*
   * ‏בלי זה השער ירוק על כלום: ביטוי שנשבר או תיקייה שזזה היו
   * ‏הופכים אותו לבדיקה שעוברת תמיד.
   */
  it("יש מה לבדוק", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(bodies.length).toBeGreaterThan(50);
    const both = bodies.filter(
      (b) => TENANT_LOCK.test(b.body) && SUBSCRIPTION_LOCK.test(b.body),
    );
    expect(both.length, "אף טרנזקציה אינה נוגעת בשתי הטבלאות — הסריקה נשברה")
      .toBeGreaterThan(0);
  });

  it("כל טרנזקציה שנוגעת בשתיהן נועלת קודם את המנוי", () => {
    const reversed = bodies
      .filter((b) => TENANT_LOCK.test(b.body) && SUBSCRIPTION_LOCK.test(b.body))
      .filter((b) => {
        const tenant = b.body.search(TENANT_LOCK);
        const subscription = b.body.search(SUBSCRIPTION_LOCK);
        return tenant < subscription;
      })
      .map((b) => b.name);
    expect(
      [...new Set(reversed)],
      `נועלים משרד לפני מנוי — מעגל deadlock: ${[...new Set(reversed)].join(", ")}`,
    ).toEqual([]);
  });
});
