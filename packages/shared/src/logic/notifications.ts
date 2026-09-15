import { z } from "zod";
import { IdSchema } from "../schemas/common.js";
import type { DomainEventName, DomainEventPayload } from "../events.js";
import { formatIsraeliNumber } from "./israel-time.js";

/**
 * אגורות לשקלים מנוקדים. בהתראה מציגים מספר שאפשר לקרוא בלי לספור
 * אפסים — "1,900,000" ולא "190000000".
 */
function shekels(agorot: number): string {
  return formatIsraeliNumber(Math.round(agorot / 100));
}

/**
 * תרגום אירועי דומיין → התראות למתווך.
 * ה-Dispatcher (ב-API) בונה את התוכן; ה-Worker רק כותב את השורה —
 * כך הניסוחים חיים במקום אחד, טהור ובדוק.
 */

/**
 * ‎**הכותרת והגוף של התראה אחת — הצורה, בלי הנמען ובלי הסוג.**
 *
 * ‏זה מה שפונקציית ניסוח מחזירה: `goalReachedCopy`, `feedbackCopy`,
 * ‎`demandMatchCopy`. הן חיות כל אחת בקובץ התכונה שלה, כי הניסוח
 * הוא של התכונה — אבל הצורה משותפת, וכשכל אחת הכריזה עליה בעצמה
 * שתי הצהרות זהות התנגשו בייצוא של החבילה.
 */
export interface NotificationCopy {
  title: string;
  body: string;
}

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
    /*
     * התאמות חדשות — **רק חדשות.**
     *
     * חישוב ההתאמות רץ בכל עריכה של נכס או ביקוש, ורובן מסתיימות
     * באותן התאמות שכבר היו. התראה על מה שלא השתנה היא התראה שמלמדת
     * את הסוכן להתעלם, ואז גם האמיתית נבלעת. לכן הסף הוא
     * `newMatchCount` ולא `matchCount`.
     *
     * שני הכיוונים מטופלים: נכס חדש שמצא קונים, וקונה חדש שנמצאו לו
     * נכסים. הצד השני היה שותק לגמרי — משמע ביקוש שנרשם עכשיו לא
     * הודיע לאיש, וזו בדיוק השיחה שהסוכן היה צריך לעשות היום.
     */
    case "matches.computed": {
      const p = payload as DomainEventPayload<"matches.computed">;
      if (p.newMatchCount < 1) return null;
      /*
       * "1 מהן ברמת התאמה גבוהה" על התאמה בודדת קורא כמו טקסט שנבנה
       * ממחרוזות ולא כמו משפט — וזה בדיוק מה שקרה. יחיד ורבים
       * מנוסחים בנפרד.
       */
      const strong =
        p.strongMatchCount === 0
          ? ""
          : p.newMatchCount === 1
            ? " ההתאמה ברמה גבוהה."
            : ` ${p.strongMatchCount} מהן ברמת התאמה גבוהה.`;
      /*
       * הזדמנות שנפתחה עכשיו — ניסוח נפרד, ובכוונה.
       *
       * סוכן שהוריד מחיר לפני דקה עדיין באותו הקשר; "הורדת המחיר
       * פתחה 3 קונים שהיו מחוץ לתקציב" הוא משפט שהוא פועל לפיו,
       * בעוד "נמצאו 3 קונים חדשים" נקרא כמו עדכון מערכת. אותו
       * אירוע בדיוק, ההבדל הוא רק במה שאומרים עליו.
       */
      if (p.trigger) {
        const opened = p.newMatchCount === 1 ? "התאמה אחת" : `${p.newMatchCount} התאמות`;
        return p.trigger.kind === "price_drop"
          ? {
              tenantId: p.tenantId,
              type: "opportunity_opened",
              title: `הורדת המחיר פתחה ${opened}`,
              body: `המחיר ירד ל-${shekels(p.trigger.toAgorot)} ₪, וקונים שהיו מחוץ לתקציב נכנסו לטווח. זה הרגע לפנות אליהם.${strong}`,
              entityType: "property",
              ...(p.propertyId ? { entityId: p.propertyId } : {}),
            }
          : {
              tenantId: p.tenantId,
              ...(p.ownerUserId ? { recipientUserId: p.ownerUserId } : {}),
              type: "opportunity_opened",
              title: `העלאת התקציב פתחה ${opened}`,
              body: `התקציב עלה ל-${shekels(p.trigger.toAgorot)} ₪, ונכסים שהיו מעליו נכנסו לטווח.${strong}`,
              entityType: "buyer",
              ...(p.buyerId ? { entityId: p.buyerId } : {}),
            };
      }
      if (p.propertyId) {
        return {
          tenantId: p.tenantId,
          type: "matches_found",
          title:
            p.newMatchCount === 1
              ? "נמצא קונה חדש שמתאים לנכס"
              : `נמצאו ${p.newMatchCount} קונים חדשים שמתאימים לנכס`,
          body: `פתחו את כרטיס הנכס ושלחו הצעה בלחיצה.${strong}`,
          entityType: "property",
          entityId: p.propertyId,
        };
      }
      if (p.buyerId) {
        return {
          tenantId: p.tenantId,
          // ההתראה לסוכן שהכרטיס שלו; בלי בעלים היא משרדית
          ...(p.ownerUserId ? { recipientUserId: p.ownerUserId } : {}),
          type: "matches_found",
          title:
            p.newMatchCount === 1
              ? "נמצא נכס חדש שמתאים לקונה"
              : `נמצאו ${p.newMatchCount} נכסים חדשים שמתאימים לקונה`,
          body: `פתחו את כרטיס הקונה וראו את ההתאמות.${strong}`,
          entityType: "buyer",
          entityId: p.buyerId,
        };
      }
      return null;
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
    case "shared_lead.sold": {
      const p = payload as DomainEventPayload<"shared_lead.sold">;
      return {
        tenantId: p.tenantId,
        type: "shared_lead_sold",
        title: "💰 ההפניה שפרסמתם נקלטה",
        /*
         * המסלול שנבחר בפרסום קובע את הניסוח. "קרדיטים נוספו ליתרה"
         * על הפניה שנמכרה בכסף היה שולח את המשרד לחפש אותם במקום
         * הלא נכון.
         */
        body:
          p.payoutAgorot !== undefined && p.payoutAgorot > 0
            ? `משרד אחר קלט את הלקוח שהפניתם — ${shekels(p.payoutAgorot)} ₪ נוספו ליתרה הכספית שלכם, וניתן למשוך אותם.`
            : `משרד אחר קלט את הלקוח שהפניתם — ${p.payoutCredits ?? p.priceCredits} קרדיטים נוספו ליתרה שלכם.`,
        entityType: "shared_lead",
        entityId: p.sharedLeadId,
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
