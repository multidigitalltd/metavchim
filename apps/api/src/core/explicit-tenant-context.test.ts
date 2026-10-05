import { describe, expect, it } from "vitest";
import { TenantContext, type RequestContext } from "../common/tenant-context";
import { PrismaService, type TenantTx } from "./prisma.service";

/**
 * ‎**„אני יודע את הדייר, אין בקשה” — ולכן גם ההקשר נקבע כאן.**
 *
 * ‏`withExplicitTenant` קבעה את הדייר ל-RLS בלבד, ושכבת הנתונים
 * ‏שואלת גם את `TenantContext`. וובהוק הדואר הנכנס נפל בדיוק על זה
 * ‏— כל תשובת לקוח החזירה 500 ואבדה — ותוקן שם לבדו. לקוראים
 * ‏האחרים (סבבי רקע, וובהוקים אחרים) המוקש נשאר, ולכן הוא נסגר
 * ‏במקום שבו הדייר כבר ידוע.
 *
 * ‏הבדיקה אינה נוגעת במסד: היא מחליפה את `$transaction` בכפילה,
 * ‏כי מה שנבדק הוא מה **שכבת הנתונים רואה**, לא מה שהיא שולפת.
 */

const TENANT = "01TENANT0000000000000000AA";
const OTHER = "01OTHER00000000000000000BB";

function serviceWithoutDatabase(): PrismaService {
  const prisma = Object.create(PrismaService.prototype) as PrismaService;
  const fake = {
    $transaction: async <T>(run: (tx: TenantTx) => Promise<T>): Promise<T> =>
      run({ $executeRaw: async () => 1 } as unknown as TenantTx),
  };
  Object.assign(prisma, fake);
  return prisma;
}

function asPerson(tenantId: string): RequestContext {
  return { tenantId, userId: "01USER000000000000000000CC", capabilities: new Set(), billingOnly: false };
}

describe("‏הקשר הדייר ב-withExplicitTenant", () => {
  it("‏נקבע כשאין אחד — כמו בוובהוק ובסבב רקע", async () => {
    let seen: RequestContext | undefined;
    expect(TenantContext.maybeCurrent(), "הבדיקה חייבת לרוץ בלי הקשר").toBeUndefined();

    await serviceWithoutDatabase().withExplicitTenant(TENANT, async () => {
      seen = TenantContext.current();
    });

    expect(seen?.tenantId).toBe(TENANT);
    /* ‏אין אדם מאחורי הפעולה, וזה מה שנרשם */
    expect(seen?.userId).toBe("");
  });

  /*
   * ‏קורא שכבר יש לו הקשר מבצע פעולה של אדם מסוים: „מי עשה”,
   * ‏היכולות והרישום ביומן חייבים להישאר שלו.
   */
  it("‏ואינו דורס הקשר קיים", async () => {
    let seen: RequestContext | undefined;

    await TenantContext.run(asPerson(OTHER), () =>
      serviceWithoutDatabase().withExplicitTenant(TENANT, async () => {
        seen = TenantContext.current();
      }),
    );

    expect(seen?.tenantId).toBe(OTHER);
    expect(seen?.userId).toBe("01USER000000000000000000CC");
  });

  it("‏ואינו נשאר אחרי שהעבודה הסתיימה", async () => {
    await serviceWithoutDatabase().withExplicitTenant(TENANT, async () => undefined);
    expect(TenantContext.maybeCurrent()).toBeUndefined();
  });

  it("‏וגם כשהעבודה נכשלת — ההקשר אינו דולף", async () => {
    await expect(
      serviceWithoutDatabase().withExplicitTenant(TENANT, async () => {
        throw new Error("נפל באמצע");
      }),
    ).rejects.toThrow("נפל באמצע");
    expect(TenantContext.maybeCurrent()).toBeUndefined();
  });
});
