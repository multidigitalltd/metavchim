import { z } from "zod";
import { IdSchema } from "../schemas/common.js";
import type { DomainEventName, DomainEventPayload } from "../events.js";

/**
 * תרגום אירועי דומיין → התראות למתווך.
 * ה-Dispatcher (ב-API) בונה את התוכן; ה-Worker רק כותב את השורה —
 * כך הניסוחים חיים במקום אחד, טהור ובדוק.
 */

export const NotificationJobSchema = z.object({
  tenantId: IdSchema,
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  body: z.string().max(500).optional(),
  entityType: z.string().max(40).optional(),
  entityId: IdSchema.optional(),
});
export type NotificationJob = z.infer<typeof NotificationJobSchema>;

export function notificationFromEvent<E extends DomainEventName>(
  name: E,
  payload: DomainEventPayload<E>,
): NotificationJob | null {
  switch (name) {
    case "offer.opened": {
      const p = payload as DomainEventPayload<"offer.opened">;
      return {
        tenantId: p.tenantId,
        type: "offer_opened",
        title: "הקונה פתח את ההצעה ששלחת",
        body:
          p.openCount >= 3
            ? `זו הפתיחה ה-${p.openCount} — הוא מתלבט. מומלץ לחזור אליו היום.`
            : "כדאי לעקוב — אם יפתח שוב, שווה שיחה.",
        entityType: "offer",
        entityId: p.offerId,
      };
    }
    case "offer.interested": {
      const p = payload as DomainEventPayload<"offer.interested">;
      return {
        tenantId: p.tenantId,
        type: "offer_interested",
        title: "👍 קונה מעוניין בנכס!",
        body: "חזור אליו עכשיו לתיאום צפייה — לידים חמים מתקררים מהר.",
        entityType: "offer",
        entityId: p.offerId,
      };
    }
    case "lead.created": {
      const p = payload as DomainEventPayload<"lead.created">;
      if (!p.requiresHuman) return null; // ליד רגיל מופיע בדשבורד; התראה רק לדחוף
      return {
        tenantId: p.tenantId,
        type: "lead_requires_human",
        title: "ליד חדש דורש טיפול אנושי",
        body: "הבוט סימן את הפנייה כרגישה — כדאי לחזור ללקוח בהקדם.",
        entityType: "lead",
        entityId: p.leadId,
      };
    }
    case "matches.computed": {
      const p = payload as DomainEventPayload<"matches.computed">;
      if (!p.propertyId || p.matchCount < 1) return null;
      return {
        tenantId: p.tenantId,
        type: "matches_found",
        title: `נמצאו ${p.matchCount} קונים מתאימים לנכס`,
        body: "פתח את כרטיס הנכס ושלח הצעות בלחיצה.",
        entityType: "property",
        entityId: p.propertyId,
      };
    }
    default:
      return null;
  }
}
