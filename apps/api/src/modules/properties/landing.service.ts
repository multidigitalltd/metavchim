import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { loadEnv } from "../../config/env";
import { TenantContext } from "../../common/tenant-context";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { WebLeadService } from "../leads/web-lead.service";

/**
 * דף נחיתה ציבורי לנכס — "צור דף נחיתה" מקובץ העיצוב.
 *
 * קישור שיווקי שהמתווך שולח או מטמיע: כותרת ותיאור שיווקיים, פרטי
 * הנכס, תמונות, וטופס פנייה שנכנס ישירות ללידים עם מקור "דף נחיתה".
 *
 * שתי החלטות פרטיות מכוונות:
 * - הכתובת המדויקת (רחוב ומספר) לא מוצגת — רק שכונה ועיר. דף ציבורי
 *   עם כתובת מלאה מאפשר לעקוף את המתווך ולפנות לבעלים ישירות.
 * - אין שום PII של בעל הנכס בתשובה הציבורית.
 */

export interface LandingView {
  status: "ok" | "unavailable";
  title: string;
  description?: string;
  city?: string;
  neighborhood?: string;
  propertyType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  priceAgorot?: number;
  features: string[];
  images: { url: string; alt?: string }[];
  officeName: string;
}

/** הנכס משווק? נמכר/ארכיון ⇒ הדף מציג "לא זמין" במקום למכור אוויר. */
const MARKETABLE = new Set(["draft", "active", "on_hold"]);

