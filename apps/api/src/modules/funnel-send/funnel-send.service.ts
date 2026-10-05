import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  firstNameOf,
  funnelEmail,
  funnelFacts,
  hasValidCard,
  isFunnelSendingTime,
  nextFunnelStage,
  trialAnchorOf,
  type FunnelFacts,
  type FunnelStageDef,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { ActivationNudgeService } from "../../core/activation-nudge.service";
import { EmailService } from "../../core/email.service";
import { OnboardingFactsService } from "../../core/onboarding-facts.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { Sweep } from "../../core/sweeps";
import {
  FunnelEnrollmentService,
  isTenantSubscribed,
  isTrialActive,
} from "../funnel/funnel-enrollment.service";
import { FunnelStageService, type FunnelStageCopy } from "../funnel/funnel-stage.service";

const HOUR_MS = 60 * 60 * 1000;

/** ‏כמה רישומים נשלפים בכל דף. תקרת שאילתה, לא תקרת טיפול. */
const PAGE = 200;

/**
 * ‎**תקרת המשרדים שמקבלים הודעה בסבב אחד.** הכניסה למסלול כבר מדורגת
 * ‏(25 ביום), וזו רשת ביטחון: באג בבחירת השלב לא יהפוך לגל שליחה.
 */
const MAX_TENANTS_PER_SWEEP = 100;

/** ‏עובדות שאינן משנות דבר — לסינון המוקדם, כשהשלבים בלי תנאי קהל. */
const ANY_FACTS: FunnelFacts = {
  hasProperties: false,
  hasData: false,
  nextStepPending: false,
  featureUnused: false,
  hasValidCard: false,
  subscribed: false,
  trialActive: false,
  chargeFailing: false,
};

/**
 * ‎**מסלול ההמרה — השליחה עצמה (שלב ב׳).**
 *
 * ## ‏מה הסבב עושה
 *
 * ‏פעם בשעה, ורק כשהמפסק הראשי (`funnelSending`) דלוק: מכניס ומוציא
 * ‏משרדים מהמסלול (`FunnelEnrollmentService.sweep`), ובשעות השליחה
 * ‏בוחר לכל רישום פתוח את **השלב הבא אחד** (`nextFunnelStage`) ושולח
 * ‏אותו במייל לבעלי המשרד.
 *
 * ## ‏למה גם הכניסה מאחורי המפסק
 *
 * ‏יום 0 של משרד הוא רגע הכניסה. כניסה שרצה לפני שהודלק שלב הייתה
 * ‏מבזבזת את ימי התוכן של כל מי שנכנס בינתיים — הם היו פגים בלי
 * ‏שנשלח דבר.
 *
 * ## ‏פעם אחת לכל נמען, ברמת המסד
 *
 * ‏שורת `funnel_messages` נוצרת **לפני** השליחה, והאינדקס הייחודי
 * ‏`(enrollment, stage, user, channel)` הופך שליחה כפולה לבלתי
 * ‏אפשרית. שליחה שנכשלה מסומנת `failed` ונתפסת שוב בסבב הבא, עם אותו
 * ‏מפתח אידמפוטנטיות — כך גם כישלון עמום אינו יוצא פעמיים.
 *
 * ## ‏הנמענים וההסרה
 *
 * ‏אותם בעלים ואותה הסרה של תזכורות ההפעלה (`recipients`): שתיהן
 * ‏הודעות על הפעלת החשבון, ומי שביקש להפסיק אחת לא ביקש את השנייה.
 */
@Injectable()
export class FunnelSendService {
  private readonly logger = new Logger(FunnelSendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollment: FunnelEnrollmentService,
    private readonly stages: FunnelStageService,
    private readonly email: EmailService,
    private readonly settings: PlatformSettingsService,
    private readonly recipientsOf: ActivationNudgeService,
    private readonly onboarding: OnboardingFactsService,
  ) {}

  @Sweep({ name: "funnel", everyMs: HOUR_MS, firstDelayMs: 5 * 60 * 1000 })
  private async tick(): Promise<void> {
    try {
      await this.run(new Date());
    } catch (error: unknown) {
      this.logger.error(`סבב מסלול ההמרה נכשל: ${String(error)}`);
    }
  }

  /** ‏האם המפסק הראשי דלוק. כבוי כברירת מחדל — שום דבר לא יוצא בלי החלטה. */
  async isOn(): Promise<boolean> {
    return (await this.settings.get("funnelSending")) === "true";
  }

