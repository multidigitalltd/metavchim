import { describe, expect, it } from "vitest";
import type { AuditService } from "../../core/audit.service";
import type { CryptoService } from "../../core/crypto.service";
import type { PrismaService } from "../../core/prisma.service";
import type { TenantTx } from "../../core/prisma.service";
import { ContactErasureService } from "./contact-erasure.service";

/**
 * ‎**מחיקת לקוח מוחקת גם את עקבות המספר ביומן הוובהוקים.**
 *
 * ‏היומן התחיל לשאת חתימת מספר וארבע ספרות אחרונות כדי שאפשר
 * ‏יהיה לחפש בו „מה קרה כשהמספר הזה התקשר”. באותו רגע הוא הפך
 * ‏למקום שבו מחיקה „מלאה” יכולה להיות לא מלאה: בעל הפלטפורמה
 * ‏מקליד את המספר שנמחק ורואה את אירועי השיחות שלו עוד תשעים
 * ‏יום (ביקורת Codex).
 *
 * ‏שלוש טענות, וכל אחת מהן יכולה להישבר בנפרד:
 *
 * ‎1. החתימה **והסיומת** יורדות. אחת מהן לבדה משאירה חצי זיהוי.
 * ‎2. **כל מספריו**, ולא הראשי בלבד — `contact_phones` נושא את
 *    אותו HMAC, וקליטה נכנסת מוצאת את האדם דרך כל אחד מהם.
 * ‎3. **מסונן למשרד הזה בלבד.** הטבלה אינה תחת RLS, ולכן שאילתה
 *    בלי הסינון הייתה נוגעת גם בשורות של משרד אחר שאותו מספר
 *    התקשר אליו — נתון שאינו של המשרד הזה למחוק.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const CONTACT = "01CONTACTAAAAAAAAAAAAAAAAA";
const PRIMARY = "a".repeat(64);
const SECOND = "b".repeat(64);

interface Call {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

/**
 * ‏עותק מדומה של כל המסד, ברירת מחדל אחת לכל מודל.
 *
 * ‏המחיקה נוגעת בעשרות טבלאות, וכתיבת כפיל לכל אחת הייתה קוברת
 * ‏את הטענה שנבדקת כאן. מה שנשאל הוא **שאילתה אחת** — ולכן כל
 * ‏השאר עונה „אין”, וכל הקריאות נרשמות.
 */
function fakeTx(calls: Call[]): TenantTx {
  const overrides: Record<string, unknown> = {
    /* ‏הכרטיס עצמו קיים, ונושא את המספר הראשי */
    "contact.findFirst": { id: CONTACT, nameHash: null, nameEncrypted: "" },
    "contact.findMany": [{ phoneHash: PRIMARY }],
    /* ‏ומספר נוסף על אותו אדם */
    "contactPhone.findMany": [{ phoneHash: SECOND }],
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
        if (name === "$queryRawUnsafe" || name === "$executeRawUnsafe") {
          return () => Promise.resolve([]);
        }
        models[name] ??= model(name);
        return models[name];
      },
    },
  ) as unknown as TenantTx;
}

function service(): { erase: ContactErasureService; calls: Call[] } {
  const calls: Call[] = [];
  const prisma = {} as unknown as PrismaService;
  const audit = { record: () => Promise.resolve() } as unknown as AuditService;
  const crypto = {} as unknown as CryptoService;
  return { erase: new ContactErasureService(prisma, audit, crypto), calls };
}

/** ‏השאילתה שמנקה את היומן — היחידה שמעניינת כאן. */
async function logCleanup(): Promise<Call | undefined> {
  const { erase, calls } = service();
  const tx = fakeTx(calls);
  await erase.eraseUnreachable(tx, TENANT, { contactId: CONTACT }, "בדיקה");
  return calls.find(
    (call) => call.model === "webhookHit" && call.method === "updateMany",
  );
}

describe("‏מחיקת לקוח מנקה את יומן הוובהוקים", () => {
  it("‏מנקה את החתימה ואת ארבע הספרות — שתיהן", async () => {
    const call = await logCleanup();
    expect(call?.args["data"]).toEqual({ peerHash: null, peerSuffix: null });
  });

  it("‏לפי כל מספריו של האדם, ולא הראשי בלבד", async () => {
    const call = await logCleanup();
    const where = call?.args["where"] as { peerHash: { in: string[] } };
    expect(where.peerHash.in).toEqual([PRIMARY, SECOND]);
  });

  it("‏ובמשרד הזה בלבד — שורות של משרד אחר אינן שלו למחוק", async () => {
    const call = await logCleanup();
    const where = call?.args["where"] as { tenantId?: string };
    expect(where.tenantId).toBe(TENANT);
  });
});
