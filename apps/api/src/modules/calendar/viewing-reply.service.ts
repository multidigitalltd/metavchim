import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  parseViewingReminderReply,
  viewingReminderOccupantContactId,
  type ViewingReminderReply,
} from "@metavchim/shared";
import { ContactsService } from "../contacts/contacts.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**מה שהלקוח ענה בלחיצה על תזכורת הסיור.**
 *
 * ## למה זה קיים
 *
 * ‏עד כה התזכורת הייתה חד-סטרית: יצאה, ואיש לא ידע אם נקראה. מתווך
 * שרצה לדעת אם הלקוח מגיע היה מתקשר — או לא מתקשר, ומגלה בשטח.
 *
 * שני כפתורים בתבנית פותרים את זה בלי שהלקוח יצא מוואטסאפ ובלי
 * חשבון במערכת, וזה בדיוק הנמען כאן: לקוח או דייר שאין לו כניסה.
 *
 * ## מה נבדק לפני שנרשם משהו
 *
 * המטען נושא מזהה סיור, והוא מגיע מבחוץ. `record` אינו סומך עליו:
 * הוא מוודא שהסיור שייך לדייר, **ושהמספר ששלח הוא באמת אחד
 * מנמעני התזכורת של אותו סיור**. בלי הבדיקה הזו, מי שמחזיק מטען
 * של סיור אחד יכול היה לסמן „אישרתי” על סיור של מישהו אחר.
 */
@Injectable()
export class ViewingReplyService {
  private readonly logger = new Logger(ViewingReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
  ) {}