  /** ‏סבב אחד. ציבורי — לבדיקה מול מסד אמיתי בלי לחכות שעה. */
  async run(now: Date): Promise<{ enrolled: number; closed: number; sent: number }> {
    if (!(await this.isOn())) return { enrolled: 0, closed: 0, sent: 0 };
    const { enrolled, closed } = await this.enrollment.sweep(now);
    const sent = isFunnelSendingTime(now) ? await this.dispatch(now) : 0;
    if (sent > 0) this.logger.log(`מסלול ההמרה: ${sent} משרדים קיבלו הודעה`);
    return { enrolled, closed, sent };
  }

  /** ‏השלב הבא לכל רישום המרה פתוח. מחזיר כמה משרדים קיבלו הודעה. */
  private async dispatch(now: Date): Promise<number> {
    const { stages } = await this.stages.catalog();
    const live = stages.filter((stage) => stage.track === "conversion" && stage.enabled);
    if (live.length === 0) return 0;
    const copies = new Map(
      (await this.stages.copyCatalog())
        .filter((copy) => copy.track === "conversion")
        .map((copy) => [copy.key, copy]),
    );
    /* ‏בלי תנאי קהל — לשאלה הזולה „יש בכלל שלב שהגיע זמנו?” */
    const unconditioned = live.map((stage) => ({ ...stage, audience: [] }));

    let sent = 0;
    let cursor: string | null = null;
    for (;;) {
      const after: string | null = cursor;
      const page: { id: string; tenantId: string; startedAt: Date; lastSentAt: Date | null }[] =
        await this.prisma.withFunnelAdmin((tx) =>
        tx.funnelEnrollment.findMany({
          where: {
            track: "conversion",
            endedAt: null,
            ...(after === null ? {} : { id: { gt: after } }),
          },
          select: { id: true, tenantId: true, startedAt: true, lastSentAt: true },
          orderBy: { id: "asc" },
          take: PAGE,
        }),
      );
      if (page.length === 0) break;
      cursor = page[page.length - 1]?.id ?? null;

      const tenantIds = page.map((row) => row.tenantId);
      const [tenants, cards, sentRows] = await Promise.all([
        this.prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: {
            id: true,
            name: true,
            status: true,
            trialEndsAt: true,
            trialConcludedAt: true,
            paidUntil: true,
          },
        }),
        this.prisma.subscription.findMany({
          where: { tenantId: { in: tenantIds } },
          select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
        }),
        this.prisma.withFunnelAdmin((tx) =>
          tx.funnelMessage.findMany({
            where: {
              enrollmentId: { in: page.map((row) => row.id) },
              status: "sent",
              sentAt: { not: null },
            },
            select: { enrollmentId: true, stageKey: true },
          }),
        ),
      ]);
      const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
      const cardById = new Map(cards.map((card) => [card.tenantId, card]));
      const sentKeys = new Map<string, string[]>();
      for (const r of sentRows) sentKeys.set(r.enrollmentId, [...(sentKeys.get(r.enrollmentId) ?? []), r.stageKey]);

