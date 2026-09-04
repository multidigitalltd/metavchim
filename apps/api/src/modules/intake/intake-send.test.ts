import { beforeAll, describe, expect, it, vi } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { IntakeService } from "./intake.service";
import type { AuditService } from "../../core/audit.service";
import type { BuyersService } from "../buyers/buyers.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { EmailService } from "../../core/email.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";
import type { PropertiesService } from "../properties/properties.service";
import type { TenantLogoService } from "../../core/tenant-logo.service";
import type { WhatsAppSendService } from "../messaging/whatsapp-send.service";

/**
 * ‎**שליחת הקישור ללקוח — שני ערוצים שיוצאים אל אדם אמיתי.**
 *
 * ## ‏מה נבדק, ולמה דווקא זה
 *
 * ‏כל טעות כאן שקטה. „✓ נשלח” על מייל שלא יצא הוא בדיוק מה שגורם
 * למתווך לא לבדוק שוב, והלקוח נשאר בלי טופס — התקלה שכל השינוי הזה
 * נולד ממנה. ולכן:
 *
 * 1. ‏חסם בערוץ אחד **אינו** מדווח כהצלחה.
 * 2. ‏חסם בערוץ אחד אינו מבטל את הערוץ השני.
 * 3. ‏כשוואטסאפ מהמשרד לא עבד, `waUrl` חוזר — הדרך הישנה עדיין
 *    עובדת, וכישלון בלי דרך חוצה היה מוריד תכונה קיימת.
 * 4. ‏שליחה שלא התבקשה אינה מתבצעת.
 *
 * ‏בלי מסד ובלי רשת: הכול נגזר ממה שהשירותים המוזרקים החזירו.
 */

const TENANT = "01SENDINTAKETENANTAAAAAAAA";
const AGENT = "01SENDINTAKEAGENTAAAAAAAAA";
const LEAD = "01SENDINTAKELEADAAAAAAAAAA";
const PHONE = "+972500000000";

const noProperties = undefined as unknown as PropertiesService;
const noLogo = undefined as unknown as TenantLogoService;
const noBuyers = undefined as unknown as BuyersService;

/**
 * ‏המסד המזויף — רק מה ש-`ensure` ו-`sendInvite` נוגעות בו.
 *
 * ‏`intakeRequest.findFirst` מחזירה שורה קיימת בתוקף, כדי שהבדיקה
 * תתרכז בשליחה; היצירה עצמה נבדקת במקום אחר. `create` זורקת, ולכן
 * „נוצרה בקשה שנייה” ייפול ולא יעבור בשקט.
 */
function fakeTx(): TenantTx {
  return {
    lead: { findFirst: async () => ({ contactId: "c1" }) },
    intakeRequest: {
      findFirst: async () => ({
        id: "r1",
        token: "T".repeat(43),
        subject: "lead",
        subjectId: LEAD,
        contactId: "c1",
        status: "sent",
        channel: "manual",
        expiresAt: new Date(Date.now() + 86_400_000),
        openedAt: null,
        submittedAt: null,
        createdAt: new Date(),
      }),
      create: async () => {
        throw new Error("לא אמורה להיווצר בקשה שנייה — כבר יש אחת בתוקף");
      },
    },
    tenant: { findUnique: async () => ({ name: "נדל״ן ירוק" }) },
    $queryRaw: async () => [],
  } as unknown as TenantTx;
}

interface Harness {
  service: IntakeService;
  send: ReturnType<typeof vi.fn>;
  wa: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
}

function harness(options: {
  email?: string | undefined;
  emailThrows?: Error;
  waResult?: "sent" | "no_connection" | "rejected";
  hasPlan?: boolean;
}): Harness {
  const send = vi.fn(async () => {
    if (options.emailThrows !== undefined) throw options.emailThrows;
  });
  const wa = vi.fn(async () => options.waResult ?? "sent");
  const audit = vi.fn();
  const prisma = {
    withTenant: async <T>(fn: (tx: TenantTx) => Promise<T>) => fn(fakeTx()),
  } as unknown as PrismaService;
  const contact = {
    id: "c1",
    name: "דנה כהן",
    phone: PHONE,
    ...(options.email === undefined ? {} : { email: options.email }),
  };
  const service = new IntakeService(
    prisma,
    { record: audit } as unknown as AuditService,
    { getById: async () => contact } as unknown as ContactsService,
    noBuyers,
    noProperties,
    noLogo,
    { send } as unknown as EmailService,
    {
      sendAsTenant: wa,
      hasTenantConnection: async () => true,
    } as unknown as WhatsAppSendService,
    {
      tenantHasFeature: async () => options.hasPlan ?? true,
    } as unknown as PlanCatalogService,
  );
  return { service, send, wa, audit };
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContext.run(
    {
      tenantId: TENANT,
      userId: AGENT,
      capabilities: new Set(["leads.edit", "leads.view_all"]),
    } as unknown as Parameters<typeof TenantContext.run>[0],
    fn,
  );
}