  async record(payload: string, fromPhone: string): Promise<void> {
    const parsed = parseViewingReminderReply(payload);
    // מטען שאינו שלנו — כפתור של תבנית אחרת, או זבל. אין מה לרשום.
    if (parsed === null) return;
    const tenantId = parsed.tenantId;

    try {
      await this.prisma.withExplicitTenant(tenantId, async (tx) => {
        const appointment = await tx.appointment.findFirst({
          where: { id: parsed.appointmentId, tenantId },
          select: {
            id: true,
            startsAt: true,
            buyerId: true,
            propertyId: true,
            ownerUserId: true,
            createdBy: true,
            reminderReply: true,
          },
        });
        if (appointment === null) return;

        /*
         * ‎**הלחיצה שייכת למועד שעליו נשאלה** (ביקורת Codex, P1).
         *
         * ‏ההודעה נשארת בצ'אט של הלקוח לנצח והכפתורים שבה חיים.
         * לקוח שגלל לתזכורת ישנה אחרי שהסיור נדחה, ולחץ „קיבלתי” —
         * היה מסמן אישור על מועד שמעולם לא ראה. ניקוי `reminderReply`
         * בדחייה אינו מבטל כפתור שכבר יצא; רק ההשוואה הזו עושה זאת.
         */
        if (appointment.startsAt.getTime() !== parsed.startsAtMs) return;

        /*
         * ‎**רק מי שקיבל את התזכורת יכול לענות עליה.**
         *
         * אותה שרשרת בדיוק שבה נבנים הנמענים: הקונה של הסיור,
         * והדייר שיושב בנכס.
         */
        const sender = await this.contacts.findByAnyPhone(tx, fromPhone);
        if (sender === null) return;

        const allowed = new Set<string>();
        if (appointment.buyerId !== null) {
          const buyer = await tx.buyer.findFirst({
            where: { id: appointment.buyerId, tenantId },
            select: { contactId: true },
          });
          if (buyer !== null) allowed.add(buyer.contactId);
        }
        if (appointment.propertyId !== null) {
          const property = await tx.property.findFirst({
            where: { id: appointment.propertyId, tenantId },
            /*
             * ‎**גם `ownerContactId`, ולא רק הדייר.**
             *
             * ‎`viewingReminderOccupantContactId` מחזיר את הדייר רק
             * בנכס מושכר, ובכל שאר המקרים **נופל לבעלים** — וכל
             * שלושת השדות שלו אופציונליים, ולכן `select` חלקי עובר
             * הידור בשקט ומחזיר `null`. בלי השדה הזה בעל נכס שלוחץ
             * על הכפתור נדחה כ„אינו נמען”, התשובה נזרקת, ואיש לא
             * יודע — בדיוק הכשל שהתכונה הזו באה למנוע.
             */
            select: { occupantContactId: true, occupancy: true, ownerContactId: true },
          });
          const occupant =
            property === null ? null : viewingReminderOccupantContactId(property);
          if (occupant !== null) allowed.add(occupant);
        }
        if (!allowed.has(sender.id)) {
          // בלי מספר ובלי מזהה איש קשר ביומן — זה PII
          this.logger.warn(`תשובה לתזכורת ממספר שאינו נמען של הסיור ${appointment.id}`);
          return;
        }

        /*
         * ‎**העדכון עצמו הוא המנעול** (ביקורת Codex, P2).
         *
         * ‏קריאה ואז כתיבה אינן אטומיות: וובהוק שנשלח שוב במקביל,
         * או לחיצה כפולה מהירה, היו נקראים שניהם לפני שאחד מהם
         * כתב — ושתי ההתראות היו יוצאות. `updateMany` עם התנאי
         * בתוכו מסתמך על נעילת השורה: השני ממתין, ואז בודק שוב את
         * התנאי מול הערך שכבר נכתב, ומחזיר `count: 0`.
         *
         * כל מה שאחרי זה תלוי ב-`count === 1`, ולכן רץ פעם אחת.
         */
        const claimed = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            tenantId,
            // ‎`startsAt` בתנאי גם כאן: הסיור יכול לזוז בין הקריאה לכתיבה
            startsAt: appointment.startsAt,
            OR: [{ reminderReply: null }, { reminderReply: { not: parsed.reply } }],
          },
          data: { reminderReply: parsed.reply, reminderReplyAt: new Date() },
        });
        if (claimed.count !== 1) return;

        const assignee = appointment.ownerUserId ?? appointment.createdBy;
        const entity =
          appointment.buyerId !== null
            ? { type: "buyer", id: appointment.buyerId }
            : appointment.propertyId !== null
              ? { type: "property", id: appointment.propertyId }
              : null;

        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            // ‎`null` = כל המשרד. סיור בלי בעלים אינו סיור של איש
            userId: assignee,
            type: "viewing_reminder_reply",
            title: TITLES[parsed.reply],
            body: BODIES[parsed.reply],
            entityType: entity?.type ?? null,
            entityId: entity?.id ?? null,
          },
        });

        /*
         * ‎**„צריך לשנות מועד” היא בקשה שמישהו חייב לטפל בה.**
         *
         * התראה נקראת ונעלמת; המועד נשאר ביומן והלקוח לא יגיע.
         * „אישרתי” לעומת זאת אינו דורש פעולה — התראה מספיקה, ומשימה
         * עליו הייתה רעש שמלמד להתעלם מהרשימה.
         */
        if (parsed.reply === "reschedule" && assignee !== null) {
          /*
           * ‎**המפתח נושא גם את המועד** (ביקורת Codex, P2).
           *
           * ‏מפתח לכל הסיור היה חד-פעמי לתמיד: אחרי שהבקשה הראשונה
           * טופלה, המשימה הושלמה והסיור נדחה — בקשה שנייה מהתזכורת
           * החדשה הייתה מוצאת את המשימה **המושלמת** ולא פותחת דבר.
           * ‏הלקוח ביקש, ואיש לא ידע. מועד חדש = מפתח חדש = משימה.
           */
          const sourceKey = `viewing-reschedule:${appointment.id}:${parsed.startsAtMs}`;
          const existing = await tx.task.findFirst({
            where: { tenantId, sourceKey },
            select: { id: true },
          });
          if (existing === null) {
            await tx.task.create({
              data: {
                id: ulid(),
                tenantId,
                assignedToUserId: assignee,
                title: "הלקוח ביקש לשנות את מועד הסיור",
                notes:
                  "הלקוח לחץ „צריך לשנות מועד” בתזכורת שנשלחה בוואטסאפ. המועד ביומן לא השתנה — צריך לתאם מולו מועד חדש ולעדכן.",
                dueAt: appointment.startsAt,
                entityType: entity?.type ?? null,
                entityId: entity?.id ?? null,
                sourceKey,
              },
            });
          }
        }
      });
    } catch (error) {
      /*
       * ‎**לא זורק.** הקורא הוא הוובהוק של Meta, ושגיאה שעולה משם
       * מחזירה שאינו-200 — ואז Meta שולחת את ההודעה שוב, בלולאה.
       */
      this.logger.error(`רישום תשובה לתזכורת נכשל: ${String(error)}`);
    }
  }
}

const TITLES: Record<ViewingReminderReply, string> = {
  confirmed: "הלקוח אישר את הסיור",
  reschedule: "הלקוח מבקש לשנות את מועד הסיור",
};

const BODIES: Record<ViewingReminderReply, string> = {
  confirmed: "התקבל אישור הגעה בתשובה לתזכורת שנשלחה בוואטסאפ.",
  reschedule: "הלקוח ענה שהמועד אינו מתאים. נפתחה משימה לתיאום מועד חדש.",
};
