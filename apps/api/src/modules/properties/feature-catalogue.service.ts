import { Injectable } from "@nestjs/common";
import { featureCatalogue } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { readCustomFeatures } from "./property.mapper";

/**
 * קטלוג המאפיינים של המשרד — **שירות בלי תלויות, בכוונה.**
 *
 * הקטלוג נחוץ בשני טפסים: הנכס (שם מוסיפים מאפיין) והקונה (שם דורשים
 * אותו). הוא ישב על `PropertiesService`, וכשטופס הקונה נזקק לו
 * הוספתי `PropertiesModule` ל-`BuyersModule` — מה שסגר מעגל אמיתי,
 * `Buyers → Properties → Leads → Buyers`, ו-Nest סירב לעלות. הידור
 * עבר; רק הרצה גילתה.
 *
 * ההפרדה היא הפתרון הנכון ולא `forwardRef`: הקטלוג אינו באמת חלק
 * מניהול הנכסים — הוא **אוצר המילים של המשרד**, נגזר משדה אחד ואינו
 * נזקק לפענוח, למיקום או להתאמות. שירות שתלוי רק ב-Prisma יכול
 * להיות מיובא מכל מקום בלי לגרור אחריו את הגרף.
 *
 * הקטלוג נגזר מהנכסים החיים ואינו טבלה שצריך לתחזק, ולכן מאפיין
 * שהפסיק להיות בשימוש נושר מעצמו במקום להישאר ברשימה לנצח.
 */
@Injectable()
export class FeatureCatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ key: string; label: string; count: number }[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.property.findMany({
        where: { tenantId, deletedAt: null },
        select: { attributes: true },
        take: 2000,
      });
      return featureCatalogue(
        rows.map((row) => ({
          customFeatures: readCustomFeatures(row.attributes),
        })),
      );
    });
  }
}
