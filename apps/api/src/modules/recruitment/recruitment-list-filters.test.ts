import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import type { PropertiesService } from "../properties/properties.service";
import { RecruitmentService } from "./recruitment.service";

/**
 * ‎**רשימת הגיוס — שאפשר לחפש בה, ולמחוק ממנה בבת אחת.**
 *
 * ‏רשימת גיוס גדלה מהר יותר מרשימת הנכסים: כל מודעה שנראתה נכנסת
 * ‏אליה, וייבוא אחד מביא אלף שורות. עד עכשיו אפשר היה לסנן בה
 * ‏לפי שלב בלבד, ולמחוק שורה-שורה עם אישור לכל אחת.
 *
 * ‏הטענות כאן הן על **השאילתה** — אילו תנאים נשלחו למסד — ולכן
 * ‏כפיל שרושם אותה עונה עליהן במלואן, ומסד אמיתי היה מוסיף עלות
 * ‏בלי להוסיף ביטחון.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";

interface Call {
  op: string;
  args: Record<string, unknown>;
}

function serviceFor(rows: unknown[] = []): {
  service: RecruitmentService;
  calls: Call[];
} {
  const calls: Call[] = [];
  const model = {
    findMany: (args: Record<string, unknown>) => {
      calls.push({ op: "findMany", args });
      return Promise.resolve(rows);
    },
    updateMany: (args: Record<string, unknown>) => {
      calls.push({ op: "updateMany", args });
      /* ‏מחיקה שמצאה שורה אחת — כמו במסלול האמיתי */
      return Promise.resolve({ count: 1 });
    },
    deleteMany: (args: Record<string, unknown>) => {
      calls.push({ op: "deleteMany", args });
      return Promise.resolve({ count: 0 });
    },
  };
  const tx = {
    recruitmentTarget: model,
    task: {
      updateMany: (args: Record<string, unknown>) => {
        calls.push({ op: "task.updateMany", args });
        return Promise.resolve({ count: 0 });
      },
      deleteMany: (args: Record<string, unknown>) => {
        calls.push({ op: "task.deleteMany", args });
        return Promise.resolve({ count: 0 });
      },
    },
    $executeRaw: () => Promise.resolve(0),
    $executeRawUnsafe: () => Promise.resolve(0),
    $queryRaw: () => Promise.resolve([]),
  };
  const prisma = {
    withTenant: (run: (tx: unknown) => Promise<unknown>) => run(tx),
  } as unknown as PrismaService;
  return {
    service: new RecruitmentService(prisma, {} as unknown as PropertiesService),
    calls,
  };
}

function asAgent<T>(fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: TENANT,
      userId: "01MEAAAAAAAAAAAAAAAAAAAAAA",
      capabilities: new Set(["properties.view", "properties.delete"]),
      billingOnly: false,
    } as never,
    fn,
  );
}

/** ‏תנאי ה-`where` של השליפה — הדבר היחיד שנבדק כאן. */
async function whereFor(query: Parameters<RecruitmentService["list"]>[0]): Promise<
  Record<string, unknown>
> {
  const { service, calls } = serviceFor();
  await asAgent(() => service.list(query));
  return (calls[0]?.args as { where: Record<string, unknown> }).where;
}