      for (const row of page) {
        if (sent >= MAX_TENANTS_PER_SWEEP) {
          this.logger.warn(`תקרת המשרדים בסבב הושגה (${MAX_TENANTS_PER_SWEEP}) — הבאים בסבב הבא`);
          return sent;
        }
        const tenant = tenantById.get(row.tenantId);
        // ‏משרד מושהה או סגור אינו מקבל דיוור שיווקי, גם כשהרישום עוד פתוח
        if (tenant === undefined || (tenant.status !== "trial" && tenant.status !== "active")) {
          continue;
        }
        const input = {
          anchors: {
            funnelStartedAt: row.startedAt,
            ...trialAnchorOf(tenant),
            paymentFailedAt: null,
          },
          sent: sentKeys.get(row.id) ?? [],
          lastSentAt: row.lastSentAt,
          now,
        };
        if (nextFunnelStage({ ...input, stages: unconditioned, facts: ANY_FACTS }) === null) continue;
        try {
          const facts = funnelFacts({
            onboarding: await this.onboarding.facts(row.tenantId),
            calls: await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
              tx.call.count({ where: { tenantId: row.tenantId } }),
            ),
            hasValidCard: hasValidCard(cardById.get(row.tenantId) ?? null, now),
            subscribed: isTenantSubscribed(tenant),
            trialActive: isTrialActive(tenant, now),
            chargeFailing: false,
          });
          const stage = nextFunnelStage({ ...input, stages: live, facts });
          if (stage === null) continue;
          const copy = copies.get(stage.key);
          if (copy === undefined || !stage.channels.includes("email")) continue;
          if (await this.sendStage(row, tenant.name, stage, copy, now)) sent += 1;
        } catch (error: unknown) {
          // ‏משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
          this.logger.warn(`מסלול ההמרה למשרד ${row.tenantId} נכשל: ${String(error)}`);
        }
      }
      if (page.length < PAGE) break;
    }
    return sent;
  }

  /**
   * ‏שליחת שלב אחד לבעלי המשרד. `true` = לפחות אחד קיבל, ואז נרשם
   * ‏`lastSentAt` — המרווח המזערי עד ההודעה הבאה נמדד ממנו.
   */
  private async sendStage(
    enrollment: { id: string; tenantId: string },
    tenantName: string,
    stage: FunnelStageDef,
    copy: FunnelStageCopy,
    now: Date,
  ): Promise<boolean> {
    const recipients = await this.recipientsOf.recipients(enrollment.tenantId);
    const origin = loadEnv().WEB_ORIGIN;
    const tracked = `${origin}/api/v1/public/funnel`;
    let delivered = 0;
    for (const owner of recipients) {
      const message = await this.claim(enrollment, stage.key, owner);
      if (message === null) continue;
      const email = funnelEmail(
        copy,
        { שם_פרטי: firstNameOf(owner.name), שם_המשרד: tenantName },
        origin,
        {
          clickUrl: `${tracked}/c/${message.token}`,
          pixelUrl: `${tracked}/o/${message.token}`,
          optOutUrl: `${origin}/nudge-optout/${owner.token}`,
        },
      );
      try {
        if (email === null) throw new Error("לשלב אין נושא וגוף למייל");
        await this.email.send(owner.email, email.subject, email.content, {
          // ‏מזהה השורה: ניסיון חוזר אחרי כישלון עמום הוא אותה שליחה
          idempotency: { key: `funnel:${message.id}`, purpose: "funnel" },
          required: true,
        });
        await this.settle(enrollment.tenantId, message.id, { status: "sent", sentAt: now, error: null });
        delivered += 1;
      } catch (error: unknown) {
        await this.settle(enrollment.tenantId, message.id, {
          status: "failed",
          error: String(error).slice(0, 300),
        });
      }
    }
    if (delivered === 0) return false;
    await this.prisma.withFunnelAdmin((tx) =>
      tx.funnelEnrollment.update({ where: { id: enrollment.id }, data: { lastSentAt: now } }),
    );
    return true;
  }

  /**
   * ‎**תפיסת השורה לפני השליחה.** `null` = כבר נשלח, או שעותק אחר
   * ‏מטפל בו עכשיו. שורה שנכשלה נתפסת מחדש בעדכון מותנה — שני עותקים
   * ‏שמנסים יחד מקבלים אחד שורה ואחד אפס.
   */
  private async claim(
    enrollment: { id: string; tenantId: string },
    stageKey: string,
    owner: { id: string; email: string },
  ): Promise<{ id: string; token: string } | null> {
    return this.prisma.withFunnelAdmin(async (tx) => {
      const existing = await tx.funnelMessage.findUnique({
        where: {
          enrollmentId_stageKey_userId_channel: {
            enrollmentId: enrollment.id,
            stageKey,
            userId: owner.id,
            channel: "email",
          },
        },
        select: { id: true, token: true, status: true },
      });
      if (existing !== null) {
        if (existing.status !== "failed") return null;
        const reclaimed = await tx.funnelMessage.updateMany({
          where: { id: existing.id, status: "failed" },
          data: { status: "queued", destination: owner.email },
        });
        return reclaimed.count === 1 ? { id: existing.id, token: existing.token } : null;
      }
      const created = await tx.funnelMessage.createMany({
        data: {
          id: ulid(),
          tenantId: enrollment.tenantId,
          enrollmentId: enrollment.id,
          track: "conversion",
          stageKey,
          userId: owner.id,
          destination: owner.email,
          channel: "email",
          token: randomBytes(32).toString("base64url"),
        },
        skipDuplicates: true,
      });
      if (created.count === 0) return null;
      return tx.funnelMessage.findUniqueOrThrow({
        where: {
          enrollmentId_stageKey_userId_channel: {
            enrollmentId: enrollment.id,
            stageKey,
            userId: owner.id,
            channel: "email",
          },
        },
        select: { id: true, token: true },
      });
    });
  }

  private async settle(
    tenantId: string,
    id: string,
    data: { status: "sent" | "failed"; sentAt?: Date; error: string | null },
  ): Promise<void> {
    await this.prisma.withFunnelAdmin((tx) =>
      tx.funnelMessage.updateMany({ where: { id, tenantId }, data }),
    );
  }
}
