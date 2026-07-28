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
  /** נמען ספציפי — התראה אישית; חסר = התראה משרדית לכל הדייר. */
  recipientUserId: IdSchema.optional(),
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  body: z.string().max(500).optional(),
  entityType: z.string().max(40).optional(),
  entityId: IdSchema.optional(),
  /** לתזכורות מתוזמנות: המועד שה-Job נקבע אליו — ה-Worker משווה מולו. */
  scheduledFor: z.coerce.date().optional(),
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
    case "coop_offer.sent": {
      const p = payload as DomainEventPayload<"coop_offer.sent">;
      return {
        tenantId: p.tenantId,
        type: "coop_offer_received",
        title: "🤝 התקבלה הצעת שיתוף פעולה",
        body: "סוכנות אחרת הציעה נכס לאחד הביקושים ששיתפת — בדקו אם מתאים לקונה.",
        entityType: "coop_offer",
        entityId: p.coopOfferId,
      };
    }
    case "appointment.scheduled": {
      const p = payload as DomainEventPayload<"appointment.scheduled">;
      return {
        tenantId: p.tenantId,
        type: "appointment_scheduled",
        title: "פגישה חדשה נקבעה ביומן",
        entityType: "appointment",
        entityId: p.appointmentId,
      };
    }
    default:
      return null;
  }
}

/** תזכורת שעה לפני פגישה — נכנסת לתור עם Delay (docs/01 §13). */
export function buildAppointmentReminder(payload: {
  appointmentId: string;
  tenantId: string;
}): NotificationJob {
  return {
    tenantId: payload.tenantId,
    type: "appointment_reminder",
    title: "⏰ תזכורת: פגישה מתחילה בעוד שעה",
    body: "בדקו את פרטי הנכס והלקוח לפני היציאה.",
    entityType: "appointment",
    entityId: payload.appointmentId,
  };
}

/**
 * תזכורת משימה במועד היעד — אישית לנמען בלבד (לא לכל המשרד), ונושאת את
 * המועד שתוזמנה אליו כדי שה-Worker ידלג על Job ישן אחרי דחייה/ביטול מועד.
 */
export function buildTaskReminder(payload: {
  taskId: string;
  tenantId: string;
  assignedToUserId: string;
  title: string;
  dueAt: Date;
}): NotificationJob {
  return {
    tenantId: payload.tenantId,
    recipientUserId: payload.assignedToUserId,
    type: "task_reminder",
    title: `📌 תזכורת: ${payload.title}`.slice(0, 200),
    entityType: "task",
    entityId: payload.taskId,
    scheduledFor: payload.dueAt,
  };
}
