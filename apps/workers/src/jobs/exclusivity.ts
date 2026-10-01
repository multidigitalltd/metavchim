import { ulid } from "ulid";
import {
  EXCLUSIVITY_WARNING_DAYS,
  EXCLUSIVITY_THIRD_WARNING_DAYS,
  MIN_MARKETING_ACTIONS,
  describeExclusivity,
  exclusivityState,
  type ExclusivitySubject,
  type MarketingActionKind,
} from "@metavchim/shared";
import { prisma } from "../runtime.js";

/**
 * סריקת הבלעדיויות — **המקום היחיד שבו כלל השליש מדבר.**
 *
 * סעיף 9(ב2) מסיים בלעדיות בתום שליש מהתקופה כשלא בוצעו פעולות
 * השיווק. זה קורה בשקט: אין אירוע, אין הודעה, ואיש לא נדרש לעשות
 * דבר — הבלעדיות פשוט כבר לא בתוקף. משרד מגלה את זה כשהמוכר מוכר
 * לבד, וזה מאוחר בחודשיים.
 *
 * הסריקה עושה שני דברים: **מתריעה לפני** מועד השליש כשחסרות פעולות,
 * ו**סוגרת** תקופה שהגיעה לסופה כדי שהמסך לא יציג בלעדיות שאיננה.
 *
 * כל אבן דרך מתריעה **פעם אחת בלבד**, לפי `type` ייחודי שמעוגן
 * במזהה התקופה — אחרת אותה הודעה הייתה חוזרת בכל שעה במשך שבועות,
 * וזו הדרך הבטוחה להרגיל את המשרד להתעלם.
 */
export async function processExclusivitySweep(): Promise<void> {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let closed = 0;
  let notified = 0;

  for (const tenant of tenants) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.propertyExclusivity.findMany({
        where: { tenantId: tenant.id, endedAt: null },
        take: 500,
      });
    });
    if (rows.length === 0) continue;

    for (const row of rows) {
      try {
        const result = await sweepOneExclusivity(tenant.id, row.id, now);
        if (result.closed) closed += 1;
        notified += result.notified;
      } catch (error: unknown) {
        console.error(`[exclusivity-sweep] ${row.id}: ${String(error)}`);
      }
    }
  }
  if (closed > 0 || notified > 0) {
    console.warn(
      `[exclusivity-sweep] ${closed} תקופות נסגרו, ${notified} התראות נשלחו`,
    );
  }
}

async function sweepOneExclusivity(
  tenantId: string,
  exclusivityId: string,
  now: Date,
): Promise<{ closed: boolean; notified: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const row = await tx.propertyExclusivity.findFirst({
      where: { id: exclusivityId, tenantId, endedAt: null },
    });
    if (!row) return { closed: false, notified: 0 };

    const actions = await tx.marketingAction.findMany({
      where: { exclusivityId, tenantId },
      select: { kind: true, performedAt: true, brokerCount: true },
    });
    const state = exclusivityState(
      {
        subject: row.subject as ExclusivitySubject,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        agreedCustomAction: row.agreedCustomAction,
      },
      actions.map((a) => ({
        kind: a.kind as MarketingActionKind,
        performedAt: a.performedAt,
        ...(a.brokerCount === null ? {} : { brokerCount: a.brokerCount }),
      })),
      now,
    );

    const owners = await tx.user.findMany({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    /** התראה אחת לכל אבן דרך, אי פעם. */
    const notifyOnce = async (
      type: string,
      title: string,
      body: string,
    ): Promise<number> => {
      const already = await tx.notification.findFirst({
        where: {
          tenantId,
          type,
          entityType: "exclusivity",
          entityId: exclusivityId,
        },
        select: { id: true },
      });
      if (already || owners.length === 0) return 0;
      for (const owner of owners) {
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            userId: owner.id,
            type,
            title,
            body,
            entityType: "exclusivity",
            entityId: exclusivityId,
          },
        });
      }
      return 1;
    };

    let notified = 0;

    if (state.phase === "ended_by_third_rule") {
      notified += await notifyOnce(
        "exclusivity_ended_third",
        "הבלעדיות הסתיימה במועד השליש",
        describeExclusivity(state),
      );
    } else if (state.phase === "expired") {
      notified += await notifyOnce(
        "exclusivity_expired",
        "תקופת הבלעדיות הסתיימה",
        describeExclusivity(state),
      );
    } else if (state.phase === "at_risk" && state.daysToThird !== null) {
      if (state.daysToThird <= EXCLUSIVITY_THIRD_WARNING_DAYS) {
        notified += await notifyOnce(
          "exclusivity_third_risk",
          `⚠️ הבלעדיות בסיכון — נותרו ${state.daysToThird} ימים`,
          `${describeExclusivity(state)} נדרשות ${MIN_MARKETING_ACTIONS} פעולות שיווק שונות; תועדו ${state.counted.length}.`,
        );
      }
    } else if (state.phase === "active") {
      /*
       * הסף הקטן ביותר שמתאים, ולא כל מי שגדול מ-`daysLeft`.
       * סריקה שרצה לראשונה כשנותרו חמישה ימים אמורה לשלוח הודעה
       * אחת ("נותר שבוע"), ולא גם את זו של שלושים היום שחלפו.
       */
      const threshold = EXCLUSIVITY_WARNING_DAYS.filter(
        (d) => state.daysLeft <= d,
      ).pop();
      // סף שגדול מהתקופה כולה אינו רלוונטי: בלעדיות של 30 יום לא
      // מתחילה בהודעה "נותרו 30 יום" ביום שנחתמה
      const spanDays = Math.round(
        (row.endsAt.getTime() - row.startsAt.getTime()) / 86_400_000,
      );
      if (threshold !== undefined && threshold < spanDays) {
        notified += await notifyOnce(
          `exclusivity_ending_${threshold}`,
          `הבלעדיות מסתיימת בעוד ${state.daysLeft} ימים`,
          `${describeExclusivity(state)} זה הזמן לדבר עם בעל הנכס על חידוש.`,
        );
      }
    }

    /*
     * סגירה אוטומטית — אבל רק על תקופה שהגיעה לסופה **בלוח השנה**.
     *
     * בלעדיות שכלל השליש סיים אינה נסגרת כאן בכוונה: זו מסקנה
     * משפטית שנויה במחלוקת אפשרית (המשרד עשוי לטעון שפעולה בוצעה
     * ולא תועדה), וסגירה אוטומטית שלה הייתה מוחקת מהמערכת בלעדיות
     * שאולי בתוקף. המערכת אומרת את מה שהיא רואה, ומשאירה את
     * ההכרעה לאדם.
     */
    let closedNow = false;
    if (now.getTime() >= row.endsAt.getTime()) {
      const changed = await tx.propertyExclusivity.updateMany({
        where: { id: exclusivityId, endedAt: null },
        data: { endedAt: now, endReason: "expired" },
      });
      if (changed.count > 0) {
        closedNow = true;
        await tx.property.updateMany({
          where: { id: row.propertyId, tenantId },
          data: { exclusive: false, exclusiveUntil: null },
        });
      }
    }

    return { closed: closedNow, notified };
  });
}
