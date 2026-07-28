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
