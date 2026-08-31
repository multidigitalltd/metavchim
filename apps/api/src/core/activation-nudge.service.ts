import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  ACTIVATION_NUDGE_MAX_LAG_DAYS,
  ACTIVATION_NUDGE_OFFSET_DAYS,
  activationNudgeEmail,
  dueActivationNudge,
  hasValidCard,
  type ActivationNudgeStage,
} from "@metavchim/shared";

import { loadEnv } from "../config/env";
import { EmailService } from "./email.service";
import { PlanCatalogService } from "./plan-catalog.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { PrismaService } from "./prisma.service";

/** פעם בשעה — החלון נמדד בימים, כמו בהזמנה לשיחת ההיכרות. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** שלוש דקות אחרי העלייה — אחרי סבב ההיכרות, לא במקביל אליו. */
const FIRST_SWEEP_DELAY_MS = 3 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** תקרת אצווה — סבב אחד אינו אמור להפוך לדיוור המוני. */
const BATCH = 200;

/**
 * ‎**תזכורות למי שנרשם ולא השאיר כרטיס.**
 *
 * ## מה היה קורה בלעדיהן
 *
 * הניסיון נגמר, `tenantPeriodEnded` מחזיר `true`, וכל המערכת ננעלת
 * מלבד מסך המנוי. זה נכון — אבל זה קרה **בלי שאיש אמר מילה**:
 * המשתמש גילה את זה בפעם הבאה שניסה להיכנס, מול מסך שלא הכיר.
 *
 * שלוש הודעות מדורגות (`packages/shared/src/logic/activation-nudge.ts`)
 * הופכות את זה למשהו שאפשר להיערך אליו: יומיים לפני, ביום עצמו,
 * ושבוע אחרי — ואז שקט.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * כמו הזמנת שיחת ההיכרות שלצידה: השליחה דורשת את `EmailService`,
 * שקורא סודות מוצפנים דרך `PlatformSettingsService`. הסריקה זולה —
 * שאילתה אחת לשעה על חלון תאריכים צר.
 *
 * ## אחת ולתמיד, לכל שלב
 *
 * הסימון נתפס **לפני** השליחה בעדכון jsonb אטומי מותנה, בדיוק כמו
 * ב-`OnboardingOutreachService`: עותק שני שרץ במקביל מקבל 0 שורות
 * ולא שולח. שליחה שנכשלה לפני שאיש קיבל משחררת את הסימון.
 */
