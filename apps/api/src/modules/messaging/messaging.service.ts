import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import type { TenantTx } from "../../core/prisma.service";

/**
 * ניסוח הודעת ההצעה לקונה — הנוסח מהאפיון (§10): מכבד, לא ספאמי,
 * עם קישור לדף ההצעה ואפשרות תגובה.
 */
export function buildOfferMessage(input: { title: string; priceText: string; url: string }): string {
  return [
    "שלום, נמצאה הצעת נכס שעשויה להתאים למה שחיפשת.",
    `${input.title}, ${input.priceText}.`,
    `לצפייה בפרטים: ${input.url}`,
    "אפשר להשיב כאן או לבקש שיחה עם המתווך.",
  ].join("\n");
}

/**
 * רישום הודעות יוצאות (Messaging Hub — שלב ראשון).
 *
 * ערוץ walink: המתווך שולח בעצמו דרך wa.me עם טקסט מוכן — עובד מיידית,
 * בלי חשבון Meta. שליחה אוטומטית דרך Cloud API תתווסף כ-Provider נוסף
 * מאחורי אותו ממשק (docs/05 §0-1) בלי לגעת בקוד העסקי.
 */
@Injectable()
export class MessagingService {
  /**
   * הודעת וואטסאפ חופשית ללקוח — הרישום שלפני הקישור.
   *
   * אותו ערוץ `walink` כמו הצעה: ההודעה נרשמת ב-Hub ובציר הזמן של
   * הכרטיס, והשליחה עצמה נעשית בלחיצה על קישור wa.me. הרישום כאן
   * ולא אצל הקורא, כדי ששני הצעדים — Hub וציר — לא ייפרדו זה מזה
   * בקורא הבא.
   */
  async prepareFreeText(
    tx: TenantTx,
    input: {
      contactId: string;
      card: { kind: "buyer" | "lead"; id: string };
      body: string;
    },
  ): Promise<void> {
    await this.recordOutbound(tx, {
      contactId: input.contactId,
      channel: "whatsapp",
      provider: "walink",
      body: input.body,
    });
    await tx.interaction.create({
      data: {
        id: ulid(),
        tenantId: TenantContext.current().tenantId,
        ...(input.card.kind === "buyer" ? { buyerId: input.card.id } : { leadId: input.card.id }),
        kind: "whatsapp",
        direction: "out",
        // ציר הזמן מציג מה נשלח — התוכן הוא הרישום
        content: input.body.slice(0, 1000),
        createdBy: TenantContext.current().userId,
      },
    });
  }

  async recordOutbound(
    tx: TenantTx,
    input: {
      contactId?: string;
      offerId?: string;
      channel: string;
      provider: string;
      body: string;
    },
  ): Promise<string> {
    const id = ulid();
    await tx.message.create({
      data: {
        id,
        tenantId: TenantContext.current().tenantId,
        contactId: input.contactId ?? null,
        offerId: input.offerId ?? null,
        direction: "out",
        channel: input.channel,
        provider: input.provider,
        body: input.body.slice(0, 4000),
        status: "sent",
      },
    });
    return id;
  }
}
