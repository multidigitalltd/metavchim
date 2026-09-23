import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  MEDIA_ORDER_MAX_AMOUNT_AGOROT,
  MEDIA_ORDER_STATUS_LABEL,
  mediaOrderTotals,
  type MediaOrderCreate,
  type MediaOrderStatus,
  type MediaOutletKind,
  type MediaProductKind,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { CardcomService, type Payer } from "../../core/cardcom.service";
import { PlatformAdminNotifierService } from "../../core/platform-admin-notifier.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { VatService } from "../../core/vat.service";
import { MediaMailService } from "./media-mail.service";

/**
 * רכש מדיה — הצד של המשרד.
 *
 * ## שני מסלולי הזמנה, נקודת סיום אחת
 *
 * - **הפניה** (`lead`): ההזמנה נרשמת כ-`referred` ונשלחת מיד לנציג
 *   המדיה. אין תשלום, אין דף סליקה.
 * - **בתשלום** (`paid`): ההזמנה נרשמת כ-`pending_payment`, נפתח דף
 *   תשלום אצל קארדקום, והמייל לנציג יוצא **רק אחרי שהתשלום אושר** —
 *   מ-`BillingService.apply`, דרך `settleWithin` ואז `notifyAfterPayment`.
 *   נציג שמקבל הזמנה שלא שולמה מתחיל לעבוד על מודעה שאולי לא תפורסם.
 *
 * ## מה מצולם על ההזמנה, ולמה
 *
 * שם המדיה, שם המוצר, המחיר, הכמות והעמלה נכתבים על ההזמנה ברגע
 * היצירה. המוצר יכול להשתנות או להיסגר מחר, וההזמנה חייבת להמשיך
 * לספר מה סוכם בה — גם במסך של המשרד, גם במייל לנציג, וגם בדוח
 * העמלות של הפלטפורמה.
 *
 * ## הטבלה מחוץ ל-RLS
 *
 * ‎`media_orders` מחוץ ל-RLS כמו `payments` ומאותה סיבה (ראו בסכימה),
 * ולכן **כל** שאילתה כאן מסננת לפי `tenantId` במפורש. המזהה היחיד
 * שמגיע בלי דייר הוא זה ש-`apply` מעביר — והוא נגזר משורת תשלום
 * אחרי אימות מול קארדקום, לא מהמשתמש.
 */

export interface MediaOutletCard {
  id: string;
  slug: string;
  name: string;
  kind: MediaOutletKind;
  tagline: string;
  reachText: string;
  frequency: string;
  productCount: number;
  /** המחיר הנמוך ביותר בין המוצרים בתשלום, נטו — ריק כשאין כאלה. */
  priceFromAgorot: number | null;
  /** יש מוצר הפניה — "פנייה לנציג" כאפשרות. */
  hasLeadProducts: boolean;
  /** מועד סגירת הגיליון הקרוב, ISO — ריק כשאין. */
  nextClosingAt: string | null;
  /** מזהה תמונת השער, לכרטיס — ריק כשאין. */
  coverImageId: string | null;
}

export interface MediaProductRow {
  id: string;
  name: string;
  description: string;
  specs: string;
  kind: MediaProductKind;
  priceAgorot: number | null;
}

export interface MediaOutletDetail {
  id: string;
  slug: string;
  name: string;
  kind: MediaOutletKind;
  tagline: string;
  description: string;
  audience: string;
  reachText: string;
  frequency: string;
  highlights: string[];
  /** יש למי לשלוח את ההזמנה. בלי זה ההזמנה מגיעה למנהלי הפלטפורמה בלבד. */
  hasContact: boolean;
  closingText: string;
  nextClosingAt: string | null;
  /** לוגו/שער ודוגמאות מודעה — מוגשות ב-`/media/:slug/images/:id`. */
  images: { id: string; kind: "cover" | "sample"; caption: string }[];
  products: MediaProductRow[];
  /** הסליקה מוגדרת במערכת — בלעדיה מוצרים בתשלום מוצגים בלי כפתור. */
  checkoutAvailable: boolean;
  /** שיעור המע"מ שיתווסף למחיר הנטו המוצג. */
  vatPercent: number;
}

