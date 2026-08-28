import { describe, expect, it } from "vitest";
import { grossFromNet } from "@metavchim/shared";
import type { CardcomService } from "../../core/cardcom.service";
import type { CryptoService } from "../../core/crypto.service";
import type { EmailService } from "../../core/email.service";
import type { PrismaService } from "../../core/prisma.service";
import type { VatService } from "../../core/vat.service";
import type { NumberRentalService } from "./number-rental.service";
import { InvoiceService } from "./invoice.service";
import { NumberRentalRenewalService } from "./number-rental-renewal.service";

/**
 * העיקרון הנבדק: התפיסה האופטימית של התקופה לפני הפנייה לסולק חייבת
 * להיסגר לאחד משלושה סופים — תשלום, החזרה מסודרת אחרי דחייה, או
 * החזרה מסודרת אחרי **קריסה באמצע**. הסוף השלישי הוא ביקורת Codex:
 * בלעדיו חריגה בין התפיסה לחיוב משאירה תקופה "משולמת" שאיש לא שילם,
 * והסבב הבא מדלג עליה.
 */

const TENANT = "01TENANT000000000000000000";
const NOW = new Date("2026-08-26T10:00:00.000Z");
const PERIOD_END = new Date("2026-08-26T09:00:00.000Z");

type ChargeMode = "paid" | "declined" | "throws";

function build(mode: ChargeMode): {
  svc: NumberRentalRenewalService;
  rentalBatchUpdates: Record<string, unknown>[];
  rentalUpdates: Record<string, unknown>[];
  paymentUpdates: Record<string, unknown>[];
  adminNotices: string[];
} {
  const rentalBatchUpdates: Record<string, unknown>[] = [];
  const rentalUpdates: Record<string, unknown>[] = [];
  const paymentUpdates: Record<string, unknown>[] = [];
  const adminNotices: string[] = [];
  const rental = {
    id: "01R",
    tenantId: TENANT,
    number: "0722776123",
    status: "active",
    monthlyAgorot: 5_000,
    billingAnchorDay: 26,
    currentPeriodEnd: PERIOD_END,
  };
  const prisma = {
    rentedNumber: {
      findMany: async () => [rental],
      findUnique: async () => rental,
      updateMany: async (args: { data: Record<string, unknown> }) => {
        rentalBatchUpdates.push(args.data);
        return { count: 1 };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        rentalUpdates.push(args.data);
        return args.data;
      },
    },
    subscription: {
      findUnique: async () => ({
        cardTokenEncrypted: "enc",
        cardMonth: 12,
        cardYear: 30,
        cardOwnerIdEncrypted: null,
      }),
    },
    payment: {
      create: async (args: { data: unknown }) => args.data,
      update: async (args: { data: Record<string, unknown> }) => {
        paymentUpdates.push(args.data);
        return args.data;
      },
      updateMany: async (args: { data: Record<string, unknown> }) => {
        paymentUpdates.push(args.data);
        return { count: 1 };
      },
    },
    tenant: { findUnique: async () => ({ name: "משרד הבדיקה" }) },
    user: { findFirst: async () => null },
  } as unknown as PrismaService;
  const cardcom = {
    isConfigured: async () => true,
    chargeToken: async () => {
      if (mode === "throws") throw new Error("ECONNRESET");
      if (mode === "declined") return { paid: false, message: "כרטיס נדחה" };
      return { paid: true, transactionId: "T1", documentType: null, documentNumber: null };
    },
  } as unknown as CardcomService;
  const crypto = { decrypt: (value: string) => value } as unknown as CryptoService;
  const email = { send: async () => undefined } as unknown as EmailService;
  /*
   * בדל החשבוניות — ורישום מה נדרש ממנו.
   *
   * החיווט הוא החלק השביר כאן: חידוש שגובה כסף ואינו רושם חשבונית
   * הוא בדיוק כסף בלי מסמך, וזו הבדיקה היחידה שתתפוס הסרה בטעות
   * של השורה הזו.
   */
  const invoicedFor: string[] = [];
  const invoices = {
    queueForPayment: async (paymentId: string) => {
      invoicedFor.push(paymentId);
    },
  } as unknown as InvoiceService;
  const rentals = {
    notifyAdmins: async (subject: string) => {
      adminNotices.push(subject);
    },
    releaseNow: async () => ({ ok: true, message: "" }),
  } as unknown as NumberRentalService;
  /* מחיר המחירון נטו; החיוב הוא הוא ועוד מע"מ — כמו בהשכרה הראשונה. */
  const vat = {
    percent: async () => 18,
    gross: async (net: number) => grossFromNet(net, 18),
    // הסכום **והשיעור שלפיו נבנה** — השיעור נצרב על שורת התשלום
    charge: async (net: number) => ({ amountAgorot: grossFromNet(net, 18), vatPercent: 18 }),
  } as unknown as VatService;
  return {
    svc: new NumberRentalRenewalService(prisma, invoices, cardcom, crypto, email, rentals, vat),
    rentalBatchUpdates,
    rentalUpdates,
    paymentUpdates,
    adminNotices,
    invoicedFor,
  };
}

describe("חידוש חודשי — התפיסה האופטימית נסגרת תמיד", () => {
  it("חיוב מוצלח מותיר את התקופה החדשה ומסמן את התשלום כשולם", async () => {
    const { svc, rentalBatchUpdates, paymentUpdates } = build("paid");
    const result = await svc.renewDue(NOW);
    expect(result).toEqual({ renewed: 1, failed: 0 });
    // תפיסה אחת, בלי החזרה — התקופה שולמה
    expect(rentalBatchUpdates.length).toBe(1);
    expect(paymentUpdates).toContainEqual(expect.objectContaining({ status: "paid" }));
  });

  it("חיוב שנדחה מחזיר את התקופה ומסמן פיגור — בלי לשחרר את המספר", async () => {
    const { svc, rentalBatchUpdates, rentalUpdates, adminNotices } = build("declined");
    const result = await svc.renewDue(NOW);
    expect(result).toEqual({ renewed: 0, failed: 1 });
    // התפיסה, ואז ההחזרה לתקופה המקורית
    expect(rentalBatchUpdates.length).toBe(2);
    expect(rentalBatchUpdates[1]).toMatchObject({ currentPeriodEnd: PERIOD_END });
    expect(rentalUpdates).toContainEqual(expect.objectContaining({ status: "past_due" }));
    expect(adminNotices.length).toBe(1);
  });

  it("קריסה באמצע החיוב אינה משאירה חודש חינם — התקופה מוחזרת והטיפול אנושי", async () => {
    const { svc, rentalBatchUpdates, rentalUpdates, paymentUpdates, adminNotices } =
      build("throws");
    const result = await svc.renewDue(NOW);
    expect(result).toEqual({ renewed: 0, failed: 1 });
    expect(rentalBatchUpdates.length).toBe(2);
    expect(rentalBatchUpdates[1]).toMatchObject({ currentPeriodEnd: PERIOD_END });
    /*
     * past_due ולא ניסיון חוזר: ייתכן שהחיוב דווקא נקלט אצל קארדקום
     * לפני שהרשת נפלה, וניסיון אוטומטי נוסף היה מחייב פעמיים. המייל
     * למנהלים אומר לבדוק אצל הסולק לפני גבייה חוזרת.
     */
    expect(rentalUpdates).toContainEqual(expect.objectContaining({ status: "past_due" }));
    expect(paymentUpdates).toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(adminNotices.length).toBe(1);
  });
});
