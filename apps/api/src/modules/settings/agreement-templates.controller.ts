import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AGREEMENT_KIND_LABELS,
  defaultAgreementTemplate,
  missingRequiredPlaceholders,
  type AgreementKind,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * נוסחי ההסכמים של המשרד — הזמנה בכתב והסכם בלעדיות.
 *
 * אין שורה בטבלה ⇒ מוחזר נוסח ברירת המחדל שבקוד. כך משרד חדש עובד
 * מהיום הראשון בלי להגדיר דבר, ו"שחזור לברירת המחדל" הוא מחיקת
 * השורה ולא העתקה מחדש של טקסט.
 */

const KindSchema = z.enum(["brokerage", "exclusivity"]);
const BodySchema = z.object({ body: z.string().min(50).max(50_000) }).strict();

export interface AgreementTemplateDto {
  kind: AgreementKind;
  label: string;
  body: string;
  /** האם המשרד התאים את הנוסח, או שזו ברירת המחדל */
  customized: boolean;
  /** פרטי חובה מתקנות המתווכים שהנוסח משמיט — אזהרה, לא חסימה */
  missingRequired: string[];
  updatedAt?: Date;
}

@Controller("settings/agreement-templates")
export class AgreementTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireCapability("settings.manage")
  async list(): Promise<AgreementTemplateDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.agreementTemplate.findMany({ where: { tenantId } });
      const byKind = new Map(rows.map((row) => [row.kind, row]));
      return KindSchema.options.map((kind) => {
        const row = byKind.get(kind);
        const body = row?.body ?? defaultAgreementTemplate(kind);
        return {
          kind,
          label: AGREEMENT_KIND_LABELS[kind],
          body,
          customized: row !== undefined,
          missingRequired: missingRequiredPlaceholders(kind, body),
          updatedAt: row?.updatedAt,
        };
      });
    });
  }

  @Put(":kind")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async save(
    @Param("kind", new ZodValidationPipe(KindSchema)) kind: AgreementKind,
    @Body(new ZodValidationPipe(BodySchema)) body: z.infer<typeof BodySchema>,
  ): Promise<AgreementTemplateDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.agreementTemplate.findFirst({ where: { tenantId, kind } });
      const row = existing
        ? await tx.agreementTemplate.update({
            where: { id: existing.id },
            data: { body: body.body, updatedBy: userId },
          })
        : await tx.agreementTemplate.create({
            data: { id: ulid(), tenantId, kind, body: body.body, updatedBy: userId },
          });

      await this.audit.record(tx, {
        action: "settings.update",
        entityType: "agreement_template",
        entityId: row.id,
        metadata: { kind },
      });

      return {
        kind,
        label: AGREEMENT_KIND_LABELS[kind],
        body: row.body,
        customized: true,
        missingRequired: missingRequiredPlaceholders(kind, row.body),
        updatedAt: row.updatedAt,
      };
    });
  }

  /** שחזור לנוסח ברירת המחדל — מחיקת ההתאמה, לא העתקת טקסט. */
  @Delete(":kind")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async reset(
    @Param("kind", new ZodValidationPipe(KindSchema)) kind: AgreementKind,
  ): Promise<AgreementTemplateDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await tx.agreementTemplate.deleteMany({ where: { tenantId, kind } });
      await this.audit.record(tx, {
        action: "settings.update",
        entityType: "agreement_template",
        entityId: kind,
        metadata: { kind, reset: true },
      });
      const body = defaultAgreementTemplate(kind);
      return {
        kind,
        label: AGREEMENT_KIND_LABELS[kind],
        body,
        customized: false,
        missingRequired: missingRequiredPlaceholders(kind, body),
      };
    });
  }
}
