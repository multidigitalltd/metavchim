import { describe, expect, it } from "vitest";
import type { EmailDomainProviderService } from "../../core/email-domain-provider.service";
import type { PrismaService } from "../../core/prisma.service";
import { AccountDeletionService } from "./account-deletion.service";

/**
 * ‎**משרד שנמחק אינו משאיר ביומן אנשים.**
 *
 * ‏שורת היומן נשמרת בכוונה גם אחרי מחיקת המשרד: ערכה הוא „האם
 * ‏הגיעה בקשה בכלל”, והוא נשמר גם בלי לדעת של מי. הנימוק הזה
 * ‏החזיק כל עוד השורה נשאה זמן, תוצאה ושמות שדות בלבד.
 *
 * ‏מרגע שהיא נושאת חתימת מספר וארבע ספרות אחרונות, ניתוק
 * ‎`tenantId` לבדו הפסיק להספיק: השורה אינה מזוהה עוד עם משרד,
 * ‏אבל היא עדיין מזוהה עם **אדם** — ובעל הפלטפורמה יכול להקליד
 * ‏את המספר ולמצוא את אירועי השיחות של לקוח של משרד שנמחק
 * ‏(ביקורת Codex).
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";

interface Call {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

/**
 * ‏עותק מדומה של המסד, ברירת מחדל אחת לכל מודל.
 *
 * ‏המחיקה נוגעת בעשרות טבלאות; מה שנבדק כאן הוא שאילתה אחת. שאר
 * ‏העולם עונה „אין”, וכל הקריאות נרשמות.
 */
function fakePrisma(calls: Call[]): PrismaService {
  const overrides: Record<string, unknown> = {
    "tenant.findUnique": { id: TENANT, name: "משרד לבדיקה" },
  };
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: Record<string, unknown>) => {
          calls.push({ model: name, method, args: args ?? {} });
          const key = `${name}.${method}`;
          if (key in overrides) return Promise.resolve(overrides[key]);
          if (method === "findMany") return Promise.resolve([]);
          if (method === "findFirst" || method === "findUnique") return Promise.resolve(null);
          if (method === "count") return Promise.resolve(0);
          return Promise.resolve({ count: 0 });
        },
      },
    );
  const models: Record<string, unknown> = {};
  return new Proxy(
    {},
    {
      get: (_t, name: string) => {
        /*
         * ‏שתי צורות הטרנזקציה: מערך של הבטחות (המחיקה הסופית)
         * ‏ופונקציה שמקבלת tx (האיסוף שלפניה). שתיהן חייבות
         * ‏להתקיים, אחרת המחיקה נעצרת לפני השורה שנבדקת.
         */
        if (name === "$transaction") {
          return (arg: unknown) =>
            typeof arg === "function"
              ? (arg as (tx: unknown) => Promise<unknown>)(models["__tx"] ?? (models["__tx"] = txProxy(calls)))
              : Promise.all(arg as Promise<unknown>[]);
        }
        /* ‏שאילתה בהקשר דייר מפורש — אותו עולם מדומה, tx אחד */
        if (name === "withExplicitTenant" || name === "withTenant") {
          return (...args: unknown[]) => {
            const run = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
            return run(models["__tx"] ?? (models["__tx"] = txProxy(calls)));
          };
        }
        /* ‏כל שאילתה גולמית — תבנית מתויגת או לא — עונה „אין” */
        if (name.startsWith("$")) return () => Promise.resolve([]);
        models[name] ??= model(name);
        return models[name];
      },
    },
  ) as unknown as PrismaService;
}

function txProxy(calls: Call[]): unknown {
  return fakePrisma(calls);
}

describe("‏מחיקת משרד וניקוי יומן הוובהוקים", () => {
  it("‏מנתקת את השיוך **ומוחקת את זיהוי המתקשר** באותה פעולה", async () => {
    const calls: Call[] = [];
    const provider = {
      deleteDomain: () => Promise.resolve(),
    } as unknown as EmailDomainProviderService;
    const service = new AccountDeletionService(fakePrisma(calls), provider);

    await service.deleteTenantFromPlatform(TENANT, "משרד לבדיקה");

    const call = calls.find(
      (c) => c.model === "telephonyWebhookHit" && c.method === "updateMany",
    );
    expect(call, "היומן לא נגע כלל במחיקת המשרד").toBeDefined();
    expect(call?.args["data"]).toEqual({
      tenantId: null,
      peerHash: null,
      peerSuffix: null,
    });
  });
});