@Injectable()
export class ActivationNudgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivationNudgeService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly plans: PlanCatalogService,
    private readonly settings: PlatformSettingsService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } catch (error: unknown) {
      this.logger.error(`סבב תזכורות ההפעלה נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** סבב אחד. ציבורי — לבדיקה מול מסד אמיתי בלי לחכות שעה. */
  async sweep(now: Date): Promise<{ sent: number }> {
    /*
     * לא בשבת ובשעות אנושיות — אותו כלל כמו בהזמנה לשיחת ההיכרות.
     * דיוור שנוחת בשלוש לפנות בוקר נקרא כספאם גם כשהתוכן מדויק.
     */
    const jerusalem = jerusalemParts(now);
    if (jerusalem.weekday === "Saturday") return { sent: 0 };
    if (jerusalem.hour < 9 || jerusalem.hour >= 18) return { sent: 0 };

    /*
     * החלון: מהמוקדמת שבתזכורות ועד תקרת הפיגור של המאוחרת. זו
     * שאילתה אחת על טווח צר, ולא סריקה של כל הדיירים.
     */
    const earliest = ACTIVATION_NUDGE_OFFSET_DAYS.heads_up;
    const latest = ACTIVATION_NUDGE_OFFSET_DAYS.last_call + ACTIVATION_NUDGE_MAX_LAG_DAYS;
    const from = new Date(now.getTime() - latest * DAY_MS);
    const to = new Date(now.getTime() - earliest * DAY_MS);

    /*
     * ‎**ניסיונות בלבד — כי „לא הפעיל” פירושו שמעולם לא שילם.**
     *
     * הגרסה הראשונה כללה גם `active` שתקופתו נגמרה. שתי סיבות
     * למה זה היה שגוי, והשנייה חמורה: משרד כזה **כן** הפעיל את
     * החשבון בעבר, ולכן הוא אינו הנמען שהתזכורת הזאת מדברת אליו;
     * וההודעה הייתה אומרת לו „תקופת הניסיון שלכם הסתיימה” על תקופה
     * ששילם עליה. מי שכרטיסו פג אחרי שכבר שילם הוא מקרה של גבייה
     * שנכשלה, וזו זרימה אחרת עם נוסח אחר.
     */
    const candidates = await this.prisma.tenant.findMany({
      where: {
        // מושהה/סגור אינו מקבל תזכורת הפעלה — הוא כבר לא בדרך הזאת
        status: "trial",
        trialEndsAt: { gte: from, lte: to },
      },
      select: { id: true, name: true, plan: true, trialEndsAt: true },
      take: BATCH,
    });
    if (candidates.length === 0) return { sent: 0 };

    const partnerPlanName = await this.partnerPlanName();

    let sent = 0;
    for (const tenant of candidates) {
      try {
        if (await this.nudgeTenant(tenant, partnerPlanName, now)) sent += 1;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`תזכורת הפעלה ל-${tenant.id} נכשלה: ${String(error)}`);
      }
    }
    if (sent > 0) this.logger.log(`תזכורות הפעלה: נשלחו ל-${sent} משרדים`);
    return { sent };
  }

  /**
   * שם מסלול השותפים — מהקטלוג, לפי ההגדרה.
   *
   * ‎`undefined` כשאין הגדרה או כשהקוד אינו מוכר: התזכורת אומרת אז
   * ‎„החשבון ננעל” במקום לנקוב בשם של מסלול שאינו קיים. שם קבוע
   * בקוד היה הבטחה ללקוח על משהו שאולי נקרא אחרת.
   */
  private async partnerPlanName(): Promise<string | undefined> {
    const code = (await this.settings.get("partnerPlanCode"))?.trim();
    if (code === undefined || code === "") return undefined;
    const plan = await this.plans.byCode(code);
    if (plan === undefined) {
      this.logger.warn(`מסלול השותפים המוגדר (${code}) אינו בקטלוג — התזכורת תיכתב בלעדיו`);
      return undefined;
    }
    return plan.name;
  }

  private async nudgeTenant(
    tenant: { id: string; name: string; plan: string; trialEndsAt: Date | null },
    partnerPlanName: string | undefined,
    now: Date,
  ): Promise<boolean> {
    const deadline = tenant.trialEndsAt;
    if (deadline === null) return false;

    /*
     * ‎**מסלול חינמי אינו פוקע**, ולכן אין לו על מה להתריע —
     * `tenantPeriodEnded` מחזיר `false` עבורו בכל מקרה. תזכורת כזו
     * הייתה מודיעה על נעילה שלא תקרה.
     */
    if (await this.plans.isFreeCode(tenant.plan)) return false;

    /*
     * ‎**יש כרטיס תקף — אין על מה להזכיר.** הבדיקה כאן ולא בשאילתה:
     * תוקף אינו תנאי שאפשר לנסח ב-`where` בלי חישוב, והמועמדים
     * ממילא מעטים.
     */
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: tenant.id },
      select: { cardTokenEncrypted: true, cardMonth: true, cardYear: true },
    });
    if (hasValidCard(subscription, now)) return false;

    const stage = dueActivationNudge({ deadline, sent: await this.sentStages(tenant.id), now });
    if (stage === null) return false;

    const claimed = await this.claim(tenant.id, stage, now);
    if (!claimed) return false;

    const owners = await this.owners(tenant.id);
    if (owners.length === 0) {
      // אין למי לשלוח כרגע — משחררים כדי שבעלים שיופעל בתוך החלון עוד יקבל
      await this.release(tenant.id, stage);
      return false;
    }

    const plan = await this.plans.byCode(tenant.plan);
    const origin = loadEnv().WEB_ORIGIN;
    let delivered = 0;
    try {
      for (const owner of owners) {
        const { subject, content } = activationNudgeEmail({
          stage,
          ownerName: owner.name,
          tenantName: tenant.name,
          planName: plan?.name ?? "המסלול שבחרתם",
          partnerPlanName,
          billingUrl: `${origin}/settings/billing`,
          optOutUrl: `${origin}/nudge-optout/${owner.token}`,
        });
        /*
         * ‎`required: true` כמו בהזמנה לשיחת ההיכרות: הסימון נתפס
         * לפני השליחה, ובלי הדרישה היעדר ספק היה חוזר בשקט —
         * הסימון נשאר, והמשרד לא היה מקבל את התזכורת לעולם.
         */
        await this.email.send(owner.email, subject, content, { required: true });
        delivered += 1;
      }
      return true;
    } catch (error: unknown) {
      if (delivered > 0) {
        /*
         * חלק מהבעלים כבר קיבלו. שחרור הסימון היה שולח להם את אותה
         * תזכורת שוב בכל סבב — נזק ודאי וחוזר, לעומת בעלים אחד
         * שהחמיץ הודעה. הסימון נשאר, והפער נרשם.
         */
        this.logger.warn(
          `תזכורת ${stage} ל-${tenant.id}: ${delivered} מתוך ${owners.length} נשלחו; הסימון נשמר`,
        );
        return true;
      }
      await this.release(tenant.id, stage);
      throw error;
    }
  }

  /** אילו שלבים כבר נשלחו למשרד הזה. */
  private async sentStages(tenantId: string): Promise<ActivationNudgeStage[]> {
    const rows = await this.prisma.$queryRaw<{ stage: string }[]>`
      SELECT jsonb_object_keys(COALESCE(settings, '{}'::jsonb)) AS stage
      FROM tenants WHERE id = ${tenantId}
    `;
    return rows
      .map((row) => row.stage)
      .filter((key): key is `activationNudge:${ActivationNudgeStage}` =>
        key.startsWith("activationNudge:"),
      )
      .map((key) => key.slice("activationNudge:".length) as ActivationNudgeStage);
  }

  /**
   * תפיסת השלב — אטומית ומותנית, לפני השליחה.
   *
   * שני עותקים שרצים במקביל: אחד מעדכן שורה אחת, השני אפס, ורק
   * הראשון שולח. אותה מכניקה בדיוק כמו ב-`OnboardingOutreachService`.
   */
  private async claim(tenantId: string, stage: ActivationNudgeStage, now: Date): Promise<boolean> {
    const key = `activationNudge:${stage}`;
    const claimed = await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        ARRAY[${key}],
        to_jsonb(${now.toISOString()}::text)
      )
      WHERE id = ${tenantId}
        AND NOT (COALESCE(settings, '{}'::jsonb) ? ${key})
    `;
    return claimed > 0;
  }

  /** ביטול הסימון — רק כשבטוח שאיש לא קיבל את התזכורת. */
  private async release(tenantId: string, stage: ActivationNudgeStage): Promise<void> {
    const key = `activationNudge:${stage}`;
    await this.prisma.$executeRaw`
      UPDATE tenants
      SET settings = COALESCE(settings, '{}'::jsonb) - ${key}
      WHERE id = ${tenantId}
    `;
  }

  /**
   * הבעלים שעדיין מקבלים — ולכל אחד הטוקן שבקישור ההסרה שלו.
   *
   * ‎**מי שהסיר את עצמו אינו ברשימה.** זו כל המשמעות של „הסרה”, והיא
   * נבדקת כאן ולא בתצוגה: בדיקה שיושבת אחרי השליחה אינה הסרה.
   */
  private async owners(
    tenantId: string,
  ): Promise<{ name: string; email: string; token: string }[]> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const rows = await tx.user.findMany({
        where: { tenantId, role: "owner", isActive: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          nudgeOptOut: { select: { token: true, optedOutAt: true } },
        },
      });
      const out: { name: string; email: string; token: string }[] = [];
      for (const row of rows) {
        /*
         * ‎`undefined` = אין שורת הסרה כלל (טרם נשלחה תזכורת);
         * ‎`null` = יש שורה והוא עדיין מקבל. שניהם „ממשיך לקבל”,
         * ורק חותמת אמיתית מוציאה אותו מהרשימה.
         */
        const optedOutAt = row.nudgeOptOut?.optedOutAt;
        if (optedOutAt !== null && optedOutAt !== undefined) continue;
        /*
         * הטוקן נוצר בשליחה הראשונה ונשמר לתמיד: קישור הסרה ממייל
         * בן חודש חייב להמשיך לעבוד, ולכן הוא אינו מתחלף בין
         * הודעות ואינו פוקע.
         */
        const token =
          row.nudgeOptOut?.token ??
          (
            await tx.activationNudgeOptOut.create({
              data: {
                id: ulid(),
                tenantId,
                userId: row.id,
                token: randomBytes(32).toString("base64url"),
              },
              select: { token: true },
            })
          ).token;
        out.push({ name: row.name, email: row.email, token });
      }
      return out;
    });
  }
}

/** היום והשעה בשעון ירושלים — השרת יכול לרוץ בכל אזור זמן. */
function jerusalemParts(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return { weekday, hour };
}
