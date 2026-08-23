import { describe, expect, it, vi } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { IntakeService } from "./intake.service";
import type { AuditService } from "../../core/audit.service";
import type { BuyersService } from "../buyers/buyers.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { PrismaService, TenantTx } from "../../core/prisma.service";

/**
 * הצד הציבורי של טופס הלקוח רץ **בלי עוגייה**, ולכן בלי הקשר דייר.
 *
 * ## למה הבדיקה הזו קיימת
 *
 * `SessionMiddleware` נכנס ל-`TenantContext.run` רק כשיש Session תקף.
 * מבקר שמגיע עם קישור בלבד אינו כזה, ולכן ה-AsyncLocalStorage **ריק**
 * לכל אורך הבקשה. `withExplicitTenant` מזריק `app.tenant_id`
 * לטרנזקציה — וזה אוכף את הבידוד — אבל הוא אינו מגדיר את ההקשר.
 *
 * חצי מהשירותים שהמסלול הזה נשען עליהם קוראים דווקא את ההקשר:
 * `ContactsService.getById` (לשם הפרטי בברכה), `AuditService.record`
 * (ליומן), ו-`BuyersService.update` (לעדכון הכרטיס). כולם קוראים
 * `TenantContext.current()`, שזורק כשאין הקשר — כלומר בלי הכריכה
 * הזו **כל** פתיחה וכל שליחה של הטופס נופלות ב-500, על אף שהטוקן
 * תקין והרשומה קיימת.
 *
 * לכן הנבדק כאן אינו „העדכון נכתב” אלא הדבר שאי אפשר לראות בקוד
 * בקריאה: שבתוך העבודה שאחרי הטוקן יש הקשר, ושהוא של הדייר של
 * הטוקן ולא של אף אחד אחר.
 */

const TENANT = "01JWAINTAKETENANTAAAAAAAAA";
const TOKEN = "a".repeat(43);

/** ה-tx שהשירות מקבל — כל שאילתה מוחזרת ריקה, חוץ ממה שנדרש. */
function fakeTx(): TenantTx {
  const none = { findFirst: async () => null, findUnique: async () => null };
  return {
    intakeRequest: {
      ...none,
      findFirst: async () => ({
        id: "01JWAINTAKEREQUESTAAAAAAAA",
        tenantId: TENANT,
        subject: "buyer",
        subjectId: "01JWABUYERAAAAAAAAAAAAAAAA",
        contactId: "01JWACONTACTAAAAAAAAAAAAAA",
        status: "sent",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
      findUnique: async () => ({
        status: "opened",
        submittedAt: null,
        answers: {},
      }),
      updateMany: async () => ({ count: 1 }),
    },
    buyer: none,
    tenant: { findUnique: async () => ({ name: "נדל״ן ירוק" }) },
    notification: { create: async () => ({}) },
  } as unknown as TenantTx;
}

describe("הצד הציבורי של טופס הדרישות — הקשר דייר", () => {
  it("פתיחת הטופס בלי הקשר אינה נופלת, ורצה תחת הדייר של הטוקן", async () => {
    const seen: string[] = [];
    const contacts = {
      getById: async () => {
        // בדיוק מה שהשירות האמיתי עושה — ומה שזרק קודם
        seen.push(TenantContext.current().tenantId);
        return { id: "c", name: "דנה כהן", phone: "+972500000000" };
      },
    } as unknown as ContactsService;

    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx()),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx()),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record: vi.fn() } as unknown as AuditService,
      contacts,
      { update: vi.fn() } as unknown as BuyersService,
    );

    // אין `TenantContext.run` כאן בכוונה — זה בדיוק מצב הבקשה הציבורית
    expect(TenantContext.maybeCurrent()).toBeUndefined();

    const view = await service.publicView(TOKEN);
    expect(view.officeName).toBe("נדל״ן ירוק");
    expect(view.greetingName).toBe("דנה"); // שם פרטי בלבד — בלי שם משפחה
    expect(seen).toEqual([TENANT]);

    // וההקשר לא דלף החוצה: הוא חי רק בתוך העבודה שאחרי הטוקן
    expect(TenantContext.maybeCurrent()).toBeUndefined();
  });

  it("שליחה רושמת ביומן — כלומר ההקשר קיים גם במסלול הכתיבה", async () => {
    const record = vi.fn(async () => {
      TenantContext.current();
    });
    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx()),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx()),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      { update: vi.fn() } as unknown as BuyersService,
    );

    await expect(service.submit(TOKEN, { dealType: "sale" })).resolves.toEqual({
      ok: true,
    });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("קישור שבוטל בין הקריאה לכתיבה — השליחה נדחית ואינה מחיה אותו", async () => {
    /*
     * `updateMany` מותנה מחזיר `count: 0` כשהשורה כבר `revoked`.
     * הכתיבה הבלתי-מותנית שהייתה כאן קודם הייתה מחזירה את הבקשה
     * למצב „נשלחה” ומחילה את התשובות על הכרטיס — אחרי שהמשרד כבר
     * אמר שהקישור אינו תקף.
     */
    const tx = fakeTx();
    (tx as unknown as { intakeRequest: { updateMany: unknown } }).intakeRequest.updateMany =
      async () => ({ count: 0 });
    const update = vi.fn();
    const prisma = {
      withPublicIntake: async <T>(
        _token: string,
        fn: (tx: TenantTx) => Promise<T>,
      ) => fn(fakeTx()),
      withExplicitTenant: async <T>(
        _tenantId: string,
        fn: (t: TenantTx) => Promise<T>,
      ) => fn(tx),
    } as unknown as PrismaService;

    const service = new IntakeService(
      prisma,
      { record: vi.fn() } as unknown as AuditService,
      {
        getById: async () => ({ id: "c", name: "דנה", phone: "+972500000000" }),
      } as unknown as ContactsService,
      { update } as unknown as BuyersService,
    );

    await expect(service.submit(TOKEN, { dealType: "sale" })).rejects.toThrow(
      "הקישור אינו פעיל עוד",
    );
    expect(update).not.toHaveBeenCalled();
  });
});
