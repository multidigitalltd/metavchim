import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import { PrismaService } from "../../core/prisma.service";
import {
  GoogleCalendarService,
  type CalendarLink,
  type GoogleEvent,
} from "./google-calendar.service";

/**
 * הסבב שמושך שינויים מיומן Google פנימה ודוחף שינויים מקומיים החוצה.
 *
 * שני הכיוונים באותו סורק ובאותו סדר, ובכוונה: קודם מושכים ואז
 * דוחפים. פגישה שנוצרה כאן ופגישה שנוצרה ביומן באותה דקה נפגשות
 * בסבב אחד, ומי שנמשך פנימה כבר מסומן `syncSource: "google"` — ולכן
 * הדחיפה לא תחזיר אותו החוצה כאירוע חדש.
 *
 * הסורק יושב ב-API ולא ב-Workers מאותה סיבה כמו סורק החידושים: הוא
 * צריך את אישורי Google ואת מפתח ההצפנה, ושניהם כאן.
 */

/** כל רבע שעה. יומן אינו זמן אמת, ופגישה נקבעת ימים מראש. */
const TICK_MS = 15 * 60 * 1000;
/** כמה חיבורים לסנכרן בסבב. תקרה, לא יעד. */
const BATCH = 20;
/** עד כמה אחורה מסתכלים במשיכה מלאה. פגישות שעברו אינן מעניינות. */
const WINDOW_BACK_DAYS = 7;
/** כמה פגישות לדחוף בסבב לכל משתמש. */
const PUSH_BATCH = 50;

/** תוצאת סבב סנכרון — כולל מונים מאבחנים לתצוגה. */
export interface SyncResult {
  pulled: number;
  pushed: number;
  /** פגישות שלי שכבר יושבות ב-Google — "אין מה לדחוף" ולא "נשבר". */
  alreadySynced: number;
  /** פגישות של סוכנים אחרים בחלון — לא נכנסות ליומן האישי הזה. */
  notMine: number;
}