describe("sendInvite", () => {
  /*
   * ‏`loadEnv()` נקרא בדרך אל בניית הקישור הציבורי ודורש תצורה
   * שלמה. הערכים מזויפים ובכוונה — הבדיקה אינה נוגעת ברשת ואינה
   * נוגעת במסד.
   */
  beforeAll(() => {
    process.env["WEB_ORIGIN"] ??= "https://test.invalid";
    process.env["DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["DIRECT_DATABASE_URL"] ??= "postgresql://t:t@localhost:5432/t";
    process.env["REDIS_URL"] ??= "redis://localhost:6379";
    process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";
  });

  /* ---------- אימייל ---------- */

  it("אין אימייל בכרטיס — מדווח כחסם, ושום מייל אינו נשלח", async () => {
    const h = harness({ email: undefined });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["email"]));

    expect(result.email).toEqual({
      ok: false,
      reason: "אין מייל ללקוח — אפשר להוסיף אותו בכרטיס ולשלוח שוב",
    });
    expect(h.send).not.toHaveBeenCalled();
    /* ‏לא יצא כלום — ולכן גם אין מה לרשום ביומן */
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("יש אימייל — נשלח אליו, עם הקישור ככפתור ובדרישת אישור מהספק", async () => {
    const h = harness({ email: "dana@example.com" });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["email"]));

    expect(result.email).toEqual({ ok: true, to: "dana@example.com" });
    expect(h.send).toHaveBeenCalledTimes(1);

    const [to, , content, options] = h.send.mock.calls[0] as unknown as [
      string,
      string,
      { button?: { url: string }; greeting?: string },
      { required?: boolean; tenantId?: string },
    ];
    expect(to).toBe("dana@example.com");
    /* ‏הקישור שנשלח הוא הקישור שהוחזר — לא קישור שני שנוצר בדרך */
    expect(content.button?.url).toBe(result.url);
    expect(content.greeting).toBe("שלום דנה כהן,");
    /*
     * ‎`required: true` — ‏בלעדיו כישלון אצל הספק נרשם ביומן בלבד,
     * והמסך היה מדווח „נשלח”.
     */
    expect(options.required).toBe(true);
    expect(options.tenantId).toBe(TENANT);
  });

  it("הספק דחה — מדווח ככישלון ולא כהצלחה", async () => {
    const h = harness({
      email: "dana@example.com",
      emailThrows: new Error("שליחת האימייל נכשלה — נסו שוב"),
    });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["email"]));

    expect(result.email?.ok).toBe(false);
    expect(h.audit).not.toHaveBeenCalled();
  });

  /* ---------- וואטסאפ ---------- */

  it("המשרד מחובר — ההודעה יוצאת ממנו, ולא נפתח חלון", async () => {
    const h = harness({ waResult: "sent" });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["whatsapp"]));

    expect(result.whatsapp).toEqual({ ok: true, to: PHONE });
    const [tenantId, phone, body] = h.wa.mock.calls[0] as unknown as [string, string, string];
    expect(tenantId).toBe(TENANT);
    expect(phone).toBe(PHONE);
    /* ‏אותו נוסח שהקישור נושא — לא הודעה שנייה שנכתבה בנפרד */
    expect(body).toContain(result.url);
  });

  it("חלון 24 השעות סגור — לא „נשלח”, ועם דרך חוצה", async () => {
    /*
     * ‏זו הטענה שמונעת נסיגה: הדרך הישנה (פתיחת וואטסאפ עם הנוסח
     * מוכן) עובדת תמיד, וכישלון בלי `waUrl` היה מוריד אותה.
     */
    const h = harness({ waResult: "rejected" });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["whatsapp"]));

    expect(result.whatsapp?.ok).toBe(false);
    expect(result.whatsapp).toHaveProperty("waUrl");
    const failed = result.whatsapp as { waUrl?: string | null };
    expect(failed.waUrl).toContain("wa.me");
  });

  it("המסלול אינו כולל וואטסאפ — לא נשלח בכלל, וגם זה עם דרך חוצה", async () => {
    /*
     * ‏משרד שירד ממסלול והשאיר חיבור פעיל היה ממשיך לשלוח דרך הנתיב
     * הזה בזמן ששאר נתיבי הוואטסאפ חסומים בפניו.
     */
    const h = harness({ hasPlan: false });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["whatsapp"]));

    expect(result.whatsapp?.ok).toBe(false);
    expect(h.wa).not.toHaveBeenCalled();
    expect((result.whatsapp as { waUrl?: string | null }).waUrl).toContain("wa.me");
  });

  /* ---------- שני הערוצים יחד ---------- */

  it("כישלון בערוץ אחד אינו מבטל את השני", async () => {
    /*
     * ‏חריגה אחת לשני הערוצים הייתה מוחקת וואטסאפ שכבר יצא ללקוח,
     * ומציגה למתווך „נכשל” על משהו שכן קרה.
     */
    const h = harness({
      email: "dana@example.com",
      emailThrows: new Error("הספק דחה"),
      waResult: "sent",
    });
    const result = await run(() =>
      h.service.sendInvite("lead", LEAD, ["email", "whatsapp"]),
    );

    expect(result.email?.ok).toBe(false);
    expect(result.whatsapp?.ok).toBe(true);
    /* ‏היומן רושם רק את מה שיצא */
    expect(h.audit).toHaveBeenCalledTimes(1);
    const entry = h.audit.mock.calls[0]?.[1] as { metadata?: { channels?: string[] } };
    expect(entry.metadata?.channels).toEqual(["whatsapp"]);
  });

  it("ערוץ שלא התבקש הוא null — ואינו נשלח", async () => {
    const h = harness({ email: "dana@example.com" });
    const result = await run(() => h.service.sendInvite("lead", LEAD, ["email"]));

    expect(result.whatsapp).toBeNull();
    expect(h.wa).not.toHaveBeenCalled();
  });
});
