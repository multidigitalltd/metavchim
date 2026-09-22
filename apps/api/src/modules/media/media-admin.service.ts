import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  MEDIA_ORDER_STATUS_LABEL,
  type MediaOrderStatus,
  type MediaOutletKind,
  type MediaOutletPatch,
  type MediaOutletUpsert,
  type MediaProductKind,
  type MediaProductPatch,
  type MediaProductUpsert,
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
  active: boolean;
  sortOrder: number;
  products: AdminMediaProduct[];
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
  createdAt: Date;
}

@Injectable()
export class MediaAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async outlets(): Promise<AdminMediaOutlet[]> {
    const rows = await this.prisma.mediaOutlet.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { products: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    });
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
      active: row.active,
      sortOrder: row.sortOrder,
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
    await this.prisma.mediaOutlet.create({ data: { id, ...input, updatedBy } });
    return { id };
  }

  async updateOutlet(id: string, patch: MediaOutletPatch, updatedBy: string): Promise<void> {
    const existing = await this.prisma.mediaOutlet.findUnique({ where: { id }, select: { id: true } });
    if (existing === null) throw new NotFoundException("המדיה לא נמצאה");
    if (patch.slug !== undefined) await this.assertSlugFree(patch.slug, id);
    await this.prisma.mediaOutlet.update({ where: { id }, data: { ...patch, updatedBy } });
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