export interface MediaOrderRow {
  id: string;
  /** אפשר להמשיך לתשלום או לבטל — ממתינה או נכשלה, בתשלום. */
  canResume: boolean;
  outletName: string;
  outletSlug: string | null;
  productName: string;
  kind: MediaProductKind;
  status: MediaOrderStatus;
  statusLabel: string;
  quantity: number;
  amountAgorot: number;
  contactName: string;
  brief: string;
  createdAt: Date;
  paidAt: Date | null;
}

/** ‏מה נדרש כדי לפתוח דף תשלום — המזמין וזהות המשרד. */
interface OrderContext {
  tenantId: string;
  userId: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardcom: CardcomService,
    private readonly vat: VatService,
    private readonly mail: MediaMailService,
    private readonly admins: PlatformAdminNotifierService,
    private readonly audit: AuditService,
  ) {}

  /** הארכיון — מדיות פעילות בלבד, עם מה שצריך לכרטיס. */
  async catalog(): Promise<MediaOutletCard[]> {
    const outlets = await this.prisma.mediaOutlet.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: {
          where: { active: true },
          select: { kind: true, priceAgorot: true },
        },
        images: { where: { kind: "cover" }, orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
      },
    });
    return outlets.map((outlet) => {
      const paid = outlet.products
        .filter((p) => p.kind === "paid" && p.priceAgorot !== null)
        .map((p) => p.priceAgorot as number);
      return {
        id: outlet.id,
        slug: outlet.slug,
        name: outlet.name,
        kind: outlet.kind as MediaOutletKind,
        tagline: outlet.tagline,
        reachText: outlet.reachText,
        frequency: outlet.frequency,
        productCount: outlet.products.length,
        priceFromAgorot: paid.length === 0 ? null : Math.min(...paid),
        hasLeadProducts: outlet.products.some((p) => p.kind === "lead"),
        nextClosingAt: outlet.nextClosingAt?.toISOString() ?? null,
        coverImageId: outlet.images[0]?.id ?? null,
      };
    });
  }

  /** העמוד הפנימי — מה כלול, מה החשיפה, ומה אפשר להזמין. */
  async outlet(slug: string): Promise<MediaOutletDetail> {
    const outlet = await this.prisma.mediaOutlet.findFirst({
      where: { slug, active: true },
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
        images: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (outlet === null) throw new NotFoundException("המדיה לא נמצאה");
    const [checkoutAvailable, vatPercent] = await Promise.all([
      this.cardcom.isConfigured(),
      this.vat.percent(),
    ]);
    return {
      id: outlet.id,
      slug: outlet.slug,
      name: outlet.name,
      kind: outlet.kind as MediaOutletKind,
      tagline: outlet.tagline,
      description: outlet.description,
      audience: outlet.audience,
      reachText: outlet.reachText,
      frequency: outlet.frequency,
      highlights: outlet.highlights,
      hasContact: outlet.contactEmail !== "",
      closingText: outlet.closingText,
      nextClosingAt: outlet.nextClosingAt?.toISOString() ?? null,
      images: outlet.images.map((img) => ({
        id: img.id,
        kind: img.kind === "cover" ? "cover" : "sample",
        caption: img.caption,
      })),
      products: outlet.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        specs: p.specs,
        kind: p.kind as MediaProductKind,
        priceAgorot: p.priceAgorot,
      })),
      checkoutAvailable,
      vatPercent,
    };
  }

  /** ההזמנות של המשרד — החדשות ראשונות. */
  async orders(tenantId: string): Promise<MediaOrderRow[]> {
    const rows = await this.prisma.mediaOrder.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const slugs = await this.prisma.mediaOutlet.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.outletId))] } },
      select: { id: true, slug: true },
    });
    const slugById = new Map(slugs.map((s) => [s.id, s.slug]));
    return rows.map((row) => ({
      id: row.id,
      canResume: row.kind === "paid" && (row.status === "pending_payment" || row.status === "failed"),
      outletName: row.outletName,
      outletSlug: slugById.get(row.outletId) ?? null,
      productName: row.productName,
      kind: row.kind as MediaProductKind,
      status: row.status as MediaOrderStatus,
      statusLabel: MEDIA_ORDER_STATUS_LABEL[row.status as MediaOrderStatus] ?? row.status,
      quantity: row.quantity,
      amountAgorot: row.amountAgorot,
      contactName: row.contactName,
      brief: row.brief,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
    }));
  }

  /**
   * הפניה — מוצר בלי סליקה. ההזמנה נרשמת ונשלחת לנציג מיד.
   *
   * המייל יוצא **אחרי** שההזמנה נשמרה: שרת דואר שנופל אינו סיבה
   * לאבד את הפנייה, ומה שלא נשלח נראה במסך הפלטפורמה כהזמנה בלי
   * `notifiedAt`.
   */
  async createReferral(
    ctx: OrderContext,
    input: MediaOrderCreate,
  ): Promise<{ orderId: string; status: MediaOrderStatus }> {
    const product = await this.activeProduct(input.productId);
    if (product.kind !== "lead") {
      throw new BadRequestException("המוצר הזה נרכש בתשלום — יש לעבור בדף התשלום");
    }
    const office = await this.office(ctx.tenantId);
    const orderId = ulid();
    await this.prisma.withTenant(async (tx) => {
      await tx.mediaOrder.create({
        data: {
          id: orderId,
          tenantId: ctx.tenantId,
          outletId: product.outletId,
          productId: product.id,
          kind: "lead",
          status: "referred",
          outletName: product.outlet.name,
          productName: product.name,
          quantity: input.quantity,
          // מה הנציג חייב על ההפניה — מצולם, כי התמורה על המוצר נערכת
          leadFeeAgorot: product.leadFeeAgorot,
          brief: input.brief,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          officeName: office.name,
          customerNo: office.customerNo,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "media.order_referred",
        entityType: "media_order",
        entityId: orderId,
        metadata: { outlet: product.outlet.slug, product: product.name, quantity: input.quantity },
      });
    });
    await this.notify(orderId);
    return { orderId, status: "referred" };
  }

  /**
   * הזמנה בתשלום — פתיחת דף תשלום.
   *
   * ‎**המחיר מגיע מהמוצר ולעולם לא מהדפדפן**, והוא נצרב על ההזמנה
   * ועל שורת התשלום. המחירון נקוב נטו; מה שנשלח לסולק הוא מה
   * שבאמת יירד מהכרטיס, ולכן המע"מ נוסף כאן — פעם אחת.
   */
  async startCheckout(
    ctx: OrderContext,
    input: MediaOrderCreate,
  ): Promise<{ orderId: string; paymentId: string; url: string }> {
    const product = await this.activeProduct(input.productId);
    if (product.kind !== "paid" || product.priceAgorot === null || product.priceAgorot < 1) {
      throw new BadRequestException("המוצר הזה אינו נמכר בתשלום במערכת — פנו לנציג");
    }
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }
    const totals = mediaOrderTotals({
      unitPriceAgorot: product.priceAgorot,
      quantity: input.quantity,
      commissionPercent: product.outlet.commissionPercent,
    });
    /*
     * לפני שנכתב דבר: הסכום, ועליו המע"מ, חייבים להיכנס ל-INTEGER
     * של שורת התשלום. הזמנה שנכתבה ושורת תשלום שנפלה אחריה היא
     * הזמנה שממתינה לתשלום לנצח (ביקורת Codex).
     */
    if (totals.amountAgorot > MEDIA_ORDER_MAX_AMOUNT_AGOROT) {
      throw new BadRequestException("הזמנה גדולה מדי לתשלום במערכת — פנו לנציג המדיה");
    }
    const office = await this.office(ctx.tenantId);

    const orderId = ulid();
    await this.prisma.withTenant(async (tx) => {
      /*
       * דף תשלום שננטש על אותו מוצר אינו נשאר "ממתין" לנצח: הזמנות
       * ממתינות קודמות של המשרד על אותו מוצר מבוטלות, ודפי התשלום
       * שלהן מסומנים `superseded` — לא `failed`, כי הדף הישן עדיין
       * ניתן לחיוב אצל הסולק, ואם ישולם, `apply` רשאי לתפוס אותו.
       */
      const stale = await tx.mediaOrder.findMany({
        where: { tenantId: ctx.tenantId, productId: product.id, status: "pending_payment" },
        select: { id: true },
      });
      if (stale.length > 0) {
        const staleIds = stale.map((s) => s.id);
        await tx.mediaOrder.updateMany({
          where: { tenantId: ctx.tenantId, id: { in: staleIds } },
          data: { status: "cancelled" },
        });
        await tx.payment.updateMany({
          where: { tenantId: ctx.tenantId, mediaOrderId: { in: staleIds }, status: "pending" },
          data: { status: "superseded", failureReason: "נפתח דף תשלום חדש במקומו" },
        });
      }
      await tx.mediaOrder.create({
        data: {
          id: orderId,
          tenantId: ctx.tenantId,
          outletId: product.outletId,
          productId: product.id,
          kind: "paid",
          status: "pending_payment",
          outletName: product.outlet.name,
          productName: product.name,
          quantity: totals.quantity,
          unitPriceAgorot: totals.unitPriceAgorot,
          amountAgorot: totals.amountAgorot,
          commissionPercent: totals.commissionPercent,
          commissionAgorot: totals.commissionAgorot,
          brief: input.brief,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          officeName: office.name,
          customerNo: office.customerNo,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "media.order_started",
        entityType: "media_order",
        entityId: orderId,
        metadata: {
          outlet: product.outlet.slug,
          product: product.name,
          quantity: totals.quantity,
          amountAgorot: totals.amountAgorot,
        },
      });
    });

    const paymentId = await this.openPaymentPage(ctx, {
      id: orderId,
      outletName: product.outlet.name,
      productName: product.name,
      quantity: totals.quantity,
      amountAgorot: totals.amountAgorot,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
    });
    // ‏„ההזמנה נפתחה” — אחרי שדף התשלום קיים, כדי שהמייל יוביל למקום אמיתי
    await this.mailStep(orderId, "started");
    return { orderId, paymentId: paymentId.paymentId, url: paymentId.url };
  }

  /**
   * המשך לתשלום — דף תשלום חדש להזמנה שממתינה (או שנכשלה).
   *
   * זה מה שהתזכורת „הגיליון נסגר מחר” מובילה אליו: המשרד שהתחיל
   * ולא סיים אינו צריך להזמין מחדש. ההזמנה, המחיר והעמלה נשארים
   * כפי שנצרבו; רק דף התשלום חדש, והקודם מסומן `superseded`.
   * הזמנה שנכשלה חוזרת ל„ממתינה” — כישלון בכרטיס אינו ביטול.
   */
  async resumeCheckout(
    ctx: OrderContext,
    orderId: string,
  ): Promise<{ orderId: string; paymentId: string; url: string }> {
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }
    const order = await this.prisma.mediaOrder.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
    });
    if (order === null) throw new NotFoundException("ההזמנה לא נמצאה");
    if (order.kind !== "paid" || !["pending_payment", "failed"].includes(order.status)) {
      throw new BadRequestException("ההזמנה הזו אינה ממתינה לתשלום");
    }
    await this.prisma.withTenant(async (tx) => {
      await tx.payment.updateMany({
        where: { tenantId: ctx.tenantId, mediaOrderId: order.id, status: "pending" },
        data: { status: "superseded", failureReason: "נפתח דף תשלום חדש במקומו" },
      });
      await tx.mediaOrder.updateMany({
        where: { tenantId: ctx.tenantId, id: order.id },
        data: { status: "pending_payment" },
      });
      await this.audit.record(tx, {
        action: "media.order_resumed",
        entityType: "media_order",
        entityId: order.id,
      });
    });
    const page = await this.openPaymentPage(ctx, order);
    return { orderId: order.id, paymentId: page.paymentId, url: page.url };
  }

  /**
   * ביטול הזמנה שממתינה לתשלום — **לא** מוחקת: דף התשלום שנשאר פתוח
   * מסומן `superseded`, ואם ישולם בכל זאת, `apply` יתפוס אותו וההזמנה
   * תיסגר כשולמה (ראו `settleWithin`). הפניה ששולחה אינה ניתנת לביטול
   * מכאן — היא כבר אצל הנציג.
   */
  async cancel(ctx: OrderContext, orderId: string): Promise<void> {
    const order = await this.prisma.mediaOrder.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      select: { id: true, status: true },
    });
    if (order === null) throw new NotFoundException("ההזמנה לא נמצאה");
    if (order.status !== "pending_payment" && order.status !== "failed") {
      throw new BadRequestException("אפשר לבטל רק הזמנה שממתינה לתשלום");
    }
    await this.prisma.withTenant(async (tx) => {
      await tx.mediaOrder.updateMany({
        where: { tenantId: ctx.tenantId, id: order.id },
        data: { status: "cancelled" },
      });
      await tx.payment.updateMany({
        where: { tenantId: ctx.tenantId, mediaOrderId: order.id, status: "pending" },
        data: { status: "superseded", failureReason: "ההזמנה בוטלה" },
      });
      await this.audit.record(tx, {
        action: "media.order_cancelled",
        entityType: "media_order",
        entityId: order.id,
      });
    });
    await this.mailStep(order.id, "cancelled");
  }

  /**
   * שליחה חוזרת לנציג — ממסך הפלטפורמה, להזמנה ששולמה או הפניה
   * שנשלחה. המקרה הרגיל: איש הקשר הוגדר אחרי שההזמנה כבר הגיעה.
   * מפתחות האידמפוטנטיות מונעים כפילות: מייל שכבר יצא לא יוצא שוב,
   * ומייל שנכשל או שלא היה למי לשלוח — כן.
   */
  async resendNotification(orderId: string): Promise<{ notified: boolean }> {
    const order = await this.prisma.mediaOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, tenantId: true },
    });
    if (order === null) throw new NotFoundException("ההזמנה לא נמצאה");
    if (order.status !== "paid" && order.status !== "referred") {
      throw new BadRequestException("שולחים לנציג רק הזמנה ששולמה או הפניה");
    }
    await this.notify(order.id);
    const fresh = await this.prisma.mediaOrder.findFirst({
      where: { id: order.id, tenantId: order.tenantId },
      select: { notifiedAt: true },
    });
    return { notified: fresh?.notifiedAt !== null && fresh?.notifiedAt !== undefined };
  }

  /**
   * שורת תשלום ודף תשלום להזמנה — המשותף להזמנה חדשה ולהמשך תשלום.
   *
   * השורה נכתבת לפני הפנייה לסולק: כסף בלי שורה גרוע משורה בלי כסף.
   * המחירון נטו; מה שנשלח לסולק הוא מה שבאמת יירד מהכרטיס, ולכן
   * המע"מ נוסף כאן — פעם אחת.
   */
  private async openPaymentPage(
    ctx: OrderContext,
    order: {
      id: string;
      outletName: string;
      productName: string;
      quantity: number;
      amountAgorot: number;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
    },
  ): Promise<{ paymentId: string; url: string }> {
    const { amountAgorot, vatPercent } = await this.vat.charge(order.amountAgorot);
    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: ctx.tenantId,
        purpose: "media_order",
        mediaOrderId: order.id,
        amountAgorot,
        vatPercent,
        status: "pending",
        lowProfileId: paymentId,
        createdBy: ctx.userId,
      },
    });

    const origin = loadEnv().WEB_ORIGIN;
    const productName =
      order.quantity > 1
        ? `${order.outletName} — ${order.productName} ×${order.quantity}`
        : `${order.outletName} — ${order.productName}`;
    try {
      const page = await this.cardcom.createPaymentPage({
        reference: paymentId,
        amountAgorot,
        productName: productName.slice(0, 120),
        successUrl: `${origin}/media/orders/return?payment=${paymentId}`,
        failureUrl: `${origin}/media/orders/return?payment=${paymentId}&failed=1`,
        webhookUrl: `${origin}/api/v1/webhooks/cardcom`,
        // רכישה חד-פעמית — אין חידוש, ולכן אין טוקן לשמור
        createToken: false,
        payer: await this.payer(ctx, order),
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { lowProfileId: page.lowProfileId },
      });
      return { paymentId, url: page.url };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: "failed", failureReason: "פתיחת דף התשלום נכשלה" },
      });
      await this.prisma.mediaOrder.updateMany({
        where: { tenantId: ctx.tenantId, id: order.id },
        data: { status: "failed" },
      });
      throw error;
    }
  }

  /**
   * סימון ההזמנה כשולמה — **בתוך הטרנזקציה שתפסה את התשלום**, ולכן
   * אידמפוטנטית מאותה סיבה כמו זיכוי הקרדיטים: רק מי שהעביר
   * `pending ⟵ paid` מסמן. `null` = אין הזמנה חיה לתשלום הזה,
   * והקורא מדווח על כסף בלי הזמנה.
   *
   * הזמנה שבוטלה **כן** נסגרת כשולמה: הלקוח שילם בדף שנשאר פתוח,
   * והמודעה שלו עדיף שתתפרסם משהכסף יישאר תלוי.
   */
  async settleWithin(tx: TenantTx, orderId: string, now: Date): Promise<{ tenantId: string } | null> {
    const order = await tx.mediaOrder.findUnique({ where: { id: orderId } });
    if (order === null || order.kind !== "paid" || order.status === "paid") return null;
    await tx.mediaOrder.update({
      where: { id: orderId },
      data: { status: "paid", paidAt: now },
    });
    return { tenantId: order.tenantId };
  }

  /**
   * המייל לנציג — **אחרי** הטרנזקציה: קריאת רשת אינה יושבת בתוך
   * טרנזקציית מסד, וכישלון בה אינו מפיל את הוובהוק.
   */
  async notifyAfterPayment(orderId: string): Promise<void> {
    await this.notify(orderId);
  }

  /**
   * התשלום נדחה אצל הסולק — ההזמנה נכשלת איתו.
   *
   * בלי זה ההזמנה נשארת „ממתינה לתשלום” לנצח, במסך המשרד ובמסך
   * הפלטפורמה, בעוד דף החזרה כבר אמר „לא הושלם” (ביקורת Codex).
   * רק הזמנה שממתינה נכשלת: הודעת כישלון מאוחרת אינה מבטלת
   * הזמנה ששולמה.
   *
   * **ורק כשאין דף תשלום חי.** אחרי „המשך לתשלום” הדף הישן מסומן
   * `superseded` ועדיין ניתן לדחייה אצל הסולק; דחייה שלו שהייתה
   * מכשילה את ההזמנה הייתה אומרת ללקוח שהניסיון **הנוכחי** נכשל,
   * בעוד הדף החדש פתוח וממתין (ביקורת Codex). דף ממתין = ההזמנה
   * ממשיכה; הכישלון נשאר על שורת התשלום הישנה בלבד.
   */
  async markFailed(orderId: string): Promise<void> {
    const order = await this.prisma.mediaOrder.findUnique({
      where: { id: orderId },
      select: { tenantId: true, status: true },
    });
    if (order === null || order.status !== "pending_payment") return;
    const live = await this.prisma.payment.count({
      where: { tenantId: order.tenantId, mediaOrderId: orderId, status: "pending" },
    });
    if (live > 0) return;
    const failed = await this.prisma.mediaOrder.updateMany({
      where: { tenantId: order.tenantId, id: orderId, status: "pending_payment" },
      data: { status: "failed" },
    });
    // רק על מעבר אמיתי — הודעת כישלון חוזרת מהסולק אינה מייל נוסף
    if (failed.count > 0) await this.mailStep(orderId, "failed");
  }

  /** אותו דבר, לפי דף התשלום — הענף שבו שורת התשלום עוד לא נקראה. */
  async markFailedForPaymentPage(lowProfileId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { lowProfileId },
      select: { purpose: true, mediaOrderId: true },
    });
    if (payment?.purpose === "media_order" && payment.mediaOrderId !== null) {
      await this.markFailed(payment.mediaOrderId);
    }
  }

  /**
   * תשלום שנתפס בלי הזמנה חיה — כסף בלי שירות, לעין אנושית.
   *
   * הזמנה שכבר שולמה אינה בהכרח „כפילות רגילה”: שתי הודעות של
   * קארדקום על **אותו** תשלום נעצרות אצל `apply` בשקט, אבל אחרי
   * „המשך לתשלום” יש להזמנה שני דפים חיים, ואפשר לשלם בשניהם. אז
   * התשלום השני נתפס כ„שולם”, ההזמנה כבר שולמה — והלקוח חויב פעמיים
   * על מודעה אחת. שקט כאן היה משאיר אותו כך (ביקורת Codex). לכן:
   * ההזמנה שולמה על ידי **תשלום אחר** ⟵ חיוב כפול, לזיכוי.
   */
  async reportOrphanPayment(paymentId: string, orderId: string | null): Promise<void> {
    const order =
      orderId === null ? null : await this.prisma.mediaOrder.findUnique({ where: { id: orderId } });
    if (order !== null && order.status === "paid") {
      const paid = await this.prisma.payment.findMany({
        where: { tenantId: order.tenantId, mediaOrderId: order.id, status: "paid" },
        select: { id: true },
      });
      // אותו תשלום שנתפס פעמיים — שקט
      if (!paid.some((p) => p.id !== paymentId)) return;
      this.logger.error(`חיוב כפול על הזמנת מדיה ${order.id}: תשלום ${paymentId} נוסף על הזמנה ששולמה`);
      await this.admins.notify({
        subject: `[רכש מדיה] חיוב כפול — ${order.outletName} — ${order.officeName} — לזיכוי`,
        heading: "הלקוח חויב פעמיים על הזמנה אחת",
        badge: { label: "חיוב כפול — לזיכוי", tone: "danger" },
        paragraphs: [
          `ההזמנה ${order.productName} ב${order.outletName} של ${order.officeName} כבר שולמה, ותשלום נוסף (${paymentId}) נתפס עליה — כנראה דף תשלום ישן שנשאר פתוח אחרי „המשך לתשלום”.`,
          "המודעה אחת, הכסף פעמיים. יש לזכות את התשלום הנוסף אצל קארדקום ולעדכן את הלקוח.",
        ],
        details: [
          { label: "משרד", value: order.officeName },
          { label: "תשלום לזיכוי", value: paymentId },
          { label: "איש קשר", value: `${order.contactName}, ${order.contactPhone}` },
        ],
        button: { label: "להזמנות המדיה", url: `${loadEnv().WEB_ORIGIN}/platform?tab=media` },
      });
      return;
    }
    this.logger.error(`תשלום ${paymentId} על הזמנת מדיה ${orderId ?? "ללא מזהה"} נתפס בלי הזמנה חיה`);
    await this.admins.notify({
      subject: "תשלום על הזמנת מדיה בלי הזמנה חיה",
      heading: "תשלום שנתפס בלי הזמנה",
      paragraphs: [
        `תשלום ${paymentId} אושר אצל קארדקום, אבל הזמנת המדיה ${orderId ?? "(ללא מזהה)"} לא נמצאה או שאינה הזמנה בתשלום.`,
        "הכסף נגבה. יש לבדוק ולזכות או לשלוח את ההזמנה ידנית.",
      ],
      button: { label: "לשולחן הפלטפורמה", url: `${loadEnv().WEB_ORIGIN}/platform?tab=media` },
    });
  }

  /**
   * שליחת ההזמנה — לנציג המדיה, למנהלי הפלטפורמה, ואישור למזמין.
   *
   * ההרכבה והשליחה ב-`MediaMailService`; כאן רק מה שקובע את
   * `notifiedAt`: הוא נכתב **רק כשהמייל לנציג יצא בפועל**. מדיה בלי
   * כתובת נשארת בלי `notifiedAt` גם כשמנהלי הפלטפורמה קיבלו — מבחינת
   * המדיה, ההזמנה לא נמסרה, והמסך אומר זאת.
   */
  private async notify(orderId: string): Promise<void> {
    const loaded = await this.loadForMail(orderId);
    if (loaded === null) return;
    const { order, outlet } = loaded;
    const { outletDelivered } =
      order.kind === "paid"
        ? await this.mail.orderPaid(order, outlet)
        : await this.mail.referralSent(order, outlet);
    if (outletDelivered && order.notifiedAt === null) {
      await this.prisma.mediaOrder.updateMany({
        where: { tenantId: order.tenantId, id: order.id },
        data: { notifiedAt: new Date() },
      });
    }
  }

  /** שלב שאינו מסירה לנציג — ללקוח ולמנהלים בלבד. */
  private async mailStep(
    orderId: string,
    step: "started" | "failed" | "cancelled",
  ): Promise<void> {
    const loaded = await this.loadForMail(orderId);
    if (loaded === null) return;
    const { order, outlet } = loaded;
    if (step === "started") await this.mail.orderStarted(order, outlet);
    else if (step === "failed") await this.mail.orderFailed(order, outlet);
    else await this.mail.orderCancelled(order, outlet);
  }

  /** ההזמנה והמדיה שלה, למיילים — המדיה יכולה להיות חסרה (נמחקה). */
  private async loadForMail(orderId: string) {
    const order = await this.prisma.mediaOrder.findUnique({ where: { id: orderId } });
    if (order === null) return null;
    const outlet = await this.prisma.mediaOutlet.findUnique({
      where: { id: order.outletId },
      select: {
        name: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        closingText: true,
        nextClosingAt: true,
      },
    });
    return { order, outlet };
  }

  private async activeProduct(productId: string) {
    const product = await this.prisma.mediaProduct.findFirst({
      where: { id: productId, active: true, outlet: { active: true } },
      include: { outlet: { select: { name: true, slug: true, commissionPercent: true } } },
    });
    if (product === null) throw new NotFoundException("המוצר אינו זמין להזמנה");
    return product;
  }

  private async office(tenantId: string): Promise<{ name: string; customerNo: number }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, customerNo: true },
    });
    if (tenant === null) throw new NotFoundException("המשרד לא נמצא");
    return tenant;
  }

  /** מי משלם — פרטי המזמין שעל ההזמנה, על שם המשרד. */
  private async payer(
    ctx: OrderContext,
    input: { contactName: string; contactEmail: string; contactPhone: string },
  ): Promise<Payer> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { name: true },
    });
    return {
      name: tenant?.name ?? input.contactName,
      email: input.contactEmail,
      phone: input.contactPhone,
    };
  }
}

/** ‏למי שקורא את ההקשר בבקר — הדייר והמשתמש, בלי לשאת את כל ההקשר. */
export function orderContext(): OrderContext {
  const { tenantId, userId } = TenantContext.current();
  return { tenantId, userId };
}
