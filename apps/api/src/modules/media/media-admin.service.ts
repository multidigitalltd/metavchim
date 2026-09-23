import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  MEDIA_ORDER_STATUS_LABEL,
  type MediaImageKind,
  type MediaOrderStatus,
  type MediaOutletKind,
  type MediaOutletPatch,
  type MediaOutletUpsert,
  type MediaProductKind,
  type MediaProductPatch,
  type MediaProductUpsert,
  type MediaSettlementCreate,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";

/**
 * רכש מדיה — הצד של בעל הפלטפורמה: הארכיון, המוצרים, וההזמנות של
 * כל המשרדים.
 *
 * **חוצה-דיירים בהגדרה**, כמו שאר מסך הפלטפורמה: הקטלוג הוא של
 * הפלטפורמה, וההזמנות נקראות כאן על פני כל המשרדים כדי לראות מה
 * נשלח, מה שולם, ומה העמלה. הגישה נעולה ב-`PlatformAdminGuard`
 * בבקר; השירות עצמו אינו נקרא משום נתיב של משרד.
 */

export interface AdminMediaProduct {
  id: string;
  name: string;
  description: string;
  specs: string;
  kind: MediaProductKind;
  priceAgorot: number | null;
  leadFeeAgorot: number | null;
  active: boolean;
  sortOrder: number;
}

export interface AdminMediaImage {
  id: string;
  kind: MediaImageKind;
  caption: string;
  sortOrder: number;
}

export interface AdminMediaOutlet {
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
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  commissionPercent: number;
  closingText: string;
  /** ISO ב-UTC; המסך מציג ועורך בשעת קיר ישראלית. */
  nextClosingAt: string | null;
  active: boolean;
  sortOrder: number;
  products: AdminMediaProduct[];
  images: AdminMediaImage[];
  /** חלקה של המדיה בהזמנות ששולמו וטרם הועברו — היתרה לתשלום. */
  owedAgorot: number;
  owedOrders: number;
}

export interface AdminMediaTotals {
  paidOrders: number;
  /** סך ההזמנות ששולמו, נטו. */
  paidAgorot: number;
  /** מתוכו — מה שנשאר בפלטפורמה. */
  commissionAgorot: number;
  /** חלקן של המדיות שטרם הועבר. */
  owedAgorot: number;
  referrals: number;
  /** סך התמורה על הפניות שנשלחו, כפי שנצרבה — לרישום. */
  referralFeesAgorot: number;
}

export interface AdminMediaSettlement {
  id: string;
  outletId: string;
  outletName: string;
  amountAgorot: number;
  orderCount: number;
  reference: string;
  note: string;
  createdAt: Date;
}

export interface AdminMediaOrder {
  id: string;
  tenantId: string;
  officeName: string;
  customerNo: number | null;
  outletName: string;
  productName: string;
  kind: MediaProductKind;
  status: MediaOrderStatus;
  statusLabel: string;
  quantity: number;
  amountAgorot: number;
  commissionPercent: number;
  commissionAgorot: number;
  /** בהפניה: מה הנציג חייב על ההפניה, כפי שנצרב בשליחה. */
  leadFeeAgorot: number | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  brief: string;
  notifiedAt: Date | null;
  paidAt: Date | null;
  /** ההעברה למדיה שההזמנה נכללה בה; ריק = טרם הועבר. */
  settlementId: string | null;
  createdAt: Date;
}

