import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import type { MarketPlatformStatusDto } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { DEFAULT_MARKET_SOURCE_URL } from "./market-source";
import { MarketSyncService, type MarketRunResult } from "./market-sync.service";
import { MarketService } from "./market.service";

/**
 * ‎**מסך „נתוני שוק” בפלטפורמה** — מצב הסנכרון, כיסוי, נפח ותקלות.
 *
 * ההפעלה, הכיבוי והקצב נכתבים דרך `PATCH /platform/settings` כמו כל
 * הגדרה אחרת (`marketSyncEnabled`, `marketRequestIntervalMs`) — נתיב
 * כתיבה אחד להגדרות, ובדיקת `platform-settings-coverage` שומרת עליו.
 * כאן רק קריאת מצב וכפתור „סנכרן עכשיו”.
 *
 * ‎**ספירות על טבלאות של משרדים** (נכסים שקושרו לחלקה) נעשות ב-SQL
 * מצרפי בלבד — מספר, לא שורות — ולכן אינן חושפות דבר של משרד.
 */
@Controller("platform/market")
@PlatformAdmin()
export class MarketPlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
    private readonly sync: MarketSyncService,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Get()
  async status(): Promise<MarketPlatformStatusDto> {
    const [enabled, intervalMs, explicit, byStatus, sourceDeals, localDeals, lastDeal, parcels, located, runs, errors, size] =
      await Promise.all([
        this.sync.enabled(),
        this.sync.intervalMs(),
        this.settings.get("marketSyncEnabled"),
        this.prisma.marketSettlement.groupBy({ by: ["status"], _count: { id: true } }),
        this.prisma.marketSettlement.aggregate({ _sum: { sourceDeals: true } }),
        this.market.localDealCount(),
        this.prisma.marketDeal.findFirst({ orderBy: { dealDate: "desc" }, select: { dealDate: true } }),
        this.prisma.marketParcel.count(),
        this.prisma.marketParcel.count({ where: { lat: { not: null } } }),
        this.prisma.marketSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
        this.prisma.marketSettlement.findMany({
          where: { status: "error" },
          orderBy: { syncedAt: "desc" },
          take: 15,
          select: { name: true, lastError: true, syncedAt: true },
        }),
        this.prisma.$queryRaw<{ bytes: bigint }[]>`
          SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'market\\_%'`,
      ]);

    /*
     * ‎`properties` תחת FORCE RLS: ספירה אחת מבעד לתפקיד האפליקציה בלי
     * הקשר דייר הייתה מחזירה אפס בשקט. לכן משרד אחר משרד, כמו כל סבב —
     * ומה שיוצא מכאן הוא שני מספרים, לא שורות.
     */
    let linked = 0;
    let pending = 0;
    for (const tenant of await this.prisma.tenant.findMany({ select: { id: true } })) {
      const counts = await this.prisma.withExplicitTenant(tenant.id, async (tx) => ({
        linked: await tx.property.count({ where: { tenantId: tenant.id, deletedAt: null, gush: { not: null } } }),
        pending: await tx.property.count({
          where: { tenantId: tenant.id, deletedAt: null, parcelSource: null, latitude: { not: null } },
        }),
      }));
      linked += counts.linked;
      pending += counts.pending;
    }

    const count = (status: string): number => byStatus.find((row) => row.status === status)?._count.id ?? 0;
    const source = sourceDeals._sum.sourceDeals ?? 0;
    return {
      enabled,
      enabledSource: explicit === "true" || explicit === "false" ? "setting" : "default",
      intervalMs,
      running: this.sync.isRunning,
      source: DEFAULT_MARKET_SOURCE_URL,
      settlements: {
        total: byStatus.reduce((sum, row) => sum + row._count.id, 0),
        ok: count("ok"),
        backfill: count("backfill"),
        pending: count("pending"),
        error: count("error"),
      },
      deals: {
        local: localDeals,
        source,
        coveragePct: source > 0 ? Math.min(100, Math.round((localDeals / source) * 100)) : null,
        lastDeal: lastDeal ? lastDeal.dealDate.toISOString().slice(0, 10) : null,
      },
      parcels: { total: parcels, located },
      properties: { linked, pending },
      storageBytes: Number(size[0]?.bytes ?? 0),
      runs: runs.map((run) => ({
        id: run.id,
        kind: run.kind,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        requests: run.requests,
        rows: run.rows,
        message: run.message,
      })),
      errors: errors.map((row) => ({
        name: row.name,
        error: row.lastError,
        syncedAt: row.syncedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post("run")
  @HttpCode(202)
  async run(): Promise<MarketRunResult> {
    return this.sync.runNow();
  }
}
