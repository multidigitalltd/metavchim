import { beforeAll, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import { IntakeService } from "./intake.service";
import type { AuditService } from "../../core/audit.service";
import type { BuyersService } from "../buyers/buyers.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { EmailService } from "../../core/email.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";
import type { PropertiesService } from "../properties/properties.service";
import type { TenantLogoService } from "../../core/tenant-logo.service";

/**
 * ‎**שליחת הקישור באימייל — הערוץ שיוצא אל לקוח אמיתי.**
 *
 * ## ‏למה זה נבדק
 *
 * ‏שתי טעויות אפשריות כאן שקטות בשני הכיוונים. אם „אין אימייל”
 * ייפול דרך הסדק, המסך יגיד „נשלח” על הודעה שלא יצאה — וזו בדיוק
 * התקלה שכל השינוי הזה נולד ממנה. ואם השליחה תצא בלי `required`,
 * כישלון אצל הספק יירשם ביומן ויחזור למסך כהצלחה.
 *
 * ‏שתי הטענות נבדקות כאן, ובלי מסד: `sendInvite` היא החלטה על מה
 * שנקרא, והפלט שלה הוא הקריאה ל-`EmailService.send`.
 */

const TENANT = "01SENDINTAKETENANTAAAAAAAA";
const AGENT = "01SENDINTAKEAGENTAAAAAAAAA";
const LEAD = "01SENDINTAKELEADAAAAAAAAAA";

const noProperties = undefined as unknown as PropertiesService;
const noLogo = undefined as unknown as TenantLogoService;
const noBuyers = undefined as unknown as BuyersService;

/**
 * ‏המסד המזויף — רק מה ש-`ensure` ו-`sendInvite` באמת נוגעות בו.
 *
 * ‏`intakeRequest.findFirst` מחזירה שורה קיימת בתוקף, כדי שהבדיקה
 * תתרכז בשליחה ולא תבדוק שוב את היצירה (שנבדקת במקום אחר).
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

function serviceFor(
  contact: { id: string; name: string; phone: string; email?: string } | null,
  email: EmailService,
): IntakeService {
  const prisma = {
    withTenant: async <T>(fn: (tx: TenantTx) => Promise<T>) => fn(fakeTx()),
  } as unknown as PrismaService;
  return new IntakeService(
    prisma,
    { record: vi.fn() } as unknown as AuditService,
    { getById: async () => contact } as unknown as ContactsService,
    noBuyers,
    noProperties,
    noLogo,
    email,
  );
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

  it("אין אימייל בכרטיס — נזרק, ושום דבר לא נשלח", async () => {
    /*
     * ‏זו הטענה המרכזית: „נשלח” על מייל שלא יצא הוא בדיוק מה שגורם
     * למתווך לא לבדוק שוב, והלקוח נשאר בלי טופס.
     */
    const send = vi.fn();
    const service = serviceFor(
      { id: "c1", name: "דנה כהן", phone: "+972500000000" },
      { send } as unknown as EmailService,
    );

    await expect(run(() => service.sendInvite("lead", LEAD, "email"))).rejects.toThrow(
      BadRequestException,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("יש אימייל — נשלח אליו, עם הקישור ככפתור ובדרישת אישור מהספק", async () => {
    const send = vi.fn(async () => undefined);
    const service = serviceFor(
      { id: "c1", name: "דנה כהן", phone: "+972500000000", email: "dana@example.com" },
      { send } as unknown as EmailService,
    );

    const result = await run(() => service.sendInvite("lead", LEAD, "email"));

    expect(result.to).toBe("dana@example.com");
    expect(result.channel).toBe("email");
    expect(send).toHaveBeenCalledTimes(1);

    const [to, , content, options] = send.mock.calls[0] as unknown as [
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
});
