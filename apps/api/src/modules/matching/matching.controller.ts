import { Controller, Get, HttpCode, Param, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import { MatchingService, type EnrichedMatchDto } from "./matching.service";

const ListQuerySchema = z
  .object({
    minScore: z.coerce.number().int().min(0).max(100).default(50),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    /** סינון לנכס אחד — הגעה ישירה מ"17 קונים מתאימים" ברשימת הנכסים */
    propertyId: IdSchema.optional(),
  })
  .strict();

@Controller("matches")
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequireCapability("matches.view")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<EnrichedMatchDto[]> {
    return this.matching.listAll(query);
  }

  /** "סמן לא רלוונטי" — פעולת כתיבה; viewer (צפייה בלבד) חסום (ביקורת Codex). */
  @Patch(":id/dismiss")
  @RequireCapability("matches.manage")
  @HttpCode(200)
  async dismiss(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.prisma.withTenant((tx) =>
      tx.match.updateMany({
        where: { id, tenantId: TenantContext.current().tenantId, status: "suggested" },
        data: { status: "dismissed" },
      }),
    );
    return { ok: true };
  }
}