describe("‏סינון רשימת הגיוס", () => {
  it("‏בלי סינון — הרשימה כפי שהייתה", async () => {
    expect(await whereFor({})).toEqual({ tenantId: TENANT, deletedAt: null });
  });

  /*
   * ‎**המסך מדבר בשקלים, המסד שומר אגורות.** מספר שהיה עובר כמות
   * ‏שהוא היה מסנן „עד 2,000,000 אגורות” — כלומר עד עשרים אלף ש"ח,
   * ‏ומחזיר רשימה ריקה על סינון שנראה סביר לגמרי.
   */
  it("‏ממיר את טווח המחיר לאגורות", async () => {
    const where = await whereFor({ minPrice: 1_000_000, maxPrice: 2_000_000 });
    expect(where["priceAgorot"]).toEqual({ gte: 100_000_000, lte: 200_000_000 });
  });

  it("‏מסנן לפי חדרים ולפי גודל, כל אחד בנפרד", async () => {
    expect((await whereFor({ minRooms: 3, maxRooms: 4 }))["rooms"]).toEqual({ gte: 3, lte: 4 });
    expect((await whereFor({ minArea: 80 }))["areaSqm"]).toEqual({ gte: 80 });
  });

  /*
   * ‏„מ-3,000,000 עד 1,000,000” הוא טווח שהוקלד הפוך, ולא שגיאה:
   * ‏אפס תוצאות נראה כמו מערכת שבורה. אותה נורמליזציה של הנכסים.
   */
  it("‏מהפך טווח שהוקלד הפוך במקום להחזיר כלום", async () => {
    const where = await whereFor({ minPrice: 3_000_000, maxPrice: 1_000_000 });
    expect(where["priceAgorot"]).toEqual({ gte: 100_000_000, lte: 300_000_000 });
  });

  it("‏כל מונח חייב להתאים, וכל אחד יכול להתאים בשדה אחר", async () => {
    const where = await whereFor({ q: "לחי בני ברק" });
    const and = where["AND"] as { OR: Record<string, unknown>[] }[];
    /* ‏שלושה מונחים — הפיצול הוא על רווחים, כמו בכל הרשימות */
    expect(and).toHaveLength(3);
    expect(and[0]?.OR.some((c) => "street" in c)).toBe(true);
    expect(and[0]?.OR.some((c) => "city" in c)).toBe(true);
  });

  /*
   * ‎**שם הבעלים אינו שדה חיפוש — וזו הכרעה, לא השמטה.**
   *
   * ‏רשימת הגיוס משרדית, ולכן חיפוש לפי שם בעלים היה הופך אותה
   * ‏לכלי לאיתור אנשים על פני כל מה שכל סוכן במשרד רודף אחריו.
   * ‏השאלה שהמסך הזה עונה עליה היא „איפה הנכס”.
   */
  it("‏אינו מחפש בשם הבעלים ולא בטלפון שלו", async () => {
    const where = await whereFor({ q: "דבורה" });
    const and = where["AND"] as { OR: Record<string, unknown>[] }[];
    const fields = and.flatMap((clause) => clause.OR.flatMap((c) => Object.keys(c)));
    expect(fields).not.toContain("ownerName");
    expect(fields).not.toContain("ownerPhone");
  });

  /*
   * ‏הסוג נשמר באנגלית והמסך מבטיח חיפוש בעברית. בלי התרגום
   * ‏„פנטהאוס” היה מוצא נכס רק אם המילה הופיעה במקרה בהערה.
   */
  /*
   * ‎**ובשני הכתיבים.** ההשוואה רצה מול כל הכתיבים שהמפה מכירה
   * ‏ולא מול התווית הקנונית בלבד, ולכן „פנטהאוס” בסמ"ך מוצא בדיוק
   * ‏כמו „פנטהאוז” בזי"ן.
   */
  it("‏מתרגם סוג נכס שהוקלד בעברית", async () => {
    const where = await whereFor({ q: "פנטהאוס" });
    const and = where["AND"] as { OR: Record<string, unknown>[] }[];
    const types = and[0]?.OR.find((c) => "propertyType" in c) as
      | { propertyType: { in: string[] } }
      | undefined;
    expect(types?.propertyType.in).toContain("penthouse");
  });

  it("‏מצרף שלב, מקור ועיר לתנאי מדויק", async () => {
    const where = await whereFor({ status: "called", source: "yad2", city: "בני ברק" });
    expect(where).toMatchObject({ status: "called", source: "yad2", city: "בני ברק" });
  });
});

describe("‏מחיקה מרוכזת", () => {
  /*
   * ‎**עוברת דרך המחיקה הבודדת, ולא דרך `updateMany` על הכול.**
   *
   * ‏המחיקה הבודדת נועלת את השורה ומנקה את הפולואפים שתלויים בה.
   * ‏מסלול שני שכותב את השאילתות בעצמו היה שוכח את הניקוי ביום
   * ‏שבו הראשון ישתנה — ומשאיר משימות פתוחות על שורות שאינן.
   */
  it("‏מנקה את הפולואפים של כל שורה, כמו המחיקה הבודדת", async () => {
    const { service, calls } = serviceFor();
    const result = await asAgent(() => service.removeMany(["01A", "01B"]));
    expect(result).toEqual({ removed: 2, skipped: 0 });
    expect(calls.filter((c) => c.op === "task.updateMany")).toHaveLength(2);
    expect(calls.filter((c) => c.op === "task.deleteMany")).toHaveLength(2);
  });

  /*
   * ‏שורה שכבר נמחקה אינה שגיאה — אבל מסך שאומר „נמחקו 40” על
   * ‏שתים-עשרה הוא שקר. הספירה מפרידה בין השתיים.
   */
  it("‏מדלגת על שורה שאינה קיימת ומדווחת על כך", async () => {
    const { service } = serviceFor();
    const missing = new RecruitmentService(
      {
        withTenant: (run: (tx: unknown) => Promise<unknown>) =>
          run({
            recruitmentTarget: { updateMany: () => Promise.resolve({ count: 0 }) },
            task: { updateMany: () => Promise.resolve({}), deleteMany: () => Promise.resolve({}) },
            $executeRaw: () => Promise.resolve(0),
            $executeRawUnsafe: () => Promise.resolve(0),
            $queryRaw: () => Promise.resolve([]),
          }),
      } as unknown as PrismaService,
      {} as unknown as PropertiesService,
    );
    await expect(asAgent(() => missing.remove("01A"))).rejects.toBeInstanceOf(NotFoundException);
    expect(await asAgent(() => missing.removeMany(["01A", "01B"]))).toEqual({
      removed: 0,
      skipped: 2,
    });
    /* ‏והמסלול התקין ממשיך לספור נכון */
    expect(await asAgent(() => service.removeMany(["01A"]))).toEqual({ removed: 1, skipped: 0 });
  });
});
