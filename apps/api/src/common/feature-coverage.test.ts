import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_FEATURES } from "@metavchim/shared";

/**
 * שומר מבני: לכל פיצ'ר בקטלוג יש נקודת אכיפה.
 *
 * הרקע: מסך הפלטפורמה מציג את כל הפיצ'רים כתיבות סימון, ומבטיח
 * שהסרת סימון סוגרת את היכולת. פיצ'ר שקיים בקטלוג אך אף נתיב לא
 * מצהיר עליו הופך את ההבטחה לשקר — התיבה מסומנת, המסלול נשמר,
 * וה-API ממשיך לעבוד בדיוק כמו קודם.
 *
 * הכשל הזה שקט לחלוטין: אין שגיאה, אין לוג, ואף בדיקה קיימת לא
 * נוגעת בו. הוא התגלה בביקורת Codex על חמישה פיצ'רים בבת אחת, ולכן
 * הוא נאכף כאן ולא מתועד בהערה.
 *
 * מה נחשב אכיפה: `@RequireFeature("x")` על בקר או על נתיב, או
 * `tenantHasFeature(..., "x")` בשירות — האחרון הכרחי לנתיבים
 * ציבוריים, שאין להם הקשר דייר בזמן השער.
 */

const API_SRC = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** קודי הפיצ'רים שמופיעים כנקודת אכיפה בקוד. */
function enforcedFeatures(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/RequireFeature\(\s*"([a-z_]+)"/gu)) {
    found.push(match[1]!);
  }
  for (const match of source.matchAll(/tenantHasFeature\([^)]*?"([a-z_]+)"/gu)) {
    found.push(match[1]!);
  }
  return found;
}

describe("כיסוי פיצ'רים של המסלול", () => {
  const files = sourceFiles(API_SRC).filter((f) => !f.endsWith("feature.guard.ts"));
  const enforced = new Set(files.flatMap((file) => enforcedFeatures(readFileSync(file, "utf8"))));

  it("הבדיקה עצמה מזהה את שתי צורות האכיפה", () => {
    // בלי האימות הזה, ביטוי רגולרי שבור היה הופך את הבדיקה לירוקה תמיד
    expect(enforcedFeatures('@RequireFeature("analytics")')).toEqual(["analytics"]);
    expect(enforcedFeatures("await this.plans.tenantHasFeature(id, \"telephony\")")).toEqual([
      "telephony",
    ]);
    expect(enforcedFeatures("const x = 1;")).toEqual([]);
  });

  it("כל פיצ'ר בקטלוג נאכף במקום כלשהו", () => {
    const unenforced = PLAN_FEATURES.map((f) => f.code).filter((code) => !enforced.has(code));
    expect(unenforced).toEqual([]);
  });

  it("אין אכיפה על קוד פיצ'ר שאינו בקטלוג", () => {
    // הכיוון ההפוך: שער על קוד שהוקלד שגוי לא יחסום אף אחד לעולם
    const known = new Set<string>(PLAN_FEATURES.map((f) => f.code));
    expect([...enforced].filter((code) => !known.has(code))).toEqual([]);
  });
});
