import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * קליטת הודעות וואטסאפ נכנסות (docs/05 §1) — פורמט Meta Cloud API.
 *
 * ניתוב לדייר: לפי מספר הוואטסאפ העסקי שקיבל את ההודעה
 * (metadata.display_phone_number), שמוגדר בהגדרות הדייר. הודעה למספר
 * לא-מוכר נזרקת בשקט (נרשמת ללוג בלבד).
 *
 * Idempotency: מזהה ההודעה של Meta נבדק מול interactions שכבר נקלטו.
 */

const WebhookSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ display_phone_number: z.string() }).optional(),
            contacts: z
              .array(z.object({ profile: z.object({ name: z.string() }).optional(), wa_id: z.string() }))
              .optional(),
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<void> {
    const parsed = WebhookSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Webhook payload לא בפורמט צפוי — נזרק");
      return;
    }

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        const businessNumber = value.metadata?.display_phone_number;
        if (!businessNumber || !value.messages?.length) continue;

        const tenantId = await this.resolveTenant(businessNumber);
        if (!tenantId) {
          this.logger.warn(`הודעה למספר לא-משויך ${businessNumber} — נזרקת`);
          continue;
        }

        for (const message of value.messages) {
          if (message.type !== "text" || !message.text) continue;
          const senderName =
            value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? "לקוח וואטסאפ";
          await this.ingestMessage(tenantId, {
            externalId: message.id,
            fromPhone: normalizeWaPhone(message.from),
            senderName,
            text: message.text.body,
          });
        }
      }
    }
  }

  private async resolveTenant(businessNumber: string): Promise<string | null> {
    const digits = businessNumber.replace(/\D/gu, "");
    const tenant = await this.prisma.tenant.findFirst({
      where: { settings: { path: ["whatsappNumber"], equals: digits } },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async ingestMessage(
    tenantId: string,
    msg: { externalId: string; fromPhone: string; senderName: string; text: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      // Idempotency — הודעה שכבר נקלטה (Meta שולח כפולים) מדולגת.
      const dupe = await tx.interaction.findFirst({
        where: { tenantId, kind: "whatsapp", content: { startsWith: `[${msg.externalId}]` } },
        select: { id: true },
      });
      if (dupe) return;

      // איש קשר: קיים לפי phone_hash או חדש
      const phoneHash = this.crypto.phoneHash(msg.fromPhone);
      let contact = await tx.contact.findUnique({
        where: { tenantId_phoneHash: { tenantId, phoneHash } },
        select: { id: true },
      });
      contact ??= await tx.contact.create({
        data: {
          id: ulid(),
          tenantId,
          nameEncrypted: this.crypto.encrypt(msg.senderName),
          phoneEncrypted: this.crypto.encrypt(msg.fromPhone),
          phoneHash,
        },
        select: { id: true },
      });

      // נעילה פר איש-קשר: קליטה מקבילה (וובהוק + ידנית) לא תיצור ליד כפול
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${tenantId}:${contact.id}`}, 0))`;
      // ליד פתוח קיים ⇒ ההודעה מצטרפת לציר הזמן; אחרת ⇒ ליד חדש
      let lead = await tx.lead.findFirst({
        where: { tenantId, contactId: contact.id, status: { in: ["new", "in_progress", "waiting_customer"] } },
        select: { id: true },
      });
      if (!lead) {
        // ליד חוזר: לאיש הקשר ליד קודם שנסגר — פנייה מחודשת היא איתות קנייה חזק
        const previous = await tx.lead.findFirst({
          where: { tenantId, contactId: contact.id, status: { in: ["converted", "closed"] } },
          select: { id: true },
        });
        lead = await tx.lead.create({
          data: {
            id: ulid(),
            tenantId,
            contactId: contact.id,
            source: "whatsapp",
            intent: "unknown",
            status: "new",
            summary: msg.text.slice(0, 500),
          },
          select: { id: true },
        });
        await tx.outboxEvent.create({
          data: {
            id: ulid(),
            tenantId,
            name: "lead.created",
            payload: { leadId: lead.id, tenantId, source: "whatsapp", requiresHuman: false },
          },
        });
        if (previous) {
          const returnedLeadId = lead.id;
          await tx.interaction.create({
            data: {
              id: ulid(),
              tenantId,
              leadId: returnedLeadId,
              kind: "system",
              content: "🔁 ליד חוזר — לאיש הקשר ליד קודם שנסגר. ההיסטוריה המלאה בתיק הלקוח.",
            },
          });
          // הליד עדיין לא משויך — רק בעלי view_all (owner/admin) רואים אותו,
          // אז ההתראה הולכת אליהם ולא לכל המשרד (ביקורת Codex: קישור
          // שמוביל סוכן רגיל ל-404)
          const managers = await tx.user.findMany({
            where: { tenantId, isActive: true, role: { in: ["owner", "admin"] } },
            select: { id: true },
          });
          await tx.notification.createMany({
            data: managers.map((m) => ({
              id: ulid(),
              tenantId,
              userId: m.id,
              type: "lead_returned",
              title: "🔁 ליד חוזר",
              body: `${msg.senderName} פנה שוב בוואטסאפ אחרי שהליד הקודם נסגר — שווה עדיפות.`,
              entityType: "lead",
              entityId: returnedLeadId,
            })),
          });
        }
      }

      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId,
          leadId: lead.id,
          kind: "whatsapp",
          direction: "in",
          content: `[${msg.externalId}] ${msg.text}`.slice(0, 4000),
        },
      });
    });
  }
}

/** wa_id של Meta הוא ספרות בלבד (9725...) — נורמליזציה ל-E.164. */
function normalizeWaPhone(waId: string): string {
  const digits = waId.replace(/\D/gu, "");
  return digits.startsWith("972") ? `+${digits}` : `+972${digits.replace(/^0/u, "")}`;
}
