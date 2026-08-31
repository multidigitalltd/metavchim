import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  ACTIVATION_NUDGE_MAX_LAG_DAYS,
  ACTIVATION_NUDGE_OFFSET_DAYS,
  ACTIVATION_NUDGE_STAGES,
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

/** כמה מועמדים נשלפים בכל דף. תקרת שאילתה, לא תקרת טיפול. */
const PAGE = 200;

/**
 * ‎**התקרה היא על השליחות, לא על המועמדים.**
 *
 * הגרסה הראשונה עשתה `take: 200` על החלון כולו בלי סדר ובלי סמן —
 * וכשיש בו יותר מ-200 ניסיונות, כל סבב שולף שוב את אותם 200
 * הראשונים. מי שמעבר להם מזדקן ויוצא מחלון הפיגור בלי לקבל דבר,
 * בשקט מוחלט (ביקורת Codex). רוב המועמדים הם ממילא בלי-פעולה
 * ‏(כרטיס תקף, שלב שכבר נשלח), ולכן היקר הוא השליחה — והיא זו
 * שראוי לחסום.
 */
const MAX_SENDS_PER_SWEEP = 200;

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
    const partner = await this.partnerPlan();

    let sent = 0;
    let cursor: string | undefined;
    for (;;) {
      /*
       * ‎**סמן על החלון כולו, לפי מועד הסיום.** הסדר אינו קוסמטי:
       * מי שקרוב לצאת מחלון הפיגור מטופל ראשון, כך שעומס חד-פעמי
       * דוחה את הפחות דחופים ולא מוחק אותם.
       *
       * ‎`settings` נשלף כאן ולא בשאילתה נפרדת לכל משרד — משם נגזרים
       * השלבים שכבר נשלחו.
       */
      const page = await this.prisma.tenant.findMany({
        where: {
          // מושהה/סגור אינו מקבל תזכורת הפעלה — הוא כבר לא בדרך הזאת
          status: "trial",
          trialEndsAt: { gte: from, lte: to },
        },
        select: { id: true, name: true, plan: true, trialEndsAt: true, settings: true },
        orderBy: [{ trialEndsAt: "asc" }, { id: "asc" }],
        take: PAGE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1]?.id;

      /*
       * מי שאין לו שלב שממתין יוצא כאן — לפני כל שאילתה נוספת עליו.
       * זה מה שהופך סריקה של חלון גדול לזולה.
       */
      const pending = page.flatMap((tenant) => {
        const deadline = tenant.trialEndsAt;
        if (deadline === null) return [];
        const stage = dueActivationNudge({
          deadline,
          sent: sentStages(tenant.settings),
          now,
        });
        return stage === null ? [] : [{ ...tenant, deadline, stage }];
      });

      if (pending.length > 0) {
        // הכרטיסים בשאילתה אחת לדף, ולא אחת למשרד
        const cards = await this.prisma.subscription.findMany({
          where: { tenantId: { in: pending.map((t) => t.id) } },
          select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
        });
        const cardByTenant = new Map(cards.map((card) => [card.tenantId, card]));

        for (const tenant of pending) {
          if (sent >= MAX_SENDS_PER_SWEEP) {
            this.logger.warn(`תקרת השליחות בסבב הושגה (${MAX_SENDS_PER_SWEEP}) — הבאים בסבב הבא`);
            return { sent };
          }
          if (hasValidCard(cardByTenant.get(tenant.id) ?? null, now)) continue;
          try {
            if (await this.nudgeTenant(tenant, partner, now)) sent += 1;
          } catch (error: unknown) {
            // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
            this.logger.warn(`תזכורת הפעלה ל-${tenant.id} נכשלה: ${String(error)}`);
          }
        }
      }
      if (page.length < PAGE) break;
    }
    if (sent > 0) this.logger.log(`תזכורות הפעלה: נשלחו ל-${sent} משרדים`);
    return { sent };
  }

  /**
   * ‎**מסלול השותפים — רק אם הוא באמת יכול לקלוט את המשרד.**
   *
   * ## מה היה שגוי כאן
   *
   * הגרסה הראשונה החזירה את שם המסלול על סמך קיומו בקטלוג בלבד,
   * וההודעה הבטיחה „רשת שיתופי הפעולה נשארת פתוחה”. אבל **שום דבר
   * לא שינה את מסלול המשרד**: הניסיון פג, `tenantPeriodEnded` החזיר
   * ‎`true`, ו-`AuthGuard` דחה כל נתיב שאינו מסך המנוי ב-402. כלומר
   * מייל שמבטיח ללקוח גישה שאין לו (ביקורת Codex).
   *
   * ## התנאי שנוסף, ולמה דווקא הוא
   *
   * ‎`tenantPeriodEnded` בודק `planIsFree` **ראשון** ומחזיר `false`
   * עבורו — כלומר מסלול חינמי אינו פוקע, וזה בדיוק מה שמאפשר
   * למשרד להישאר פעיל אחרי שהניסיון נגמר. מסלול שאינו חינמי לא
   * היה פותח דבר: המשרד היה ננעל בדיוק כמו קודם, וההודעה הייתה
   * חוזרת לשקר.
   *
   * ‎`undefined` = אין הורדה, וההודעה אומרת „החשבון ננעל”. זה כולל
   * את המצב שבו ההגדרה ריקה, הקוד אינו בקטלוג, או שהמסלול בתשלום.
   */
  private async partnerPlan(): Promise<{ code: string; name: string } | undefined> {
    const code = (await this.settings.get("partnerPlanCode"))?.trim();
    if (code === undefined || code === "") return undefined;
    const plan = await this.plans.byCode(code);
    if (plan === undefined) {
      this.logger.warn(`מסלול השותפים המוגדר (${code}) אינו בקטלוג — התזכורת תיכתב בלעדיו`);
      return undefined;
    }
    if (!(await this.plans.isFreeCode(code))) {
      this.logger.warn(
        `מסלול השותפים (${code}) אינו חינמי — משרד שיועבר אליו ייחסם בכל מקרה, ולכן אין העברה`,
      );
      return undefined;
    }
    return { code, name: plan.name };
  }

  /**
   * ‎**ההעברה בפועל — לפני שההודעה יוצאת.**
   *
   * הסדר קובע: ההודעה אומרת „מה שנשאר פתוח הוא מסלול השותפים”, ואם
   * היא נשלחת לפני ההעברה יש חלון שבו היא פשוט אינה נכונה.
   *
   * ‎`WHERE` מותנה במסלול הנוכחי ובמצב: העברה חוזרת אינה עושה דבר,
   * ומשרד שהספיק לשלם בין הבדיקה לכאן לא נגרר אחורה.
   *
   * לא בשלב `heads_up`: שם הניסיון עדיין בתוקף, וההודעה מדברת על
   * מה שיקרה — לא על מה שקרה.
   */
  private async moveToPartnerPlan(tenantId: string, code: string): Promise<void> {
    const moved = await this.prisma.tenant.updateMany({
      where: { id: tenantId, status: "trial", plan: { not: code } },
      data: { plan: code },
    });
    if (moved.count > 0) this.logger.log(`משרד ${tenantId} הועבר למסלול השותפים (${code})`);
  }

  private async nudgeTenant(
    /* השלב כבר נבחר בסריקה — כאן נשארו הסינון, התפיסה והשליחה */
    tenant: { id: string; name: string; plan: string; stage: ActivationNudgeStage },
    partner: { code: string; name: string } | undefined,
    now: Date,
  ): Promise<boolean> {
    const { stage } = tenant;

    /*
     * ‎**מסלול חינמי אינו פוקע**, ולכן אין לו על מה להתריע —
     * `tenantPeriodEnded` מחזיר `false` עבורו בכל מקרה. תזכורת כזו
     * הייתה מודיעה על נעילה שלא תקרה.
     */
    if (await this.plans.isFreeCode(tenant.plan)) return false;

    const claimed = await this.claim(tenant.id, stage, now);
    if (!claimed) return false;

    const owners = await this.owners(tenant.id);
    if (owners.length === 0) {
      // אין למי לשלוח כרגע — משחררים כדי שבעלים שיופעל בתוך החלון עוד יקבל
      await this.release(tenant.id, stage);
      return false;
    }

    /*
     * ‎**ההעברה קודמת לשליחה** — ראו `moveToPartnerPlan`. משלב
     * ‎`closing` והלאה: ב-`heads_up` הניסיון עדיין בתוקף.
     */
    if (partner !== undefined && stage !== "heads_up") {
      await this.moveToPartnerPlan(tenant.id, partner.code);
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
          partnerPlanName: partner?.name,
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

/**
 * אילו שלבים כבר נשלחו — **מתוך השורה שכבר נשלפה.**
 *
 * זו הייתה שאילתה נפרדת לכל משרד מועמד. בחלון עם אלפי ניסיונות זה
 * אלפי שאילתות בשעה, וכולן על עמודה שממילא יושבת על אותה שורה.
 */
function sentStages(settings: unknown): ActivationNudgeStage[] {
  if (typeof settings !== "object" || settings === null) return [];
  const prefix = "activationNudge:";
  return Object.keys(settings as Record<string, unknown>)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((stage): stage is ActivationNudgeStage =>
      (ACTIVATION_NUDGE_STAGES as readonly string[]).includes(stage),
    );
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
