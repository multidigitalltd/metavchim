import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { extractPropertyFromTranscript, type PropertyFields } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { PropertiesService } from "../properties/properties.service";
import type { PropertyDto } from "../properties/property.mapper";

export interface IntakeResult {
  intakeId: string;
  property: PropertyDto;
  evidence: Record<string, string>;
}

/**
 * קליטת נכס בקול (אפיון §6): תמלול → חילוץ שדות → כרטיס נכס + חוסרים.
 *
 * החילוץ כרגע במנוע החוקים הדטרמיניסטי מ-shared; שדרוג ל-LLM = מימוש
 * ExtractionProvider נוסף, בלי לגעת בזרימה (docs/05 §3).
 */
@Injectable()
export class VoiceIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async intake(transcript: string): Promise<IntakeResult> {
    const ctx = TenantContext.current();
    const { fields, evidence } = extractPropertyFromTranscript(transcript);

    // יצירת הנכס דרך אותו מסלול כמו טופס ידני — ניקוד מוכנות, אירועים והתאמות כלולים.
    const property = await this.properties.create({
      fields: fields as PropertyFields,
      marketingTitle: buildTitle(fields),
    });

    const intakeId = ulid();
    await this.prisma.withTenant(async (tx) => {
      await tx.voiceIntake.create({
        data: {
          id: intakeId,
          tenantId: ctx.tenantId,
          transcript,
          extractedFields: fields as object,
          missingFields: property.missingFields,
          propertyId: property.id,
          createdBy: ctx.userId,
        },
      });
      await this.audit.record(tx, {
        action: "voice_intake.create",
        entityType: "voice_intake",
        entityId: intakeId,
        metadata: { propertyId: property.id },
      });
      await this.outbox.emit(tx, "voice_intake.parsed", {
        intakeId,
        tenantId: ctx.tenantId,
        missingFields: property.missingFields,
      });
    });

    return {
      intakeId,
      property,
      evidence: evidence as Record<string, string>,
    };
  }
}

function buildTitle(fields: PropertyFields): string | undefined {
  if (fields.rooms === undefined || fields.city === undefined) return undefined;
  return `דירת ${fields.rooms} חדרים ב${fields.city}${fields.neighborhood ? `, ${fields.neighborhood}` : ""}`;
}
