import { describe, expect, it } from "vitest";
import { workersSource } from "./workers-source.testkit";

/**
 * ‎**הקשר המשרד בעובדים — במקום אחד, ונשאר במקום אחד.**
 *
 * ‏כל גישה של העובדים לנתוני משרד עוברת ב-`withTenant` (`runtime.ts`),
 * ‏שקובע את `app.tenant_id` שעליו נשענת ה-RLS. ארבעים ושתיים משימות כתבו
 * ‏את זה בעצמן; עותק חדש שכותב אותו אחרת — או שוכח — הוא בדיוק המקום
 * ‏שבו משימה רואה נתונים של משרד אחר, או אפס שורות בשקט.
 */

const RUNTIME = workersSource("runtime.ts");
const ALL = workersSource();

describe("הקשר המשרד בעובדים", () => {
  it("`set_config('app.tenant_id'` נכתב רק ב-`withTenant`", () => {
    const occurrences = ALL.match(/set_config\('app\.tenant_id'/gu) ?? [];
    expect(occurrences, "השתמשו ב-withTenant מ-runtime.ts").toHaveLength(1);
    expect(RUNTIME).toContain("set_config('app.tenant_id'");
  });

  it("‏`withTenant` קובע את המשרד לפני הקריאה, באותה טרנזקציה", () => {
    const body = RUNTIME.slice(RUNTIME.indexOf("export function withTenant"));
    const set = body.indexOf("set_config('app.tenant_id', ${tenantId}, true)");
    expect(body).toContain("prisma.$transaction(async (tx) =>");
    expect(set).toBeGreaterThan(0);
    expect(set).toBeLessThan(body.indexOf("return fn(tx)"));
  });
});
