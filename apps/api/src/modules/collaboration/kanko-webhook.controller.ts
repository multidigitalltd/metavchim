import {
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ulid } from "ulid";
import { z } from "zod";
import { Public } from "../../common/auth.decorators";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../../core/prisma.service";

/** דייר מערכתי לביקושי Kanko — נוצר במיגרציה; אין לו משתמשים. */
export const KANKO_TENANT_ID = "0000000000000000000000KNK0";

const KankoDemandSchema = z
  .object({
    external_id: z.string().min(1).max(120),
    cities: z.array(z.string().min(1).max(80)).min(1),
    deal_type: z.enum(["sale", "rent"]),
    budget_max_ils: z.number().int().positive(),
    rooms_min: z.number().optional(),
    rooms_max: z.number().optional(),
    must_features: z.array(z.string().max(30)).default([]),
    notes: z.string().max(300).optional(),
    status: z.enum(["active", "closed"]).default("active"),
  })
  .strict();

/**
 * קליטת ביקושים מ-Kanko (docs/05 §4): Webhook חתום HMAC, Idempotent לפי
 * external_id, מנותק חינני — כשל כאן לא משפיע על שום דבר אחר במערכת.
 * סגור לחלוטין כשהסוד לא מוגדר.
 */
@Controller("webhooks/kanko")
export class KankoWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request): Promise<{ ok: true }> {
    const secret = loadEnv().KANKO_WEBHOOK_SECRET;
    if (!secret) throw new UnauthorizedException();

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.headers["x-kanko-signature"];
    if (!raw || typeof signature !== "string")
      throw new UnauthorizedException();
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new UnauthorizedException();

    const parsed = KankoDemandSchema.safeParse(req.body);
    if (!parsed.success) return { ok: true }; // פורמט לא צפוי — נזרק בשקט ללוג
    const demand = parsed.data;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${KANKO_TENANT_ID}, true)`;
      await tx.sharedDemand.upsert({
        where: { externalId: demand.external_id },
        create: {
          id: ulid(),
          tenantId: KANKO_TENANT_ID,
          source: "kanko",
          externalId: demand.external_id,
          cities: demand.cities,
          dealType: demand.deal_type,
          budgetMaxAgorot: BigInt(demand.budget_max_ils) * 100n,
          roomsMin: demand.rooms_min,
          roomsMax: demand.rooms_max,
          mustFeatures: demand.must_features,
          notes: demand.notes ?? null,
          status: demand.status,
        },
        update: {
          cities: demand.cities,
          budgetMaxAgorot: BigInt(demand.budget_max_ils) * 100n,
          roomsMin: demand.rooms_min,
          roomsMax: demand.rooms_max,
          mustFeatures: demand.must_features,
          status: demand.status,
        },
      });
    });
    return { ok: true };
  }
}
