import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  buildAppointmentReminder,
  buildTaskReminder,
  DomainEvents,
  notificationFromEvent,
  QUEUES,
  type DomainEventName,
} from "@metavchim/shared";
import { loadEnv } from "../config/env";
import { PrismaService } from "./prisma.service";

const POLL_MS = 2000;
const BATCH = 50;
const MAX_ATTEMPTS = 10;

interface ClaimedEvent {
  id: string;
  tenant_id: string;
  name: string;
  payload: unknown;
}

/**
 * מפיץ ה-Outbox (docs/02 §5): קורא אירועים שלא פורסמו ומזרים לתורי BullMQ.
 * FOR UPDATE SKIP LOCKED — בטוח גם עם כמה עותקי API במקביל; אירוע מסומן
 * כמפורסם רק אחרי שנכנס לתור, כך שכשל Redis לא מאבד אירועים.
 */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private connection: IORedis | null = null;
  private notificationsQueue: Queue | null = null;
  private lowQueue: Queue | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const env = loadEnv();
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    this.notificationsQueue = new Queue(QUEUES.notifications, { connection: this.connection });
    this.lowQueue = new Queue(QUEUES.low, { connection: this.connection });
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.notificationsQueue?.close();
    await this.lowQueue?.close();
    await this.connection?.quit();
  }

  private async tick(): Promise<void> {
    if (this.running) return; // אין טיקים חופפים
    this.running = true;
    try {
      await this.dispatchBatch();
    } catch (error) {
      this.logger.error(`Outbox dispatch failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchBatch(): Promise<void> {
    // הטרנזקציה רצה כבעלים לוגית של השורות שנתפסו — SKIP LOCKED מונע כפילות.
    await this.prisma.$transaction(async (tx) => {
      const events = await tx.$queryRaw<ClaimedEvent[]>`
        SELECT id, tenant_id, name, payload FROM outbox_events
        WHERE published_at IS NULL AND attempts < ${MAX_ATTEMPTS}
        ORDER BY occurred_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (events.length === 0) return;

      const done: string[] = [];
      const failed: string[] = [];
      for (const event of events) {
        try {
          await this.route(event);
          done.push(event.id);
        } catch (error) {
          this.logger.warn(`Event ${event.name} (${event.id}) routing failed: ${String(error)}`);
          failed.push(event.id);
        }
      }
      if (done.length > 0) {
        await tx.$executeRaw`UPDATE outbox_events SET published_at = now() WHERE id = ANY(${done})`;
      }
      if (failed.length > 0) {
        await tx.$executeRaw`UPDATE outbox_events SET attempts = attempts + 1 WHERE id = ANY(${failed})`;
      }
    });
  }

  private async route(event: ClaimedEvent): Promise<void> {
    const name = event.name as DomainEventName;
    const schema = DomainEvents[name];
    if (!schema) return; // אירוע לא מוכר — מסומן published, לא חוסם את התור
    const payload = schema.parse(event.payload);

    const notification = notificationFromEvent(name, payload);
    if (notification && this.notificationsQueue) {
      await this.notificationsQueue.add("notify", notification, {
        jobId: `notify-${event.id}`, // Idempotent — אותו אירוע לא ייכנס פעמיים
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      });
    }
    // מחיקת אובייקט אחסון שנכשלה — ניסיון חוזר עמיד בתור low (עד 10 ניסיונות).
    if (name === "storage.cleanup_object" && this.lowQueue) {
      await this.lowQueue.add("delete-object", payload, {
        jobId: `cleanup-${event.id}`,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 10,
        backoff: { type: "exponential", delay: 5000 },
      });
    }
    // תזכורת משימה במועד היעד — Job מושהה (docs/01 — מודול 7).
    if (name === "task.created" && this.notificationsQueue) {
      const p = payload as {
        taskId: string;
        tenantId: string;
        assignedToUserId: string;
        title: string;
        dueAt: Date;
      };
      const delayMs = p.dueAt.getTime() - Date.now();
      if (delayMs > 0) {
        await this.notificationsQueue.add("notify", buildTaskReminder(p), {
          jobId: `task-remind-${event.id}`,
          delay: delayMs,
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
        });
      }
    }
    // פולו-אפ הצעה (docs/01 — "כלום לא נשכח"): נפתחה ולא נענתה תוך N
    // שעות → משימה לסוכן. מתוזמן רק בפתיחה הראשונה; jobId לפי ההצעה —
    // אירועי פתיחה חוזרים לא מכפילים. ה-Worker בודק את הסטטוס בזמן
    // הירי: קונה שכבר הגיב — אין משימה.
    if (name === "offer.opened" && this.lowQueue) {
      const p = payload as { offerId: string; tenantId: string; openCount: number };
      if (p.openCount === 1) {
        await this.lowQueue.add(
          "offer-followup",
          { offerId: p.offerId, tenantId: p.tenantId },
          {
            jobId: `followup-${p.offerId}`,
            delay: loadEnv().OFFER_FOLLOWUP_HOURS * 60 * 60 * 1000,
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 5,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
      }
    }
    // תזכורת שעה לפני פגישה — Job מושהה; BullMQ מחזיק את התזמון (docs/01 §13).
    if (name === "appointment.scheduled" && this.notificationsQueue) {
      const p = payload as { appointmentId: string; tenantId: string; startsAt: Date };
      const delayMs = p.startsAt.getTime() - Date.now() - 60 * 60 * 1000;
      if (delayMs > 0) {
        await this.notificationsQueue.add("notify", buildAppointmentReminder(p), {
          jobId: `remind-${event.id}`,
          delay: delayMs,
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
        });
      }
    }
    // צרכנים נוספים (וואטסאפ יוצא, סנכרון יומן, Kanko) יירשמו כאן — לכל
    // אירוע צרכן משלו ותור משלו, לפי docs/02 §5.
  }
}