@Injectable()
export class MediaAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async outlets(): Promise<AdminMediaOutlet[]> {
    const rows = await this.prisma.mediaOutlet.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        products: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        images: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    /*
     * היתרה לתשלום — סכום פחות עמלה על כל הזמנה ששולמה וטרם הועברה.
     * מחושב בשאילתה אחת לכל המדיות, לא אחת לכל שורה.
     */
    const owed = await this.prisma.mediaOrder.groupBy({
      by: ["outletId"],
      where: { status: "paid", settlementId: null },
      _sum: { amountAgorot: true, commissionAgorot: true },
      _count: { _all: true },
    });
    const owedByOutlet = new Map(
      owed.map((o) => [
        o.outletId,
        {
          agorot: (o._sum.amountAgorot ?? 0) - (o._sum.commissionAgorot ?? 0),
          orders: o._count._all,
        },
      ]),
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind as MediaOutletKind,
      tagline: row.tagline,
      description: row.description,
      audience: row.audience,
      reachText: row.reachText,
      frequency: row.frequency,
      highlights: row.highlights,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      commissionPercent: row.commissionPercent,
      closingText: row.closingText,
      nextClosingAt: row.nextClosingAt?.toISOString() ?? null,
      active: row.active,
      sortOrder: row.sortOrder,
      images: row.images.map((img) => ({
        id: img.id,
        kind: img.kind as MediaImageKind,
        caption: img.caption,
        sortOrder: img.sortOrder,
      })),
      owedAgorot: owedByOutlet.get(row.id)?.agorot ?? 0,
      owedOrders: owedByOutlet.get(row.id)?.orders ?? 0,
      products: row.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        specs: p.specs,
        kind: p.kind as MediaProductKind,
        priceAgorot: p.priceAgorot,
        leadFeeAgorot: p.leadFeeAgorot,
        active: p.active,
        sortOrder: p.sortOrder,
      })),
    }));
  }

  async createOutlet(input: MediaOutletUpsert, updatedBy: string): Promise<{ id: string }> {
    await this.assertSlugFree(input.slug, null);
    const id = ulid();
    const { nextClosingAt, ...rest } = input;
    await this.prisma.mediaOutlet.create({
      data: { id, ...rest, nextClosingAt: closingDate(nextClosingAt), updatedBy },
    });
    return { id };
  }

  async updateOutlet(id: string, patch: MediaOutletPatch, updatedBy: string): Promise<void> {
    const existing = await this.prisma.mediaOutlet.findUnique({ where: { id }, select: { id: true } });
    if (existing === null) throw new NotFoundException("המדיה לא נמצאה");
    if (patch.slug !== undefined) await this.assertSlugFree(patch.slug, id);
    const { nextClosingAt, ...rest } = patch;
    await this.prisma.mediaOutlet.update({
      where: { id },
      data: {
        ...rest,
        ...(nextClosingAt === undefined ? {} : { nextClosingAt: closingDate(nextClosingAt) }),
        updatedBy,
      },
    });
  }

  /**
   * רישום העברה למדיה — כל ההזמנות ששולמו וטרם הועברו, יחד.
   *
   * הסכום מחושב מההזמנות **בתוך הטרנזקציה** שמסמנת אותן, ולא נשלח
   * מהמסך: רישום שסכומו אינו סך ההזמנות אינו רישום של דבר. שני
   * רישומים במקביל אינם כוללים את אותה הזמנה פעמיים — העדכון
   * המותנה `settlement_id IS NULL` תופס כל הזמנה פעם אחת, והסכום
   * נגזר ממה שנתפס בפועל.
   */
  async settle(
    outletId: string,
    input: MediaSettlementCreate,
    createdBy: string,
  ): Promise<{ id: string; amountAgorot: number; orderCount: number }> {
    const outlet = await this.prisma.mediaOutlet.findUnique({
      where: { id: outletId },
      select: { id: true },
    });
    if (outlet === null) throw new NotFoundException("המדיה לא נמצאה");
    const id = ulid();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.mediaOrder.updateMany({
        where: { outletId, status: "paid", settlementId: null },
        data: { settlementId: id },
      });
      if (claimed.count === 0) throw new BadRequestException("אין הזמנות ששולמו וממתינות להעברה");
      const sums = await tx.mediaOrder.aggregate({
        where: { settlementId: id },
        _sum: { amountAgorot: true, commissionAgorot: true },
      });
      const amountAgorot = (sums._sum.amountAgorot ?? 0) - (sums._sum.commissionAgorot ?? 0);
      await tx.mediaSettlement.create({
        data: {
          id,
          outletId,
          amountAgorot,
          orderCount: claimed.count,
          reference: input.reference,
          note: input.note,
          createdBy,
        },
      });
      return { id, amountAgorot, orderCount: claimed.count };
    });
  }

  async settlements(): Promise<AdminMediaSettlement[]> {
    const rows = await this.prisma.mediaSettlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { outlet: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      outletId: row.outletId,
      outletName: row.outlet.name,
      amountAgorot: row.amountAgorot,
      orderCount: row.orderCount,
      reference: row.reference,
      note: row.note,
      createdAt: row.createdAt,
    }));
  }

  async createProduct(outletId: string, input: MediaProductUpsert): Promise<{ id: string }> {
    const outlet = await this.prisma.mediaOutlet.findUnique({
      where: { id: outletId },
      select: { id: true },
    });
    if (outlet === null) throw new NotFoundException("המדיה לא נמצאה");
    const id = ulid();
    await this.prisma.mediaProduct.create({ data: { id, outletId, ...input } });
    return { id };
  }

  async updateProduct(id: string, patch: MediaProductPatch): Promise<void> {
    const existing = await this.prisma.mediaProduct.findUnique({ where: { id } });
    if (existing === null) throw new NotFoundException("המוצר לא נמצא");
    /*
     * מוצר בתשלום בלי מחיר אינו ניתן להזמנה — הסכימה בודקת זאת
     * ביצירה, וכאן נבדק המצב **אחרי** העדכון החלקי: שינוי סוג
     * ל-`paid` בלי מחיר, או מחיקת המחיר ממוצר בתשלום.
     */
    const kind = patch.kind ?? existing.kind;
    const price = patch.priceAgorot === undefined ? existing.priceAgorot : patch.priceAgorot;
    if (kind === "paid" && (price === null || price < 1)) {
      throw new BadRequestException("מוצר בתשלום חייב מחיר");
    }
    await this.prisma.mediaProduct.update({ where: { id }, data: patch });
  }

  /**
   * מחיקת מוצר — רק כשאין עליו הזמנות. מוצר שהוזמן פעם נסגר
   * (`active: false`) ולא נמחק: ההזמנה מצלמת את שמו, אבל הדוח
   * עדיין מצביע עליו.
   */
  async deleteProduct(id: string): Promise<void> {
    const orders = await this.prisma.mediaOrder.count({ where: { productId: id } });
    if (orders > 0) {
      throw new BadRequestException("למוצר יש הזמנות — אפשר להשבית אותו, לא למחוק");
    }
    await this.prisma.mediaProduct.deleteMany({ where: { id } });
  }

  /**
   * הסיכום שמעל הטבלה — כמה נכנס, כמה מזה עמלה, כמה עוד לא הועבר.
   * מחושב על **כל** ההזמנות ולא על העמוד שמוצג: הטבלה היא עמוד אחרון,
   * והסיכום הוא דוח.
   */
  async totals(): Promise<AdminMediaTotals> {
    const [paid, owed, referrals] = await Promise.all([
      this.prisma.mediaOrder.aggregate({
        where: { status: "paid" },
        _sum: { amountAgorot: true, commissionAgorot: true },
        _count: { _all: true },
      }),
      this.prisma.mediaOrder.aggregate({
        where: { status: "paid", settlementId: null },
        _sum: { amountAgorot: true, commissionAgorot: true },
      }),
      this.prisma.mediaOrder.aggregate({
        where: { status: "referred" },
        _sum: { leadFeeAgorot: true },
        _count: { _all: true },
      }),
    ]);
    return {
      paidOrders: paid._count._all,
      paidAgorot: paid._sum.amountAgorot ?? 0,
      commissionAgorot: paid._sum.commissionAgorot ?? 0,
      owedAgorot: (owed._sum.amountAgorot ?? 0) - (owed._sum.commissionAgorot ?? 0),
      referrals: referrals._count._all,
      referralFeesAgorot: referrals._sum.leadFeeAgorot ?? 0,
    };
  }

  /** ההזמנות של כל המשרדים — החדשות ראשונות, עמוד אחרון ולא הכול. */
  async orders(): Promise<AdminMediaOrder[]> {
    const rows = await this.prisma.mediaOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      officeName: row.officeName,
      customerNo: row.customerNo,
      outletName: row.outletName,
      productName: row.productName,
      kind: row.kind as MediaProductKind,
      status: row.status as MediaOrderStatus,
      statusLabel: MEDIA_ORDER_STATUS_LABEL[row.status as MediaOrderStatus] ?? row.status,
      quantity: row.quantity,
      amountAgorot: row.amountAgorot,
      commissionPercent: row.commissionPercent,
      commissionAgorot: row.commissionAgorot,
      leadFeeAgorot: row.leadFeeAgorot,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail,
      brief: row.brief,
      notifiedAt: row.notifiedAt,
      paidAt: row.paidAt,
      settlementId: row.settlementId,
      createdAt: row.createdAt,
    }));
  }

  private async assertSlugFree(slug: string, exceptId: string | null): Promise<void> {
    const taken = await this.prisma.mediaOutlet.findFirst({
      where: { slug, ...(exceptId === null ? {} : { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (taken !== null) throw new BadRequestException("כבר קיימת מדיה עם הכתובת הזו");
  }
}

/** ‏ISO מהסכימה ⟵ `Date`; `null` נשאר `null` (אין מועד ידוע). */
function closingDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}
