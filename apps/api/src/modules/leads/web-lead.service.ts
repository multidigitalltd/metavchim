import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * קליטת ליד מטופס באתר של המשרד (docs/05) — נקודת קצה ציבורית עם מפתח
 * ייעודי פר-משרד (settings.leadWebhookKey). אותה משמעת כמו קליטת
 * הוואטסאפ: איש קשר לפי phone_hash, נעילה פר איש-קשר נגד כפילויות,
 * פנייה כשיש ליד פתוח מצטרפת לציר הזמן במקום לפתוח ליד כפול.
 */
@Injectable()
export class WebLeadService {
  private readonly logger = new Logger(WebLeadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async ingest(
    key: string,
    input: { name: string; phone: string; message?: string; pageUrl?: string },
  ): Promise<void> {
    /*
     * המפתח מזהה גם את המשרד וגם את הערוץ: שם המקור שנבחר בהקמת
     * הוובהוק ("אתר", "פייסבוק"...) נכנס כ-source של הליד.
     */
    const webhook = await this.prisma.leadWebhook.findUnique({
      where: { key },
      select: { tenantId: true, sourceLabel: true },
    });
    if (!webhook) {
      // מפתח לא מוכר — אותה שגיאה גנרית; לא מאשרים קיום/אי-קיום מפתחות
      throw new NotFoundException("לא נמצא");
    }
    await this.ingestForTenant(webhook.tenantId, input, webhook.sourceLabel);
  }

  /**
   * קליטה כשהדייר כבר זוהה בערוץ אחר (דף נחיתה של נכס — הטוקן זיהה)
   * או דרך וובהוק. אותה משמעת בדיוק: phone_hash, נעילה פר איש-קשר,
   * הצטרפות לליד פתוח.
   *
   * `source` הוא "landing" או שם המקור החופשי של הוובהוק — הוא נשמר
   * כמו שהוא על הליד ומוצג ברשימה (עד 20 תווים, כאורך העמודה).
   */
  async ingestForTenant(
    tenantId: string,
    input: { name: string; phone: string; message?: string; pageUrl?: string },
    source: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const phoneHash = this.crypto.phoneHash(input.phone);
      let contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true },
      });
      contact ??= await tx.contact.create({
        data: {
          id: ulid(),
          tenantId,
          nameEncrypted: this.crypto.encrypt(input.name),
          phoneEncrypted: this.crypto.encrypt(input.phone),
          phoneHash,
        },
        select: { id: true },
      });

      // נעילה פר איש-קשר — שליחה כפולה מהטופס לא יוצרת שני לידים
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${tenantId}:${contact.id}`}, 0))`;

      const summaryParts = [input.message?.trim(), input.pageUrl ? `מקור: ${input.pageUrl}` : null]
        .filter(Boolean)
        .join("\n");

      const openLead = await tx.lead.findFirst({
        where: {
          tenantId,
          contactId: contact.id,
          status: { in: ["new", "in_progress", "waiting_customer"] },
        },
        select: { id: true },
      });

      if (openLead) {
        // ליד פתוח קיים — הפנייה מצטרפת לציר הזמן שלו
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            leadId: openLead.id,
            kind: "note",
            content: `${source === "landing" ? "פנייה נוספת מדף נחיתה" : `פנייה נוספת (${source})`}: ${summaryParts || "ללא הודעה"}`,
          },
        });
        return;
      }

      const previous = await tx.lead.findFirst({
        where: { tenantId, contactId: contact.id, status: { in: ["converted", "closed"] } },
        select: { id: true },
      });

      const leadId = ulid();
      await tx.lead.create({
        data: {
          id: leadId,
          tenantId,
          contactId: contact.id,
          source,
          intent: "unknown",
          status: "new",
          summary: (summaryParts || (source === "landing" ? "פנייה מדף נחיתה" : `פנייה — ${source}`)).slice(0, 500),
          ...(previous ? { requiresHuman: true, requiresHumanReason: "ליד חוזר — פנה בעבר" } : {}),
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          leadId,
          kind: "note",
          content: `${source === "landing" ? "נקלט מדף נחיתה של נכס" : `נקלט מטופס (${source})`}${input.message ? `: ${input.message.slice(0, 1500)}` : ""}`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId,
          name: "lead.created",
          payload: { leadId, tenantId, source },
        },
      });
    });
    this.logger.log(`ליד מהאתר נקלט (tenant ${tenantId})`);
  }
}
