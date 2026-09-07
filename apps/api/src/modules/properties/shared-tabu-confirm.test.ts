import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { PrismaService } from "../../core/prisma.service";
import { PropertiesService } from "./properties.service";
import { fieldsToColumns } from "./property.mapper";

/**
 * ‎**„מי כבר נשאל” — ולא מצב שלישי בעמודה.**
 *
 * ‏מנוע ההתאמות **פוסל** נכס בטאבו משותף מקונה שסירב. נכס שרשום
 * ‏במשותף ולא סומן נקרא `false`, ולכן הוא מוצע דווקא למי שאמר
 * ‏„לא”. ‎`NULL` בדגל עצמו לא היה פותר: או שהוא נקרא כ„לא” ושום
 * ‏דבר לא משתנה, או שהוא חוסם — וכל המאגר הקיים מפסיק להיות מוצע.
 *
 * ‏לכן החותמת נפרדת מהדגל, וזו הטענה שנשמרת כאן: **מה שכותב אותה
 * ‏הוא תשובה, ולא שמירה.** חותמת שאפשר לקבל בטעות אינה עדות, והמסך
 * ‏שנשען עליה היה מתרוקן בלי שאיש בדק דבר.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const PROP = "01PROPAAAAAAAAAAAAAAAAAAAA";

interface Call {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

function serviceFor(
  rows: Record<string, unknown>[],
  current: Record<string, unknown> | null = { propertyType: null },
): { service: PropertiesService; calls: Call[] } {
  const calls: Call[] = [];
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: Record<string, unknown>) => {
          calls.push({ model: name, method, args: args ?? {} });
          if (name === "property" && method === "findMany") return Promise.resolve(rows);
          if (name === "property" && method === "findFirst") return Promise.resolve(current);
          if (method === "count") return Promise.resolve(7);
          if (method === "findMany") return Promise.resolve([]);
          if (method === "findFirst" || method === "findUnique") return Promise.resolve(null);
          return Promise.resolve({ count: 1 });
        },
      },
    );
  const models: Record<string, unknown> = {};
  const tx = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name.startsWith("$")) return () => Promise.resolve([]);
        models[name] ??= model(name);
        return models[name];
      },
    },
  );
  const prisma = {
    withTenant: (run: (tx: unknown) => Promise<unknown>) => run(tx),
  } as unknown as PrismaService;
  const none = {} as never;
  return {
    service: new PropertiesService(
      prisma,
      none,
      none,
      { recomputeForProperty: () => Promise.resolve() } as never,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    ),
    calls,
  };
}

function asAgent<T>(fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: TENANT,
      userId: "01MEAAAAAAAAAAAAAAAAAAAAAA",
      capabilities: new Set(["properties.view", "properties.edit"]),
      billingOnly: false,
    } as never,
    fn,
  );
}

describe("‏רשימת מה שטרם נבדק", () => {
  it("‏שואלת על חותמת ריקה — ולא על ערך הדגל", async () => {
    const { service, calls } = serviceFor([]);
    await asAgent(() => service.sharedTabuReview(50));
    const where = (calls[0]?.args as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ tenantId: TENANT, deletedAt: null, sharedTabuConfirmedAt: null });
    /* ‏„מסומן כלא-משותף” אינו קריטריון: השאלה היא מי נשאל */
    expect(where["sharedTabu"]).toBeUndefined();
  });

  /*
   * ‏המונה הוא כמה **נשאר**, לא כמה הוחזרו: מסך שאומר „50” על
   * ‏אלף שורות מבטיח עבודה של דקה ומספק שעה.
   */
  it("‏מחזירה את המונה המלא לצד העמוד", async () => {
    const { service } = serviceFor([]);
    const res = await asAgent(() => service.sharedTabuReview(50));
    expect(res.remaining).toBe(7);
    expect(res.items).toEqual([]);
  });

  /*
   * ‎**הערך המוצג הוא מה שהמנוע קורא** — הדגל **או** הסוג הישן.
   * ‏שורה שסוגה הוא הייצוג הישן מוצגת כ„משותף”, אחרת המסך היה
   * ‏שואל שאלה שסותרת את מה שכבר קורה בהתאמות.
   */
  it("‏מציגה את הסוג הישן כמשותף, גם כשהדגל כבוי", async () => {
    const { service } = serviceFor([
      {
        id: PROP,
        city: "בני ברק",
        street: null,
        houseNumber: null,
        propertyType: "shared_tabu",
        priceAgorot: null,
        sharedTabu: false,
        updatedAt: new Date(),
      },
    ]);
    const res = await asAgent(() => service.sharedTabuReview(50));
    expect(res.items[0]?.sharedTabu).toBe(true);
  });
});

describe("‏התשובה", () => {
  it("‏כותבת את הדגל **ואת** החותמת באותה פעולה", async () => {
    const { service, calls } = serviceFor([]);
    await asAgent(() => service.confirmSharedTabu(PROP, true));
    const update = calls.find((c) => c.model === "property" && c.method === "update");
    const data = update?.args["data"] as Record<string, unknown>;
    expect(data["sharedTabu"]).toBe(true);
    expect(data["sharedTabuConfirmedAt"]).toBeInstanceOf(Date);
  });

  /*
   * ‏„לא משותף” על שורה שסוגה הוא הייצוג הישן פורש גם את הסוג —
   * ‏אחרת `isSharedTabuProperty` היה מחזיר `true` בקריאה הבאה,
   * ‏והתשובה הייתה מתהפכת מעצמה. הכלל חי ב-`fieldsToColumns`,
   * ‏והתשובה עוברת דרכו ולא כותבת ניסוח שני.
   */
  it("‏עוברת דרך אותו מיפוי של טופס העריכה", async () => {
    const { service, calls } = serviceFor([], { propertyType: "shared_tabu" });
    await asAgent(() => service.confirmSharedTabu(PROP, false));
    const update = calls.find((c) => c.model === "property" && c.method === "update");
    const data = update?.args["data"] as Record<string, unknown>;
    expect(data).toMatchObject(fieldsToColumns({ sharedTabu: false }, { propertyType: "shared_tabu" }));
    expect(data["propertyType"]).toBeNull();
  });

  it("‏נכס שאינו קיים אינו נכתב", async () => {
    const { service } = serviceFor([], null);
    await expect(asAgent(() => service.confirmSharedTabu(PROP, true))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("‏מה **אינו** מסמן „נבדק”", () => {
  /*
   * ‎**זו הטענה המרכזית.** טופס העריכה שולח את מצבו המלא כולל
   * ‏התיבה, ולכן אילו השמירה הרגילה הייתה חותמת — הרשימה הייתה
   * ‏מתרוקנת מעצמה עם הזמן בלי שאיש הסתכל על השאלה, והמסך היה
   * ‏מבטיח בדיקה שלא קרתה.
   */
  it("‏המיפוי של טופס העריכה אינו נוגע בחותמת", () => {
    const columns = fieldsToColumns({ sharedTabu: true }, { propertyType: null });
    expect("sharedTabuConfirmedAt" in columns).toBe(false);
  });
});
