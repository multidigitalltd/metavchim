import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  nextViewingFeedbackField,
  VIEWING_CONDITION_FEEDBACK,
  VIEWING_FIT_FEEDBACK,
  VIEWING_PRICE_FEEDBACK,
  type ViewingFeedbackField,
  type ViewingFeedbackRow,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/**
 * משוב מביקור — הכתיבה האחת לשלוש העמודות (docs/03 — appointments).
 *
 * שני מסלולים כותבים אותו: הטופס שאחרי הסיור (`CalendarService.update`)
 * והכפתורים בוואטסאפ (`WhatsAppAssistantService`). שניהם עוברים
 * כאן, כדי שהכלל „רק לסיור, רק מהרשימה” ייכתב פעם אחת.
 *
 * ‎**מסופק גם במודול הוואטסאפ ישירות**, כמו `ViewingReplyService`:
 * ייבוא מודול היומן לנתיב הקליטה היה גורר את כל שרשרת התלויות שלו.
 */

export interface ViewingFeedbackPatch {
  feedbackPrice?: string | null;
  feedbackCondition?: string | null;
  feedbackFit?: string | null;
}

const ALLOWED: Record<ViewingFeedbackField, readonly string[]> = {
  price: VIEWING_PRICE_FEEDBACK,
  condition: VIEWING_CONDITION_FEEDBACK,
  fit: VIEWING_FIT_FEEDBACK,
};

@Injectable()
export class ViewingFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * החלת המשוב על שורת פגישה **שכבר נטענה** — בתוך הטרנזקציה של
   * הקורא. משוב על פגישה שאינה סיור הוא קלט פגום, לא שקט.
   */
  static apply(patch: ViewingFeedbackPatch, appointment: { kind: string }): ViewingFeedbackPatch {
    const touched = Object.values(patch).some((value) => value !== undefined);
    if (!touched) return {};
    if (appointment.kind !== "viewing") {
      throw new BadRequestException("משוב מביקור זמין רק לפגישות מסוג סיור בנכס");
    }
    for (const [field, list] of Object.entries(ALLOWED) as [ViewingFeedbackField, readonly string[]][]) {
      const value = patch[ViewingFeedbackService.column(field)];
      if (value !== undefined && value !== null && !list.includes(value)) {
        throw new BadRequestException("ערך משוב לא מוכר");
      }
    }
    return {
      ...(patch.feedbackPrice !== undefined ? { feedbackPrice: patch.feedbackPrice } : {}),
      ...(patch.feedbackCondition !== undefined ? { feedbackCondition: patch.feedbackCondition } : {}),
      ...(patch.feedbackFit !== undefined ? { feedbackFit: patch.feedbackFit } : {}),
    };
  }

  static column(field: ViewingFeedbackField): keyof ViewingFeedbackPatch {
    return field === "price" ? "feedbackPrice" : field === "condition" ? "feedbackCondition" : "feedbackFit";
  }

  /**
   * תשובה אחת מכפתור בוואטסאפ ⟵ נכתבת, ומוחזר מה עוד חסר.
   *
   * ‎`null` = הסיור אינו של המשרד הזה (או אינו סיור). הסוכן עונה
   * „לא מצאתי” ולא 404: הכפתור הגיע מהודעה ישנה, לא ממישהו שניחש.
   */
  async record(
    appointmentId: string,
    field: ViewingFeedbackField,
    value: string,
  ): Promise<{ label: string; current: ViewingFeedbackRow; next: ViewingFeedbackField | null } | null> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.appointment.findFirst({
        where: { id: appointmentId, tenantId },
        select: { id: true, kind: true, title: true, propertyId: true, feedbackPrice: true, feedbackCondition: true, feedbackFit: true },
      });
      if (!row || row.kind !== "viewing") return null;
      const patch = ViewingFeedbackService.apply({ [ViewingFeedbackService.column(field)]: value }, row);
      const updated = await tx.appointment.update({
        where: { id: row.id },
        data: { ...patch, googleSyncedAt: null },
        select: { feedbackPrice: true, feedbackCondition: true, feedbackFit: true },
      });
      await ViewingFeedbackService.recordAudit(this.audit, tx, row.id, row.propertyId);
      const current: ViewingFeedbackRow = { price: updated.feedbackPrice, condition: updated.feedbackCondition, fit: updated.feedbackFit };
      return { label: await this.labelOf(tx, tenantId, row.title, row.propertyId), current, next: nextViewingFeedbackField(current) };
    });
  }

  static async recordAudit(audit: AuditService, tx: TenantTx, appointmentId: string, propertyId: string | null): Promise<void> {
    await audit.record(tx, {
      action: "appointment.feedback",
      entityType: "appointment",
      entityId: appointmentId,
      ...(propertyId === null ? {} : { metadata: { propertyId } }),
    });
  }

  /** „הסיור ב…” — הכותרת, או כתובת הנכס, בלי שם של אדם. */
  private async labelOf(tx: TenantTx, tenantId: string, title: string | null, propertyId: string | null): Promise<string> {
    if (propertyId !== null) {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId },
        select: { marketingTitle: true, street: true, houseNumber: true, city: true },
      });
      if (property) {
        const address = [[property.street, property.houseNumber].filter(Boolean).join(" "), property.city].filter((p) => p).join(", ");
        if (property.marketingTitle || address) return property.marketingTitle || address;
      }
    }
    if (title !== null && title.trim() !== "") return title;
    throw new NotFoundException("הסיור לא נמצא");
  }
}