@Injectable()
export class LandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly webLeads: WebLeadService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * זכאות המסלול לדפי נחיתה — בנתיבים הציבוריים.
   *
   * `FeatureGuard` מדלג במפורש על נתיב ציבורי: אין לו הקשר דייר בזמן
   * השער. לכן ביטול הפיצ'ר במסלול היה סוגר רק את יצירת הקישור,
   * בעוד דפים שכבר הונפקו היו ממשיכים להיות מוגשים ולקלוט לידים —
   * לנצח (ביקורת Codex).
   *
   * המשרד נודע רק אחרי שהטוקן נפתר, וזו הנקודה הראשונה שאפשר לשאול
   * בה. השגיאה זהה לזו של טוקן לא מוכר: מבקר מזדמן לא אמור ללמוד
   * מהתשובה דבר על מצב המנוי של המשרד.
   */
  private async assertLandingEnabled(tenantId: string): Promise<void> {
    if (!(await this.plans.tenantHasFeature(tenantId, "landing_pages"))) {
      throw new NotFoundException("הדף לא נמצא");
    }
  }

  /** יצירת הקישור (או החזרתו אם כבר קיים) — פעולה של המתווך המחובר. */
  async ensure(propertyId: string): Promise<{ url: string }> {
    const tenantId = TenantContext.current().tenantId;
    const token = await this.prisma.withTenant(async (tx) => {
      const row = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { landingToken: true },
      });
      if (!row) throw new NotFoundException("נכס לא נמצא");
      if (row.landingToken !== null) return row.landingToken;
      const fresh = randomBytes(32).toString("base64url");
      await tx.property.update({ where: { id: propertyId }, data: { landingToken: fresh } });
      return fresh;
    });
    return { url: `${loadEnv().WEB_ORIGIN}/p/${token}` };
  }

  /** ביטול הקישור — הדף מפסיק לעבוד מיידית; יצירה מחדש מנפיקה טוקן חדש. */
  async revoke(propertyId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const row = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!row) throw new NotFoundException("נכס לא נמצא");
      await tx.property.update({ where: { id: propertyId }, data: { landingToken: null } });
    });
  }

  async publicView(token: string): Promise<LandingView> {
    return this.prisma.withPublicLanding(token, async (tx) => {
      const p = await tx.property.findFirst({ where: { landingToken: token } });
      if (!p || p.deletedAt !== null) throw new NotFoundException("הדף לא נמצא");
      await this.assertLandingEnabled(p.tenantId);

      // שם המשרד — ההקשר נקבע מהנכס שנמצא (ערך שרת, לא קלט)
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${p.tenantId}, true)`;
      const tenant = await tx.tenant.findUnique({
        where: { id: p.tenantId },
        select: { name: true },
      });
      const officeName = tenant?.name ?? "משרד תיווך";

      if (!MARKETABLE.has(p.status)) {
        return { status: "unavailable", title: "הנכס כבר לא זמין", features: [], images: [], officeName };
      }

      const media = await tx.propertyMedia.findMany({
        where: { propertyId: p.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, altText: true },
      });

      const features = [
        p.hasElevator === true && "מעלית",
        p.hasParking === true && "חניה",
        p.hasBalcony === true && "מרפסת",
        p.hasSafeRoom === true && 'ממ"ד',
      ].filter((f): f is string => typeof f === "string");

      return {
        status: "ok",
        title:
          p.marketingTitle ??
          ([p.neighborhood, p.city].filter(Boolean).join(", ") || "נכס למכירה"),
        description: p.marketingDescription ?? undefined,
        city: p.city ?? undefined,
        neighborhood: p.neighborhood ?? undefined,
        propertyType: p.propertyType ?? undefined,
        rooms: p.rooms === null ? undefined : Number(p.rooms),
        areaSqm: p.areaSqm ?? undefined,
        floor: p.floor ?? undefined,
        priceAgorot: p.priceAgorot === null ? undefined : Number(p.priceAgorot),
        features,
        images: media.map((m) => ({
          url: `/public/landing/${token}/media/${m.id}`,
          ...(m.altText !== null ? { alt: m.altText } : {}),
        })),
        officeName,
      };
    });
  }

  /** הזרמת תמונה לדף הציבורי — הפוליסה חושפת רק את תמונות הנכס של הטוקן. */
  async publicImage(
    token: string,
    mediaId: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType?: string; contentLength?: number }> {
    const s3Key = await this.prisma.withPublicLanding(token, async (tx) => {
      const property = await tx.property.findFirst({
        where: { landingToken: token },
        select: { id: true, tenantId: true, deletedAt: true },
      });
      if (!property || property.deletedAt !== null) throw new NotFoundException("הדף לא נמצא");
      await this.assertLandingEnabled(property.tenantId);
      const row = await tx.propertyMedia.findFirst({
        where: { id: mediaId, propertyId: property.id },
        select: { s3Key: true },
      });
      if (!row) throw new NotFoundException("תמונה לא נמצאה");
      return row.s3Key;
    });
    try {
      return await this.storage.getObject(s3Key);
    } catch (error) {
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("התמונה לא נמצאה באחסון");
      }
      throw error;
    }
  }

  /** פנייה מטופס הדף — נכנסת ללידים עם מקור "דף נחיתה" והקשר הנכס. */
  async publicLead(
    token: string,
    input: { name: string; phone: string; message?: string },
  ): Promise<void> {
    const property = await this.prisma.withPublicLanding(token, (tx) =>
      tx.property.findFirst({
        where: { landingToken: token },
        select: { tenantId: true, deletedAt: true, neighborhood: true, city: true, marketingTitle: true },
      }),
    );
    if (!property || property.deletedAt !== null) throw new NotFoundException("הדף לא נמצא");
    await this.assertLandingEnabled(property.tenantId);
    const label =
      property.marketingTitle ??
      [property.neighborhood, property.city].filter(Boolean).join(", ");
    await this.webLeads.ingestForTenant(
      property.tenantId,
      {
        name: input.name,
        phone: input.phone,
        message: input.message,
        // ההקשר שהמתווך צריך: מאיזה נכס הגיעה הפנייה
        pageUrl: label ? `דף נחיתה — ${label}` : "דף נחיתה",
      },
      "landing",
    );
  }
}
