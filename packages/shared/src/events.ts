import { z } from "zod";
import { IdSchema } from "./schemas/common.js";

/**
 * חוזי אירועי הדומיין — האמת היחידה לשמות ול-Payload.
 * כל אירוע נכתב ל-Outbox באותה טרנזקציה עם השינוי, ומופץ ע"י Worker.
 */
export const DomainEvents = {
  "lead.created": z.object({
    leadId: IdSchema,
    tenantId: IdSchema,
    source: z.string(),
    requiresHuman: z.boolean(),
  }),
  "call.summarized": z.object({
    leadId: IdSchema,
    tenantId: IdSchema,
    interactionId: IdSchema,
  }),
  "voice_intake.parsed": z.object({
    intakeId: IdSchema,
    tenantId: IdSchema,
    missingFields: z.array(z.string()),
  }),
  "property.ready": z.object({
    propertyId: IdSchema,
    tenantId: IdSchema,
    readinessScore: z.number().int(),
  }),
  "property.updated": z.object({
    propertyId: IdSchema,
    tenantId: IdSchema,
    changedFields: z.array(z.string()),
  }),
  /** נכס יצא משיווק (נמכר/הושכר/הוקפא) — סגירת מעגל מול קונים מעוניינים */
  "property.delisted": z.object({
    propertyId: IdSchema,
    tenantId: IdSchema,
    newStatus: z.string(),
  }),
  "buyer.updated": z.object({
    buyerId: IdSchema,
    tenantId: IdSchema,
    changedFields: z.array(z.string()),
  }),
  /**
   * סבב חישוב התאמות הסתיים.
   *
   * שלושת המונים אינם כפילות: `matchCount` הוא כמה התאמות תקפות יש
   * עכשיו, `newMatchCount` הוא כמה מתוכן **נולדו בסבב הזה**, ו-
   * `strongMatchCount` כמה מהחדשות עברו את סף "מומלץ". ההתראה נשענת
   * על החדשות בלבד — בלי זה כל עריכה קטנה בנכס הייתה מודיעה שוב על
   * אותם קונים, וההתראה שמגיעה כשלא קרה כלום היא התראה שמפסיקים
   * להסתכל עליה.
   *
   * `ownerUserId` — הסוכן שהכרטיס שלו. קיים בצד הקונה; נכס שייך
   * למשרד כולו ולכן שם הוא חסר, וההתראה משרדית.
   */
  "matches.computed": z.object({
    tenantId: IdSchema,
    propertyId: IdSchema.optional(),
    buyerId: IdSchema.optional(),
    matchCount: z.number().int(),
    /** ברירת מחדל 0 — אירועים שנכתבו לפני השדה לא מייצרים התראה */
    newMatchCount: z.number().int().default(0),
    strongMatchCount: z.number().int().default(0),
    ownerUserId: IdSchema.optional(),
    /**
     * מה הזיז את החישוב — כשזו הייתה **פעולה של הסוכן שפתחה דלת**.
     *
     * "נמצאו 3 קונים חדשים" ו"הורדת המחיר פתחה 3 קונים שהיו מחוץ
     * לתקציב" הן שתי הודעות שונות לגמרי: הראשונה היא עדכון, השנייה
     * היא תוצאה של החלטה שהסוכן קיבל לפני דקה — והוא עדיין באותו
     * הקשר, כלומר זה הרגע היחיד שבו הוא באמת יפעל.
     *
     * חסר = חישוב שגרתי (כרטיס חדש, עריכה שאינה מסחרית), וההודעה
     * נשארת הרגילה.
     */
    trigger: z
      .object({
        kind: z.enum(["price_drop", "budget_raise"]),
        /** באגורות, לפני ואחרי — ההודעה אומרת את המספר ולא רק "השתנה" */
        fromAgorot: z.number().int(),
        toAgorot: z.number().int(),
      })
      .optional(),
  }),
  "offer.sent": z.object({ offerId: IdSchema, tenantId: IdSchema }),
  "offer.opened": z.object({ offerId: IdSchema, tenantId: IdSchema, openCount: z.number().int() }),
  "offer.interested": z.object({ offerId: IdSchema, tenantId: IdSchema }),
  "appointment.scheduled": z.object({
    appointmentId: IdSchema,
    tenantId: IdSchema,
    startsAt: z.coerce.date(),
    /** לסיורים: מאפשר לתזמן פולו-אפ "איך היה?" אחרי סיום הפגישה */
    kind: z.string().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  }),
  "coop_offer.sent": z.object({
    coopOfferId: IdSchema,
    /** הסוכנות המקבלת — אליה מנותבת ההתראה */
    tenantId: IdSchema,
    fromTenantId: IdSchema,
  }),
  /** הפניה שפורסמה נקלטה במשרד אחר — ההתראה מנותבת למשרד המפנה. */
  "shared_lead.sold": z.object({
    sharedLeadId: IdSchema,
    /** המשרד המפנה — אליו מנותבת ההתראה והזיכוי */
    tenantId: IdSchema,
    /** מה שהמשרד הקולט שילם */
    priceCredits: z.number().int().positive(),
    /**
     * הזיכוי בפועל בקרדיטים, כפי שצולם ברגע הפרסום. 0 במסלול הכסף.
     *
     * אופציונלי בכוונה: אירועים שכבר ממתינים ב-outbox מלפני העמלה
     * אינם נושאים אותו, ואימות נוקשה היה מפיל אותם בעיבוד. וגם
     * `nonnegative` ולא `positive` — 0 הוא ערך חוקי כאן, וזה בדיוק
     * מה שאירוע של מסלול הכסף נושא.
     */
    payoutCredits: z.number().int().nonnegative().optional(),
    /** התמורה באגורות במסלול הכסף. חסר או 0 במסלול הקרדיטים. */
    payoutAgorot: z.number().int().nonnegative().optional(),
  }),
  /** אובייקט אחסון שמחיקתו נכשלה — ניסיון חוזר עמיד דרך תור low. */
  "storage.cleanup_object": z.object({
    tenantId: IdSchema,
    s3Key: z.string().max(512),
  }),
  /** משימה עם מועד יעד — תזכורת מתוזמנת דרך צינור ההתראות, לנמען בלבד. */
  "task.created": z.object({
    taskId: IdSchema,
    tenantId: IdSchema,
    assignedToUserId: IdSchema,
    title: z.string().max(200),
    dueAt: z.coerce.date(),
  }),
} as const;

export type DomainEventName = keyof typeof DomainEvents;

export type DomainEventPayload<E extends DomainEventName> = z.infer<(typeof DomainEvents)[E]>;

export interface DomainEventEnvelope<E extends DomainEventName = DomainEventName> {
  id: string;
  name: E;
  tenantId: string;
  payload: DomainEventPayload<E>;
  occurredAt: string;
}