@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleCalendarService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncAll();
    } catch (error) {
      this.logger.error(`סבב סנכרון היומנים נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async syncAll(now = new Date()): Promise<{ pulled: number; pushed: number }> {
    if (!(await this.google.isConfigured())) return { pulled: 0, pushed: 0 };

    /*
     * הקריאה הזו חוצה-דיירים ולכן היא ישירות מ-prisma ולא דרך
     * `withTenant`: אין הקשר בקשה בסורק, ומסננים לפי כלום. כל עבודה
     * *על* שורה נעשית אחר כך בהקשר הדייר שלה.
     *
     * `google_calendar_links` תחת RLS, ולכן השאילתה הזו הייתה מחזירה
     * אפס שורות — היא מוגשת דרך `withExplicitTenant` על כל דייר שיש
     * לו חיבור, ורשימת הדיירים נשאבת מטבלה שאינה תחת RLS.
     */
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });

    let pulled = 0;
    let pushed = 0;
    let handled = 0;
    for (const tenant of tenants) {
      if (handled >= BATCH) break;
      const links = await this.prisma.withExplicitTenant(tenant.id, async (tx) =>
        tx.googleCalendarLink.findMany({ orderBy: { lastSyncAt: "asc" }, take: BATCH - handled }),
      );
      for (const link of links) {
        handled += 1;
        try {
          pulled += await this.pull(link, now);
          pushed += await this.push(link, now);
          pushed += await this.pushTasks(link, now);
          await this.markSynced(link, null, now);
        } catch (error) {
          const message = String(error).slice(0, 300);
          await this.markSynced(link, message, now);
          this.logger.warn(`סנכרון יומן של ${link.googleEmail} נכשל: ${message}`);
        }
      }
    }
    if (pulled > 0 || pushed > 0) {
      this.logger.log(`סנכרון יומנים: ${pulled} נמשכו, ${pushed} נדחפו`);
    }
    return { pulled, pushed };
  }

  /**
   * סנכרון של משתמש אחד, לפי בקשה.
   *
   * **לא** `syncAll` מכפתור במסך: זו הייתה נתינת אפשרות לכל סוכן
   * בכל משרד להריץ סבב על כל הפלטפורמה בלחיצה, כלומר עומס שמכפיל
   * את עצמו לפי מספר המשתמשים ושורף את מכסת ה-API של Google.
   */
  async syncOne(tenantId: string, userId: string, now = new Date()): Promise<SyncResult> {
    const empty: SyncResult = { pulled: 0, pushed: 0, alreadySynced: 0, notMine: 0 };
    if (!(await this.google.isConfigured())) return empty;
    const link = await this.google.linkFor(tenantId, userId);
    if (!link) return empty;
    try {
      const pulled = await this.pull(link, now);
      const pushed = await this.push(link, now);
      await this.markSynced(link, null, now);
      /*
       * מונים מאבחנים ולא רק "0 ו-0".
       *
       * מתווך שרואה פגישה ביומן שלו ומקבל "0 נדחפו" מסיק שהסנכרון
       * שבור — בעוד שברוב המקרים הפגישה כבר מסונכרנת, או שהיא של
       * סוכן אחר. שני המונים האלה הופכים את ההודעה לתשובה.
       */
      const pushedTasks = await this.pushTasks(link, now);
      const context = await this.pushContext(link, now);
      return { pulled, pushed: pushed + pushedTasks, ...context };
    } catch (error) {
      const message = String(error).slice(0, 300);
      await this.markSynced(link, message, now);
      throw error;
    }
  }

  /**
   * משימות עם מועד יעד → יומן Google.
   *
   * עד כה נדחפו פגישות בלבד, ומשימה עם מועד לא הופיעה ביומן — מתווך
   * שראה אותה במערכת ולא ב-Google הסיק שהסנכרון שבור. משימה נדחפת
   * כאירוע של חצי שעה: היא נקודת זמן ולא פגישה, וחסימה של שעה שלמה
   * ביומן על "לחזור לדוד" היא הצפה.
   *
   * רק משימות פתוחות: משימה שסומנה כבוצעה לפני שהסבב הגיע אליה
   * אינה צריכה להופיע ביומן בכלל.
   */
  private async pushTasks(link: CalendarLink, now: Date): Promise<number> {
    const pending = await this.prisma.withExplicitTenant(link.tenantId, async (tx) =>
      tx.task.findMany({
        where: {
          tenantId: link.tenantId,
          assignedToUserId: link.userId,
          status: "open",
          dueAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          googleSyncedAt: null,
        },
        orderBy: { dueAt: "asc" },
        take: PUSH_BATCH,
      }),
    );

    let count = 0;
    for (const task of pending) {
      if (!task.dueAt) continue;
      const googleEventId = await this.google.upsertEvent(link, {
        googleEventId: task.googleEventId,
        // הקידומת מבדילה ביומן בין משימה לפגישה במבט
        summary: `משימה: ${task.title}`,
        description: task.notes ?? undefined,
        startsAt: task.dueAt,
        endsAt: new Date(task.dueAt.getTime() + 30 * 60_000),
        cancelled: false,
      });
      await this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
        await tx.task.update({
          where: { id: task.id },
          data: { googleEventId, googleSyncedAt: new Date() },
        });
      });
      count += 1;
    }
    return count;
  }

  /**
   * איפוס סימוני הסנכרון — "דחוף הכול מחדש".
   *
   * פגישה שנדחפה פעם אחת ואז נמחקה ב-Google לא הייתה חוזרת לעולם:
   * googleSyncedAt נשאר מלא, ולכן היא כבר לא נחשבת ממתינה. בלי דרך
   * לאפס אותו, הפגישה נעלמת מהיומן בלי שום מסלול לתקן.
   *
   * מנוקה גם googleEventId: המזהה הישן מצביע על אירוע שנמחק, ושליחה
   * אליו הייתה מחזירה שגיאה במקום ליצור אירוע חדש.
   */
  async resetSyncMarks(tenantId: string, userId: string, now = new Date()): Promise<number> {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const [appointments, tasks] = await Promise.all([
        tx.appointment.updateMany({
          where: { tenantId, ownerUserId: userId, syncSource: "system", startsAt: { gte: from } },
          data: { googleSyncedAt: null, googleEventId: null },
        }),
        tx.task.updateMany({
          where: { tenantId, assignedToUserId: userId, status: "open", dueAt: { gte: from } },
          data: { googleSyncedAt: null, googleEventId: null },
        }),
      ]);
      return appointments.count + tasks.count;
    });
  }

  /**
   * מה מצב הדחיפה **אחרי** הסבב — כדי שההודעה תסביר את עצמה.
   *
   * ‎alreadySynced‎: פגישות שלי בחלון שכבר יושבות ב-Google.
   * ‎notMine‎: פגישות של סוכנים אחרים בחלון — הן לעולם לא ייכנסו
   *   ליומן שלי, וזה מכוון: יומן אישי ולא יומן משרדי.
   */
  private async pushContext(
    link: CalendarLink,
    now: Date,
  ): Promise<{ alreadySynced: number; notMine: number }> {
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
      const [alreadySynced, notMine] = await Promise.all([
        tx.appointment.count({
          where: {
            tenantId: link.tenantId,
            ownerUserId: link.userId,
            startsAt: { gte: from },
            googleSyncedAt: { not: null },
          },
        }),
        tx.appointment.count({
          where: {
            tenantId: link.tenantId,
            ownerUserId: { not: link.userId },
            syncSource: "system",
            startsAt: { gte: from },
          },
        }),
      ]);
      return { alreadySynced, notMine };
    });
  }

  /** ---------- Google → המערכת ---------- */

  private async pull(link: CalendarLink, now: Date): Promise<number> {
    const windowStart = new Date(now.getTime() - WINDOW_BACK_DAYS * 24 * 60 * 60 * 1000);
    const { events, nextSyncToken } = await this.google.changesSince(link, windowStart);

    let count = 0;
    await this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
      for (const event of events) {
        const times = eventTimes(event);
        /*
         * אירוע יום שלם או בלי שעות מדולג.
         *
         * "חופשה" ו"יום הולדת" הם רוב האירועים ביומן פרטי, והכנסתם
         * כפגישות הייתה מציפה את מסך היומן של המשרד בזבל שאיש לא
         * ביקש — וגם מדליפה פרטים אישיים לתוך מערכת של מקום העבודה.
         */
        if (!times) continue;

        const existing = await tx.appointment.findFirst({
          where: { tenantId: link.tenantId, googleEventId: event.id },
          select: { id: true, syncSource: true },
        });

        if (event.status === "cancelled") {
          if (existing) {
            await tx.appointment.update({
              where: { id: existing.id },
              data: { status: "cancelled", googleSyncedAt: now },
            });
            count += 1;
          }
          continue;
        }

        if (existing) {
          /*
           * פגישה שמקורה במערכת **אינה** נדרסת מ-Google.
           *
           * היא נושאת קישור לנכס, לקונה ולתוצאת הסיור — שדות שאין
           * להם מקבילה ביומן, ועדכון "מלא" מ-Google היה משטח אותם
           * לכותרת ולשעה. מה שמתעדכן הוא הזמן בלבד, וזה מה שהמתווך
           * באמת גורר ביומן.
           */
          await tx.appointment.update({
            where: { id: existing.id },
            data: {
              startsAt: times.startsAt,
              endsAt: times.endsAt,
              ...(existing.syncSource === "google"
                ? { title: (event.summary ?? "").slice(0, 200) || null, notes: (event.description ?? "").slice(0, 2000) || null }
                : {}),
              googleSyncedAt: now,
            },
          });
          count += 1;
          continue;
        }

        await tx.appointment.create({
          data: {
            id: ulid(),
            tenantId: link.tenantId,
            kind: "meeting",
            title: (event.summary ?? "פגישה מיומן Google").slice(0, 200),
            notes: (event.description ?? "").slice(0, 2000) || null,
            startsAt: times.startsAt,
            endsAt: times.endsAt,
            ownerUserId: link.userId,
            createdBy: link.userId,
            googleEventId: event.id,
            googleSyncedAt: now,
            syncSource: "google",
          },
        });
        count += 1;
      }

      await tx.googleCalendarLink.update({
        where: { userId: link.userId },
        data: { syncToken: nextSyncToken },
      });
    });
    return count;
  }

  /** ---------- המערכת → Google ---------- */

  private async push(link: CalendarLink, now: Date): Promise<number> {
    const pending = await this.prisma.withExplicitTenant(link.tenantId, async (tx) =>
      tx.appointment.findMany({
        where: {
          tenantId: link.tenantId,
          // רק מה שנקבע כאן. אירוע שנמשך מ-Google לא חוזר אליו.
          syncSource: "system",
          ownerUserId: link.userId,
          startsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          /*
           * `null` הוא "צריך דחיפה", והוא נכתב **גם בעדכון**
           * (ראו CalendarService.update). זה מכוון: השוואה בין
           * googleSyncedAt ל-updatedAt הייתה מדויקת יותר על הנייר
           * ושברירית בפועל — כל כתיבה שולית על השורה, כולל זו של
           * הדחיפה עצמה, מזיזה את updatedAt וייצרה דחיפה נצחית.
           */
          googleSyncedAt: null,
        },
        orderBy: { startsAt: "asc" },
        take: PUSH_BATCH,
      }),
    );

    let count = 0;
    for (const appointment of pending) {
      const endsAt = appointment.endsAt ?? new Date(appointment.startsAt.getTime() + 60 * 60_000);
      const googleEventId = await this.google.upsertEvent(link, {
        googleEventId: appointment.googleEventId,
        summary: appointment.title ?? "פגישה — מתווכים",
        description: appointment.notes ?? undefined,
        startsAt: appointment.startsAt,
        endsAt,
        cancelled: appointment.status === "cancelled",
      });
      await this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { googleEventId, googleSyncedAt: new Date() },
        });
      });
      count += 1;
    }
    return count;
  }

  private async markSynced(link: CalendarLink, error: string | null, now: Date): Promise<void> {
    await this.prisma.withExplicitTenant(link.tenantId, async (tx) => {
      await tx.googleCalendarLink.update({
        where: { userId: link.userId },
        data: { lastSyncAt: now, lastError: error },
      });
    });
  }
}

/**
 * שעות האירוע, או `null` כשאין כאלה.
 *
 * `date` בלי `dateTime` הוא אירוע יום שלם — חופשה, יום הולדת, חג.
 * אלה רוב האירועים ביומן פרטי, ומשיכתם כפגישות הייתה מציפה את
 * המערכת ומדליפה פרטים אישיים לתוך מקום העבודה.
 */
function eventTimes(event: GoogleEvent): { startsAt: Date; endsAt: Date } | null {
  const start = event.start?.dateTime;
  if (!start) return null;
  const startsAt = new Date(start);
  if (Number.isNaN(startsAt.getTime())) return null;
  const endRaw = event.end?.dateTime;
  const endsAt = endRaw ? new Date(endRaw) : new Date(startsAt.getTime() + 60 * 60_000);
  return { startsAt, endsAt: Number.isNaN(endsAt.getTime()) ? new Date(startsAt.getTime() + 60 * 60_000) : endsAt };
}
