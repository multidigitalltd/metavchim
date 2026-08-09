import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_LEAD_SOURCES,
  type LeadSourcePrice,
} from "@metavchim/shared";
import { PrismaService } from "./prisma.service";

/**
 * מחירי הלידים לפי מקור.
 *
 * אותו דפוס בדיוק כמו `PlanCatalogService`: הטבלה נקראת **מעל**
 * ברירות המחדל שבקוד ולא במקומן. מערכת שעלתה זה עתה, או מקור חדש
 * שנוסף לקוד לפני שמישהו תמחר אותו במסך, ממשיכה לעבוד.
 *
 * קאש קצר: המחיר נקרא בכל טעינה של פיד הביקושים ובכל הצעה. עדכון
 * מהמסך מנקה אותו מיד.
 */
@Injectable()
export class LeadPricingService {
  private static readonly TTL_MS = 30_000;
  private readonly logger = new Logger(LeadPricingService.name);
  private cache: { prices: LeadSourcePrice[]; until: number } | null = null;
  /** מונה שמבטל תוצאה של קריאה שהתחילה לפני עדכון (מרוץ). */
  private generation = 0;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<LeadSourcePrice[]> {
    const now = Date.now();
    if (this.cache && this.cache.until > now) return this.cache.prices;

    const startedAt = this.generation;
    let rows: { source: string; label: string; creditsCost: number }[] = [];
    try {
      rows = await this.prisma.leadSourcePrice.findMany({ orderBy: { source: "asc" } });
    } catch (error) {
      // טבלה שטרם נוצרה (מיגרציה שלא רצה) אינה סיבה להפיל את הפיד
      this.logger.warn(`טעינת מחירי הלידים נכשלה — ברירות המחדל: ${String(error)}`);
      return [...DEFAULT_LEAD_SOURCES];
    }

    const merged = new Map<string, LeadSourcePrice>(
      DEFAULT_LEAD_SOURCES.map((price) => [price.source, { ...price }]),
    );
    for (const row of rows) {
      merged.set(row.source, {
        source: row.source,
        label: row.label,
        creditsCost: row.creditsCost,
      });
    }
    const prices = [...merged.values()];
    if (this.generation === startedAt) {
      this.cache = { prices, until: now + LeadPricingService.TTL_MS };
    }
    return prices;
  }

  async upsert(price: LeadSourcePrice, updatedBy: string): Promise<void> {
    await this.prisma.leadSourcePrice.upsert({
      where: { source: price.source },
      create: { ...price, updatedBy },
      update: { label: price.label, creditsCost: price.creditsCost, updatedBy },
    });
    this.generation += 1;
    this.cache = null;
  }

  async remove(source: string): Promise<void> {
    await this.prisma.leadSourcePrice.deleteMany({ where: { source } });
    this.generation += 1;
    this.cache = null;
  }
}
