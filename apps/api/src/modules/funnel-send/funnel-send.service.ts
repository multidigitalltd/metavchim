import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  FUNNEL_MESSAGE_OUT_STATUSES,
  firstNameOf,
  funnelEmail,
  funnelFacts,
  funnelStageExpiresAt,
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

/**
 * ‎**תפיסה שלא הוכרעה בזמן הזה ננטשה.** שליחה אחת נמשכת שניות (פסק
 * ‏הזמן של הספק), ולכן שורה שעדיין `queued` אחרי חצי שעה היא של תהליך
 * ‏שנפל בין התפיסה להכרעה — לא של שליחה שעוד רצה.
 */
const STALE_CLAIM_MS = 30 * 60 * 1000;

/** ‏מה שהשליחה עצמה יודעת על התוצאה — לפני שה-Webhook אמר את דברו. */
type Settlement = { status: "sent" | "failed"; sentAt?: Date; error: string | null };

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
 * ‏מפתח אידמפוטנטיות — כך גם כישלון עמום אינו יוצא פעמיים. תפיסה
 * ‏שננטשה (התהליך נפל באמצע) חוזרת ל-`failed` בתחילת הסבב, ומשם באותה
 * ‏דרך (`releaseStaleClaims`).
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
    // ‏לפני הסגירה: שלב עם תפיסה נטושה עוד ממתין לניסיון חוזר
    await this.releaseStaleClaims(now);
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
      const [tenants, cards, sentRows, failedRows] = await Promise.all([
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
              status: { in: [...FUNNEL_MESSAGE_OUT_STATUSES] },
              sentAt: { not: null },
            },
            select: { enrollmentId: true, stageKey: true },
          }),
        ),
        this.prisma.withFunnelAdmin((tx) =>
          tx.funnelMessage.findMany({
            where: { enrollmentId: { in: page.map((row) => row.id) }, status: "failed" },
            select: { enrollmentId: true, stageKey: true, userId: true },
          }),
        ),
      ]);
      const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
      const cardById = new Map(cards.map((card) => [card.tenantId, card]));
      const sentKeys = new Map<string, string[]>();
      for (const r of sentRows) {
        sentKeys.set(r.enrollmentId, [...(sentKeys.get(r.enrollmentId) ?? []), r.stageKey]);
      }
      const failedByEnrollment = new Map<string, { stageKey: string; userId: string }[]>();
      for (const r of failedRows) {
        failedByEnrollment.set(r.enrollmentId, [...(failedByEnrollment.get(r.enrollmentId) ?? []), r]);
      }

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
        try {
          /*
           * ‎**כל הבעלים ביקשו להפסיק — הרישום נסגר כ„ביקש להפסיק”**
           * ‏(ביקורת Codex). בלי זה הוא נשאר „במסלול” לנצח ונסרק בכל
           * ‏סבב, והמדד „ביקשו להפסיק” לא היה זז לעולם. משרד בלי בעלים
           * ‏פעיל כלל אינו „ביקש” דבר, ולכן הוא נשאר פתוח.
           *
           * ‏**לפני השאלה „יש שלב שהגיע זמנו”** (ביקורת Codex): מי שהסיר
           * ‏את עצמו אחרי שלב, כשהבא עוד רחוק או שאין בא, היה נשאר „במסלול”
           * ‏ונסגר בסוף כ„סיים את הרצף”. שאילתה אחת לרישום בשעה — ואותם
           * ‏נמענים משמשים גם לניסיון החוזר ולשליחה.
           */
          const recipients = await this.recipientsOf.recipients(row.tenantId);
          if (recipients.length === 0) {
            const owners = await this.prisma.withExplicitTenant(row.tenantId, (tx) =>
              tx.user.count({ where: { tenantId: row.tenantId, role: "owner", isActive: true } }),
            );
            if (owners > 0) {
              const { id: _id, name: _name, ...snapshot } = tenant;
              await this.enrollment.close(row.id, "opted_out", now, {
                tenantId: row.tenantId,
                tenant: snapshot,
                hasCard: hasValidCard(cardById.get(row.tenantId) ?? null, now),
              });
            }
            continue;
          }
          /*
           * ‎**נמען שנכשל — אחרי שאחר כבר קיבל** (ביקורת Codex, P1).
           *
           * ‏השלב נחשב „נשלח” ברמת הרישום ברגע שבעלים אחד קיבל, ולכן
           * ‏`nextFunnelStage` לא יחזור אליו. הניסיון החוזר כאן, כל עוד
           * ‏חלון השלב פתוח; `claim` תופס רק את השורות שנכשלו. סבב שבו
           * ‏היה ניסיון חוזר אינו מתקדם לשלב הבא — כך שאיש אינו מקבל
           * ‏שתי הודעות באותו יום.
           *
           * ‏רק שורות של מי שעדיין נמען — מי שהסיר את עצמו, הושבת או
           * ‏הוסר אינו מקבל, ושורה ישנה שלו אינה עוצרת את המשרד מלהתקדם
           * ‏(ביקורת Codex).
           */
          const failed = failedByEnrollment.get(row.id) ?? [];
          const current = new Set(recipients.map((owner) => owner.id));
          const partial = live.filter(
            (stage) =>
              failed.some((f) => f.stageKey === stage.key && current.has(f.userId)) &&
              input.sent.includes(stage.key) &&
              now.getTime() <= (funnelStageExpiresAt(stage, input.anchors)?.getTime() ?? 0),
          );
          if (partial.length > 0) {
            let delivered = false;
            for (const stage of partial) {
              const copy = copies.get(stage.key);
              if (copy === undefined) continue;
              if (await this.sendStage(row, tenant.name, stage, copy, now, recipients)) {
                delivered = true;
              }
            }
            // ‏ניסיון חוזר שהצליח הוא משרד שקיבל — נספר בתקרה כמו כל אחר
            if (delivered) sent += 1;
            continue;
          }
          if (nextFunnelStage({ ...input, stages: unconditioned, facts: ANY_FACTS }) === null) {
            continue;
          }
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
          if (await this.sendStage(row, tenant.name, stage, copy, now, recipients)) sent += 1;
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
    recipients: Awaited<ReturnType<ActivationNudgeService["recipients"]>>,
  ): Promise<boolean> {
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
      let outcome: Settlement;
      try {
        if (email === null) throw new Error("לשלב אין נושא וגוף למייל");
        await this.email.send(owner.email, email.subject, email.content, {
          // ‏מזהה השורה: ניסיון חוזר אחרי כישלון עמום הוא אותה שליחה
          idempotency: { key: `funnel:${message.id}`, purpose: "funnel" },
          required: true,
        });
        outcome = { status: "sent", sentAt: now, error: null };
      } catch (error: unknown) {
        outcome = { status: "failed", error: String(error).slice(0, 300) };
      }
      if (await this.settle(enrollment.tenantId, message.id, outcome)) delivered += 1;
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

  /**
   * ‎**הכרעת השליחה — רק לשורה שעוד בתור** (ביקורת Codex). Webhook
   * ‏המסירה יכול להקדים את התשובה של הספק: חזרה מהירה שאחריה „התקבל”
   * ‏הייתה הופכת ל„נשלחה” ונעלמת מהמדד, ופסק זמן אחרי מסירה מאושרת
   * ‏היה מסמן אותה „נכשלה” ושולח שוב. מה שהספק דיווח גובר.
   *
   * ‏מחזיר האם ההודעה **יצאה בסוף** — לפי השורה ולא לפי מה שניסינו
   * ‏לכתוב, כך שמסירה שה-Webhook אישר לפני פסק הזמן עדיין מעדכנת את
   * ‏`lastSentAt` ונספרת בתקרה (ביקורת Codex).
   */
  private async settle(tenantId: string, id: string, data: Settlement): Promise<boolean> {
    return this.prisma.withFunnelAdmin(async (tx) => {
      await tx.funnelMessage.updateMany({ where: { id, tenantId, status: "queued" }, data });
      const out = await tx.funnelMessage.count({
        where: { id, status: { in: [...FUNNEL_MESSAGE_OUT_STATUSES] } },
      });
      return out === 1;
    });
  }

  /**
   * ‎**תפיסות נטושות חוזרות לתור הניסיונות** (ביקורת Codex, P1).
   *
   * ‏תהליך שנפל בין `claim` להכרעה משאיר שורה `queued`, ו-`claim`
   * ‏מדלג עליה — השלב לא היה נשלח לנמען לעולם, והרישום היה נסגר
   * ‏כ„סיים את הרצף”. כאן היא הופכת ל-`failed` ונתפסת מחדש עם אותו
   * ‏מפתח אידמפוטנטיות: אם המייל בכל זאת יצא, שירות המייל יודע ואינו
   * ‏שולח שוב.
   */
  private async releaseStaleClaims(now: Date): Promise<void> {
    const released = await this.prisma.withFunnelAdmin((tx) =>
      tx.funnelMessage.updateMany({
        where: {
          track: "conversion",
          channel: "email",
          status: "queued",
          updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
        },
        data: { status: "failed", error: "השליחה נקטעה לפני שהוכרעה — תנוסה שוב" },
      }),
    );
    if (released.count > 0) {
      this.logger.warn(`מסלול ההמרה: ${released.count} שליחות שנקטעו יחזרו לתור`);
    }
  }
}
