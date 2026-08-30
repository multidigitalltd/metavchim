import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "@metavchim/shared";
import { PlanCatalogService } from "./plan-catalog.service";
import type { PrismaService } from "./prisma.service";

/**
 * הקטלוג ממזג מסלולים מובנים עם השורות שנשמרו, ולכן "מחיקה" שלו
 * אינה מחיקת שורה: מסלול מובנה שמעולם לא נערך אין לו שורה למחוק,
 * ומחיקת שורה של מסלול מובנה שכן נערך מחזירה אותו לחיים בהגדרות
 * המקוריות. הבדיקה הזו נכתבה על הממצא הזה (ביקורת Codex, PR #126).
 */

type PlanRow = Parameters<PlanCatalogService["all"]> extends never ? never : Record<string, unknown>;

/** Prisma מזויף שמחזיר שורות נתונות — בלי מסד, בלי חיבור. */
function catalogWith(rows: PlanRow[]): PlanCatalogService {
  const prisma = {
    plan: { findMany: async () => rows },
  } as unknown as PrismaService;
  return new PlanCatalogService(prisma);
}

/** שורת מסלול מלאה, כפי ש-Prisma מחזירה. */
function row(code: string, overrides: Record<string, unknown> = {}): PlanRow {
  return {
    code,
    name: `מסלול ${code}`,
    description: "",
    monthlyPriceAgorot: 10_000,
    yearlyPriceAgorot: null,
    maxUsers: null,
    maxProperties: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: [],
    trialDays: 14,
    isPublic: true,
    priceOnRequest: false,
    sortOrder: 1,
    retiredAt: null,
    ...overrides,
  };
}

describe("קטלוג המסלולים", () => {
  const builtIn = DEFAULT_PLANS[0]!.code;

  /**
   * ‎**שדה שנקרא ולא נכתב.**
   *
   * ‎`whatsappSeatMonthlyAgorot` נוסף לעורך, לסכימה ולקריאה — ולא
   * לרשימת השדות שנכתבת. העורך שמר, השרת ענה „נשמר”, וטעינה מחדש
   * החזירה `null`: כלומר מחיר שאי אפשר להגדיר, בלי שום סימן לתקלה.
   *
   * הבדיקה עוברת על **מפתחות המסלול עצמו** ולא על רשימה שנכתבת
   * כאן ביד — רשימה ידנית שנייה הייתה נשכחת יחד עם הראשונה.
   */
  it("שמירה כותבת כל שדה של המסלול, ולא רק את אלה שנזכרו ביד", async () => {
    const written: Record<string, unknown>[] = [];
    const prisma = {
      plan: {
        findMany: async () => [],
        upsert: async (args: { update: Record<string, unknown> }) => {
          written.push(args.update);
        },
      },
    } as unknown as PrismaService;

    const plan = { ...DEFAULT_PLANS[0]!, whatsappSeatMonthlyAgorot: 19_950 };
    await new PlanCatalogService(prisma).upsert(plan, "tester");

    const data = written[0]!;
    for (const field of Object.keys(plan)) {
      // `code` הוא מפתח ה-`where`, ולא שדה שמתעדכן
      if (field === "code") continue;
      expect(data, `שדה שנשמט מהכתיבה: ${field}`).toHaveProperty(field);
    }
    expect(data.whatsappSeatMonthlyAgorot).toBe(19_950);
  });

  it("מסלול מובנה שלא נערך מופיע בקטלוג", async () => {
    const codes = (await catalogWith([]).all()).map((p) => p.code);
    expect(codes).toContain(builtIn);
  });

  it("שורת פרישה מוציאה מסלול **מובנה** מהקטלוג", async () => {
    /*
     * זה הלב: בלי הדגל, המיזוג היה מחזיר את המסלול המובנה בכל
     * קריאה — כלומר "נמחק" ומיד חזר, בהגדרות שלפני העריכה.
     */
    const catalog = catalogWith([row(builtIn, { retiredAt: new Date() })]);
    const codes = (await catalog.all()).map((p) => p.code);
    expect(codes).not.toContain(builtIn);
  });

  it("שורת פרישה מוציאה גם מסלול מותאם", async () => {
    const catalog = catalogWith([
      row("custom_a"),
      row("custom_b", { retiredAt: new Date() }),
    ]);
    const codes = (await catalog.all()).map((p) => p.code);
    expect(codes).toContain("custom_a");
    expect(codes).not.toContain("custom_b");
  });

  it("מסלול פרוש אינו נמצא ב-byCode — כלומר גם לא בשערי הפיצ'רים", async () => {
    const catalog = catalogWith([row(builtIn, { retiredAt: new Date() })]);
    expect(await catalog.byCode(builtIn)).toBeUndefined();
  });

  it("שורה פעילה גוברת על ברירת המחדל המובנית", async () => {
    const catalog = catalogWith([row(builtIn, { name: "שם שנערך" })]);
    expect((await catalog.byCode(builtIn))?.name).toBe("שם שנערך");
  });
});
