import { Injectable } from "@nestjs/common";
import { PrismaService, type TenantTx } from "../../core/prisma.service";

/** ‏שורת מדדים לשלב אחד, במייל. */
export interface FunnelStageStats {
  key: string;
  title: string;
  enabled: boolean;
  /** ‏יצאו מאיתנו — כולל מה שחזר מהשרת של הנמען */
  sent: number;
  /** ‏השרת של הנמען אישר קבלה (Webhook המסירה של Postmark) */
  delivered: number;
  /** ‏חזרו — כתובת שגויה או תיבה מלאה */
  bounced: number;
  /** ‏לא יצאו — הספק דחה או לא היה זמין; ייתכן ניסיון נוסף */
  failed: number;
  /** ‏הפיקסל נטען — הערכה בלבד */
  opened: number;
  clicked: number;
}

export interface FunnelStats {
  stages: FunnelStageStats[];
  enrollments: { live: number; paid: number; completed: number; optedOut: number };
}

/**
 * ‎**הודעה יצאה — המרווח עד הבאה נמדד ממנה.** מתקדם בלבד: רגע מוקדם
 * ‏יותר (Webhook באיחור) אינו מחזיר את `lastSentAt` אחורה. אחד להכרעת
 * ‏השליחה ול-Webhook, תמיד באותה טרנזקציה שקבעה שההודעה יצאה.
 */
export async function advanceLastSentAt(
  tx: TenantTx,
  enrollmentId: string,
  at: Date,
): Promise<void> {
  await tx.funnelEnrollment.updateMany({
    where: { id: enrollmentId, OR: [{ lastSentAt: null }, { lastSentAt: { lt: at } }] },
    data: { lastSentAt: at },
  });
}

/**
 * ‎**מה קרה להודעות המסלול — המסירה מהספק, והמדדים למסך.**
 *
 * ‏כל הקריאות חוצות-דיירים („כמה נפתחו בשלב 3”), ולכן תחת
 * ‏`withFunnelAdmin` — אותה פוליסה של המנוע, על שתי הטבלאות שלו בלבד.
 */
@Injectable()
export class FunnelReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ‎**אירוע מסירה מהספק.** `delivered` נרשם פעם אחת; `bounced` מסמן
   * ‏את ההודעה כחוזרת — היא יצאה, ולכן אינה נשלחת שוב (ראו
   * ‏`FUNNEL_MESSAGE_OUT_STATUSES`). חזרה שמגיעה אחרי מסירה אינה
   * ‏מבטלת אותה.
   */
  async recordEmailEvent(
    messageId: string,
    event: { kind: "delivered" | "bounced"; at: Date; detail?: string },
  ): Promise<void> {
    await this.prisma.withFunnelAdmin(async (tx) => {
      /*
       * ‎**אישור מהספק הוא הוכחה שההודעה יצאה** (ביקורת Codex). שליחה
       * ‏שנגמרה בכישלון עמום (פסק זמן, 5xx) נרשמה `failed` בלי `sentAt`,
       * ‏והספק בכל זאת מסר. בלי התיקון כאן היא הייתה גם „נמסרה” וגם
       * ‏„נכשלה”, ולא הייתה נספרת בהיסטוריית השלבים — והשלב היה נשלח שוב.
       */
      const unrecorded = await tx.funnelMessage.findFirst({
        where: { id: messageId, channel: "email", sentAt: null },
        select: { enrollmentId: true },
      });
      if (unrecorded !== null) {
        await tx.funnelMessage.updateMany({
          where: { id: messageId, sentAt: null },
          data: { sentAt: event.at },
        });
        /*
         * ‏וגם הרישום: המרווח המזערי עד ההודעה הבאה נמדד מ-`lastSentAt`,
         * ‏ושליחה שאצלנו נרשמה ככושלת לא עדכנה אותו — השלב הבא, אולי
         * ‏בשעון השני, היה יוצא בלי 20 השעות (ביקורת Codex).
         */
        await advanceLastSentAt(tx, unrecorded.enrollmentId, event.at);
      }
      if (event.kind === "bounced") {
        await tx.funnelMessage.updateMany({
          where: { id: messageId, channel: "email", deliveredAt: null },
          data: { status: "bounced", error: (event.detail ?? "המייל חזר").slice(0, 300) },
        });
        return;
      }
      /*
       * ‏והמסירה גוברת גם על חזרה זמנית (תיבה מלאה) שהספק ניסה שוב
       * ‏והצליח: המדד אומר מה קרה בסוף.
       */
      await tx.funnelMessage.updateMany({
        where: { id: messageId, channel: "email", deliveredAt: null },
        data: { deliveredAt: event.at },
      });
      await tx.funnelMessage.updateMany({
        where: { id: messageId, channel: "email", status: { not: "sent" } },
        data: { status: "sent", error: null },
      });
    });
  }

  async stats(): Promise<FunnelStats> {
    const stages = await this.prisma.funnelStage.findMany({
      where: { track: "conversion" },
      orderBy: { sortOrder: "asc" },
      select: { key: true, title: true, enabled: true },
    });
    const [counts, outcomes] = await this.prisma.withFunnelAdmin((tx) =>
      Promise.all([
        tx.$queryRaw<
          {
            stage_key: string;
            sent: bigint;
            delivered: bigint;
            bounced: bigint;
            failed: bigint;
            opened: bigint;
            clicked: bigint;
          }[]
        >`
          SELECT stage_key,
                 count(*) FILTER (WHERE status IN ('sent', 'bounced')) AS sent,
                 count(delivered_at) AS delivered,
                 count(*) FILTER (WHERE status = 'bounced') AS bounced,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 count(opened_at) AS opened,
                 count(clicked_at) AS clicked
            FROM funnel_messages
           WHERE track = 'conversion' AND channel = 'email'
           GROUP BY stage_key`,
        tx.$queryRaw<{ reason: string | null; n: bigint }[]>`
          SELECT CASE WHEN ended_at IS NULL THEN NULL ELSE ended_reason END AS reason,
                 count(*) AS n
            FROM funnel_enrollments
           WHERE track = 'conversion'
           GROUP BY 1`,
      ]),
    );
    const byKey = new Map(counts.map((row) => [row.stage_key, row]));
    const outcome = (reason: string | null): number =>
      Number(outcomes.find((row) => row.reason === reason)?.n ?? 0);
    return {
      stages: stages.map((stage) => {
        const row = byKey.get(stage.key);
        return {
          ...stage,
          sent: Number(row?.sent ?? 0),
          delivered: Number(row?.delivered ?? 0),
          bounced: Number(row?.bounced ?? 0),
          failed: Number(row?.failed ?? 0),
          opened: Number(row?.opened ?? 0),
          clicked: Number(row?.clicked ?? 0),
        };
      }),
      enrollments: {
        live: outcome(null),
        paid: outcome("paid"),
        completed: outcome("completed"),
        optedOut: outcome("opted_out"),
      },
    };
  }
}
