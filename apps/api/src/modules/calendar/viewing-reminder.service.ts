import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import {
  DEFAULT_VIEWING_REMINDER_MESSAGES,
  jerusalemWallParts,
  viewingReminderWhenLabel,
  renderViewingReminder,
  resolveAutomationSettings,
  viewingReminderDue,
  viewingReminderOccupantContactId,
  viewingReminderSkipReason,
  viewingReminderUses,
  whatsappTemplateParams,
  viewingReminderQuickReplies,
  type ViewingReminderAudience,
  type ViewingReminderChannel,
  type ViewingReminderVars,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";

/**
 * תזכורת לפני סיור — לזה שגר בנכס, ולקונה שבא לראות אותו.
 *
 * ## למה סבב ולא משימה מתוזמנת ביצירה
 *
 * עבודה שנקבעת בזמן שהסיור נוצר קופאת על הנתונים של אותו רגע: את
 * הסיור דוחים, מבטלים, והמשרד משנה את „כמה שעות לפני”. משימה
 * שנקבעה לחמש שעות לפני המועד **הישן** תרוץ במועד הלא נכון, ואם
 * ההגדרה השתנתה — היא כבר לא מייצגת דבר. סבב ששואל כל רבע שעה „מי
 * מתחיל בקרוב וטרם קיבל” קורא תמיד את המצב הנוכחי.
 *
 * ## למה זה כאן ולא ב-Worker
 *
 * זה שולח ל**לקוחות**, ולכן הוא צריך את `EmailService`, את שליחת
 * הוואטסאפ ואת פענוח אנשי הקשר — כולם כאן. זה בדיוק הדפוס של
 * ‎`OfferEmailService`, שגם היא סבב ששולח החוצה.
 *
 * ## מה קורה כשאי אפשר לשלוח
 *
 * ‎**נפתחת משימה לסוכן, ולא שקט.** סיור שהמוכר לא יודע עליו הוא
 * נסיעה לשווא לכל הצדדים, ולקוח בלי מייל ובלי טלפון אינו סיבה
 * שאיש לא יידע על כך. אותו כלל גם על מי שביקש להסיר את עצמו:
 * מכבדים את הבקשה ומודיעים לסוכן שיתקשר.
 */

/** כל רבע שעה — התזכורת נמדדת בשעות, ורבע שעה היא דיוק מספיק. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** דקה אחרי העלייה, כדי לא להתחרות על החיבורים בזמן המיגרציות. */
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

/** תקרת סיורים לסבב, על פני כל המשרדים — הגנה על משך הסבב. */
const MAX_PER_SWEEP = 200;

interface Recipient {
  audience: ViewingReminderAudience;
  contactId: string;
  name: string;
  phone: string;
  email: string | undefined;
  optedOut: boolean;
}

@Injectable()
export class ViewingReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ViewingReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppSendService,
    private readonly contacts: ContactsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.first.unref?.();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<{ sent: number; tasks: number }> {
    if (this.running) return { sent: 0, tasks: 0 };
    this.running = true;
    try {
      return await this.sweep();
    } catch (error: unknown) {
      /*
       * ‎`finally` לבדו אינו מספיק: דחייה לא-מטופלת של `void tick()`
       * מפילה את התהליך כולו, וסבב רקע אינו אמור להיות מסוגל לזה.
       */
      this.logger.error(`סבב תזכורות הסיור נכשל: ${String(error)}`);
      return { sent: 0, tasks: 0 };
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<{ sent: number; tasks: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true, name: true, settings: true },
    });

    let sent = 0;
    let tasks = 0;
    let budget = MAX_PER_SWEEP;

    for (const tenant of tenants) {
      if (budget <= 0) break;
      const raw = (tenant.settings ?? {}) as Record<string, unknown>;
      const setting = resolveAutomationSettings(raw["automations"])["viewing_reminder"];
      if (!setting.enabled) continue;

      try {
        const result = await TenantContext.run(
          // בלי משתמש ובלי יכולות — הסבב מבצע מדיניות משרד, לא פעולת סוכן
          { tenantId: tenant.id, userId: "", capabilities: new Set(), billingOnly: false },
          () =>
            this.sweepTenant(tenant.id, tenant.name, {
              hoursBefore: setting.value ?? 5,
              channel: setting.channel ?? "both",
              messages: setting.messages ?? {},
              budget,
            }),
        );
        sent += result.sent;
        tasks += result.tasks;
        budget -= result.scanned;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`תזכורות סיור נכשלו למשרד ${tenant.id}: ${String(error)}`);
      }
    }

    if (sent > 0 || tasks > 0) {
      this.logger.log(`תזכורות סיור: ${sent} נשלחו, ${tasks} משימות נפתחו`);
    }
    return { sent, tasks };
  }

  private async sweepTenant(
    tenantId: string,
    officeName: string,
    config: {
      hoursBefore: number;
      channel: ViewingReminderChannel;
      messages: Record<string, string>;
      budget: number;
    },
  ): Promise<{ sent: number; tasks: number; scanned: number }> {
    const now = new Date();
    const horizon = new Date(now.getTime() + config.hoursBefore * 60 * 60 * 1000);

    const due = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.appointment.findMany({
        where: {
          tenantId,
          kind: "viewing",
          status: "scheduled",
          reminderSentAt: null,
          startsAt: { gt: now, lte: horizon },
        },
        orderBy: { startsAt: "asc" },
        take: config.budget,
        select: {
          id: true,
          title: true,
          startsAt: true,
          status: true,
          kind: true,
          buyerId: true,
          propertyId: true,
          createdBy: true,
          ownerUserId: true,
        },
      }),
    );

    let sent = 0;
    let tasks = 0;
    for (const appointment of due) {
      try {
        const result = await this.remindOne(tenantId, officeName, appointment, config);
        sent += result.sent;
        tasks += result.tasks;
      } catch (error: unknown) {
        // סיור אחד שנכשל אינו עוצר את השאר; החותמת לא נכתבה, והסבב הבא ינסה שוב
        this.logger.warn(`תזכורת לסיור ${appointment.id} נכשלה: ${String(error)}`);
      }
    }
    return { sent, tasks, scanned: due.length };
  }

  /**
   * תזכורת אחת — שני הנמענים, ואז חותמת.
   *
   * ‎**החותמת נכתבת בסוף ותמיד**, גם כשאיש לא קיבל: מי שלא קיבל
   * קיבל משימה לסוכן, וניסיון חוזר על אותו סיור היה מכפיל הודעה
   * ללקוח שכן קיבל. הכיוון היקר יותר הוא הכפילות, לא ההחמצה —
   * המשימה כבר מבטיחה שאיש לא נשכח.
   */
  private async remindOne(
    tenantId: string,
    officeName: string,
    appointment: {
      id: string;
      title: string | null;
      startsAt: Date;
      status: string;
      kind: string;
      buyerId: string | null;
      propertyId: string | null;
      createdBy: string | null;
      ownerUserId: string | null;
    },
    config: {
      hoursBefore: number;
      channel: ViewingReminderChannel;
      messages: Record<string, string>;
    },
  ): Promise<{ sent: number; tasks: number }> {
    // הכרעה משותפת עם המסך — ראו `viewingReminderSkipReason`
    if (viewingReminderSkipReason(appointment) !== null) return { sent: 0, tasks: 0 };
    if (!viewingReminderDue(appointment.startsAt, config.hoursBefore, new Date())) {
      return { sent: 0, tasks: 0 };
    }

    const { address, recipients } = await this.audience(tenantId, appointment);
    if (recipients.length === 0) return { sent: 0, tasks: 0 };

    const agentName = await this.agentName(tenantId, appointment);
    /*
     * שעון ישראל, ולא שעון השרת: התזכורת אומרת „היום בשעה X”, וזו
     * חייבת להיות השעה שהלקוח יראה בשעון שלו. ‎`jerusalemWallParts`
     * הוא אותו מקור שהמסכים קוראים ממנו.
     */
    const now = new Date();
    const wall = jerusalemWallParts(appointment.startsAt);
    const timePart = wall.time;
    // 2026-08-27 ⟵ 27/08 — כפי שכותבים תאריך בעברית
    const [, month = "", day = ""] = wall.date.split("-");
    const datePart = `${day}/${month}`;
    const when = `${datePart} ${timePart}`;
    /*
     * ‎„היום” / „מחר” / התאריך — ולא „היום” קבוע. החלון מגיע עד 48
     * שעות, וגם חמש שעות חוצות חצות: סיור ב-01:00 מקבל תזכורת
     * ב-20:00 של אתמול (ביקורת Codex).
     */
    const whenLabel = viewingReminderWhenLabel(
      wall,
      jerusalemWallParts(now),
      jerusalemWallParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    );

    let sent = 0;
    const unreachable: Recipient[] = [];

    for (const recipient of recipients) {
      const vars: ViewingReminderVars = {
        שם: recipient.name,
        מתי: whenLabel,
        שעה: timePart,
        תאריך: datePart,
        כתובת: address,
        סוכן: agentName,
        משרד: officeName,
      };
      const template =
        config.messages[recipient.audience] ??
        DEFAULT_VIEWING_REMINDER_MESSAGES[recipient.audience];
      const body = renderViewingReminder(template, vars);

      const delivered = await this.deliver(
        tenantId,
        recipient,
        body,
        config.channel,
        whenLabel,
        appointment.id,
        vars,
      );
      if (delivered) sent += 1;
      else unreachable.push(recipient);
    }

    let tasks = 0;
    if (unreachable.length > 0) {
      tasks = (await this.openTask(tenantId, appointment, unreachable, address, when)) ? 1 : 0;
    }

    /*
     * ‎**החותמת נכתבת רק אם הפגישה לא זזה בינתיים.**
     *
     * המסירה היא קריאת רשת, ובזמנה מתווך יכול לדחות את הסיור —
     * ‎`reschedule` מנקה את החותמת למועד החדש, ואז כתיבה שמתאימה
     * למזהה בלבד הייתה מסמנת דווקא את המועד החדש כ„כבר נשלח”, כלומר
     * מבטלת את התזכורת האמיתית (ביקורת Codex).
     *
     * ‎`startsAt` ו-`status` בתנאי הם „זו עדיין אותה פגישה שקראתי”.
     * אם היא זזה — החותמת אינה נכתבת, והסבב הבא ישלח למועד החדש.
     */
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.appointment.updateMany({
        where: {
          id: appointment.id,
          tenantId,
          reminderSentAt: null,
          startsAt: appointment.startsAt,
          status: "scheduled",
        },
        data: { reminderSentAt: new Date() },
      }),
    );
    return { sent, tasks };
  }

  /** שני הנמענים וכתובת הנכס — כל מה שההודעה צריכה. */
  private async audience(
    tenantId: string,
    appointment: { buyerId: string | null; propertyId: string | null },
  ): Promise<{ address: string; recipients: Recipient[] }> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const wanted: { audience: ViewingReminderAudience; contactId: string }[] = [];
      let address = "הנכס";

      if (appointment.propertyId !== null) {
        const property = await tx.property.findFirst({
          where: { id: appointment.propertyId, tenantId },
          select: {
            street: true,
            houseNumber: true,
            city: true,
            occupancy: true,
            occupantContactId: true,
            ownerContactId: true,
          },
        });
        if (property !== null) {
          /*
           * רחוב ומספר, ואז עיר — אותה הרכבה כמו במסכים. נכס בלי
           * כתובת מלאה עדיין מקבל תזכורת: „הנכס” במשפט עדיף על
           * תזכורת שלא נשלחה בגלל שדה חסר.
           */
          const street = [property.street, property.houseNumber]
            .filter((part) => part !== null && part !== "")
            .join(" ");
          address =
            [street, property.city].filter((part) => part !== "" && part !== null).join(", ") ||
            "הנכס";
          const contactId = viewingReminderOccupantContactId(property);
          if (contactId !== null) wanted.push({ audience: "occupant", contactId });
        }
      }

      if (appointment.buyerId !== null) {
        const buyer = await tx.buyer.findFirst({
          where: { id: appointment.buyerId, tenantId },
          select: { contactId: true },
        });
        if (buyer !== null) wanted.push({ audience: "buyer", contactId: buyer.contactId });
      }

      /*
       * ‎**אותו אדם פעמיים מקבל הודעה אחת.** בעלים שקנה דרך המשרד
       * ומוכר דרכו יכול להיות גם „מי שגר בנכס” וגם הקונה בסיור
       * אחר; שתי הודעות על אותו סיור נראות כתקלה.
       */
      const seen = new Set<string>();
      const unique = wanted.filter((w) => {
        if (seen.has(w.contactId)) return false;
        seen.add(w.contactId);
        return true;
      });
      if (unique.length === 0) return { address, recipients: [] };

      const rows = await tx.contact.findMany({
        where: { id: { in: unique.map((w) => w.contactId) }, tenantId },
        select: { id: true, optedOutAt: true },
      });
      const optedOut = new Map(rows.map((row) => [row.id, row.optedOutAt !== null]));
      const details = await this.contacts.getByIds(
        tx,
        unique.map((w) => w.contactId),
      );

      const recipients: Recipient[] = [];
      for (const want of unique) {
        const contact = details.get(want.contactId);
        if (contact === undefined) continue;
        recipients.push({
          audience: want.audience,
          contactId: want.contactId,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          optedOut: optedOut.get(want.contactId) ?? false,
        });
      }
      return { address, recipients };
    });
  }

  /**
   * המסירה בפועל — `true` כשהגיעה בערוץ כלשהו.
   *
   * ‎**מי שביקש להסיר את עצמו אינו מקבל, ואינו נחשב „נשלח”.** הוא
   * נופל לרשימת מי שצריך שיחה מהסוכן: הבקשה מכובדת, והסיור עדיין
   * צריך שמישהו יידע עליו.
   */
  private async deliver(
    tenantId: string,
    recipient: Recipient,
    body: string,
    channel: ViewingReminderChannel,
    whenLabel: string,
    /**
     * ‎**על איזה סיור התזכורת.** נכנס למטען של כפתורי התשובה, וזה
     * מה שמאפשר לדעת מאוחר יותר על מה נלחץ: הלחיצה חוזרת בלי הקשר
     * אחר, ולקוח עם שני סיורים באותו יום אינו ניתן להבחנה בלעדיו.
     */
    appointmentId: string,
    /**
     * השדות עצמם, לתבנית הוואטסאפ.
     *
     * ‎`body` הוא הנוסח שהמשרד ניסח, והוא מה שיוצא **במייל**.
     * בוואטסאפ יוצאים השדות: תבנית שגופה משתנה יחיד אינה קריאה
     * ל-Meta, והיא מסווגת מה שאינה מבינה כ-Marketing — כלומר
     * תזכורת לפגישה, השירותית שבהודעות, נחסמת כדיוור.
     */
    vars: ViewingReminderVars,
  ): Promise<boolean> {
    if (recipient.optedOut) return false;

    let delivered = false;

    if (viewingReminderUses(channel, "whatsapp") && recipient.phone !== "") {
      /*
       * ‎**תבנית מאושרת, ולא טקסט חופשי.** הלקוח לא כתב לנו, ולכן
       * הוא מחוץ לחלון 24 השעות של Meta — שם טקסט חופשי נדחה. בלי
       * תבנית מוגדרת אין שליחה בוואטסאפ, וזה נופל למשימה לסוכן
       * בדיוק כמו ב„שיחה שלא נענתה”.
       */
      const template = await this.settings.get("whatsappViewingReminderTemplate");
      const lang = (await this.settings.get("whatsappViewingReminderTemplateLang")) ?? "he";
      /*
       * ‎**איזו תבנית נרשמה בפועל — הגדרה, לא הנחה.**
       *
       * מאחורי השם השמור עומדת תבנית שאושרה ב-Meta עם חוזה מסוים.
       * מעבר שקט לשדות היה שולח חמישה שמות לתבנית שיש בה אחד, Meta
       * הייתה דוחה, ובערוץ „שניהם” המייל מצליח ולכן `deliver` מחזיר
       * ‎`true` ולא נפתחת משימה — כלומר התזכורת בוואטסאפ נעלמת בלי
       * שאיש יידע (ביקורת Codex, P1). ברירת המחדל היא הנוסח האחד.
       */
      const fields =
        (await this.settings.get("whatsappViewingReminderTemplateFields")) === "true";
      /*
       * ‎**כפתורי התשובה נשלחים רק לתבנית שנרשמה איתם.** תבנית בלי
       * כפתורים שמקבלת רכיבי כפתור נדחית — ואז אין תזכורת בכלל,
       * לא רק „בלי כפתורים”. אותה משמעת כמו בשאר כפתורי התבניות.
       */
      const withButtons =
        (await this.settings.get("whatsappViewingReminderTemplateButtons")) === "true";
      if (template !== undefined && template !== "") {
        const ok = await this.whatsapp.sendTemplate(
          recipient.phone,
          template,
          lang,
          fields
            ? whatsappTemplateParams("viewingReminderFields", [
                vars["שם"],
                vars["תאריך"],
                vars["שעה"],
                vars["כתובת"],
                vars["משרד"],
              ])
            : whatsappTemplateParams("viewingReminder", [body]),
          /*
           * ‎**התזכורת אינה נושאת כפתור כתובת, בכוונה** — הנמען הוא
           * לקוח או דייר בלי חשבון, ו„פתח במערכת” היה שולח אותו
           * למסך התחברות שאינו שלו. כפתורי התשובה המהירה הם ההפך:
           * הם עונים בלי לצאת מוואטסאפ ובלי חשבון.
           */
          undefined,
          withButtons ? viewingReminderQuickReplies(appointmentId) : undefined,
        );
        if (ok) delivered = true;
      }
    }

    if (viewingReminderUses(channel, "email") && recipient.email !== undefined) {
      try {
        await this.email.send(
          recipient.email,
          // אותה תווית שבגוף ההודעה — נושא שאומר „היום” על מחר גרוע מכולם
          `תזכורת לסיור ${whenLabel}`,
          { heading: "תזכורת לסיור", paragraphs: body.split("\n").filter(Boolean) },
          { tenantId },
        );
        delivered = true;
      } catch (error: unknown) {
        this.logger.warn(`תזכורת במייל נכשלה ל-${recipient.contactId}: ${String(error)}`);
      }
    }

    return delivered;
  }

  /**
   * משימה לסוכן על מי שלא קיבל.
   *
   * ‎`false` כשאין למי להצמיד אותה: משימה דורשת בעלים, ופגישה בלי
   * סוכן מזוהה הייתה נוחתת אצל מישהו שרירותי — אותו שיקול בדיוק
   * שבשיחה שלא נענתה.
   */
  private async openTask(
    tenantId: string,
    appointment: { id: string; startsAt: Date; buyerId: string | null; propertyId: string | null; createdBy: string | null; ownerUserId: string | null },
    unreachable: readonly Recipient[],
    address: string,
    when: string,
  ): Promise<boolean> {
    const assignee = appointment.ownerUserId ?? appointment.createdBy;
    if (assignee === null) return false;

    const who = unreachable
      .map((r) => `${r.name}${r.optedOut ? " (ביקש/ה לא לקבל הודעות)" : ""}`)
      .join(", ");

    const entity =
      appointment.buyerId !== null
        ? { type: "buyer", id: appointment.buyerId }
        : appointment.propertyId !== null
          ? { type: "property", id: appointment.propertyId }
          : null;

    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const sourceKey = `viewing-reminder:${appointment.id}`;
      // אידמפוטנטי כמו שאר האוטומציות — סבב חוזר לא יפתח משימה שנייה
      const existing = await tx.task.findFirst({
        where: { tenantId, sourceKey },
        select: { id: true },
      });
      if (existing !== null) return false;

      await tx.task.create({
        data: {
          id: ulid(),
          tenantId,
          assignedToUserId: assignee,
          title: "תזכורת לסיור לא נשלחה — צריך טלפון",
          notes: `הסיור ב${address} מתחיל ב-${when}, ולא הצלחנו לשלוח תזכורת ל: ${who}. כדאי להתקשר ולוודא שהם יודעים.`,
          dueAt: appointment.startsAt,
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
          sourceKey,
        },
      });
      return true;
    });
  }

  /** שם הסוכן לשתילה בנוסח; ריק כשאין — המשפט עדיין עומד. */
  private async agentName(
    tenantId: string,
    appointment: { ownerUserId: string | null; createdBy: string | null },
  ): Promise<string> {
    const userId = appointment.ownerUserId ?? appointment.createdBy;
    if (userId === null) return "";
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { name: true },
    });
    return user?.name ?? "";
  }
}
