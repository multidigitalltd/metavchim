import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  FUNNEL_DEFAULT_DAILY_ENTRIES,
  FUNNEL_FRESH_SIGNUP_HOURS,
  funnelExitReason,
  hasValidCard,
  type FunnelAnchors,
  type FunnelExitReason,
  type FunnelFacts,
  type FunnelTrack,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import { FunnelStageService } from "./funnel-stage.service";

/** ‏כמה מועמדים נשלפים בכל דף. תקרת שאילתה, לא תקרת טיפול. */
const PAGE = 200;

/**
 * ‎**מי במסלול, מאיזה יום 0, ומתי הוא יוצא.**
 *
 * ## ‏ההחלטה שהשירות הזה מממש
 *
 * ‏„עדיף שיהיה לאט לאט לכל משרד מהיום שהתחיל המשפך.” כלומר: אין
 * ‏„כניסה בנקודה” לפי ותק ההרשמה. לכל משרד יש `startedAt` משלו,
 * והוא הולך משם — יום 0, יום 1, יום 3 — בקצב המלא.
 *
 * ‏`startedAt` הוא **רגע הכניסה**, לא `createdAt` של המשרד. משרד
 * שנרשם לפני עשרה ימים ונכנס היום מתחיל היום ביום 0. זה כל ההבדל
 * בין התוכנית הקודמת לזו.
 *
 * ## ‏„לאט לאט” חל גם על הקבוצה
 *
 * ‏אילו כל המשרדים הקיימים היו מתחילים ביום 0 באותו בוקר, כולם היו
 * מקבלים את ההודעה הראשונה באותו בוקר — וזה בדיוק גל השליחה שמספר
 * וואטסאפ יחיד לא סובל. `enrollDue` מפזר את הפיגור במנות יומיות,
 * ומכניס הרשמות טריות מיד כדי שהן לא ייתקעו מאחוריו.
 *
 * ## ‎**השירות הזה אינו שולח דבר**
 *
 * ‏הוא פותח וסוגר רישומים בלבד. בחירת ההודעה והשליחה הן שלב ב׳,
 * ‏ושער מבני (`funnel-no-send.test.ts`) אוכף שזה נשאר כך: קובץ
 * במודול הזה שיקרא ל-`EmailService` או לשליחת וואטסאפ מפיל את CI.
 */
@Injectable()
export class FunnelEnrollmentService {
  private readonly logger = new Logger(FunnelEnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: FunnelStageService,
  ) {}

  /**
   * ‏סבב אחד: מכניס את מי שתורו הגיע, וסוגר את מי שסיים.
   *
   * ‏ציבורי כדי שאפשר יהיה להריץ אותו מול מסד אמיתי בבדיקה, בלי
   * לחכות לטיימר. הטיימר עצמו נוסף בשלב ב׳, יחד עם השליחה — כרגע
   * אין מה להריץ במחזוריות.
   */
  async sweep(
    now: Date,
    options: { dailyQuota?: number; pageSize?: number } = {},
  ): Promise<{ enrolled: number; closed: number }> {
    const dailyQuota = options.dailyQuota ?? FUNNEL_DEFAULT_DAILY_ENTRIES;
    const pageSize = options.pageSize ?? PAGE;
    const enrolled = await this.enrollDue(now, dailyQuota, pageSize);
    const closed = await this.closeFinished(now, pageSize);
    if (enrolled > 0 || closed > 0) {
      this.logger.log(`מסלול ההמרה: ${enrolled} נכנסו, ${closed} נסגרו`);
    }
    return { enrolled, closed };
  }

  /**
   * ‎**הכנסה למשפך ההמרה.**
   *
   * ‏מועמד = משרד בניסיון שאין לו רישום במסלול הזה **ומעולם לא היה
   * לו אחד**. השני אינו מיותר: משרד שסיים את המשפך (או שילם ויצא)
   * אינו אמור להיכנס שוב בסבב הבא ולקבל את „יום 0” מחדש.
   *
   * ## ‎**ההוצאה נעשית בשאילתה, ולא אחרי השליפה**
   *
   * ‏הגרסה הראשונה שלפה 200 משרדים ואז סיננה מהם את מי שכבר רשום.
   * ‏ברגע ש-200 הוותיקים ביותר נכנסו, כל סבב שלף שוב בדיוק אותם,
   * הסינון ריקן את הרשימה, והפונקציה חזרה עם 0 — **והמשפך הפסיק
   * לקלוט לנצח**, כולל הרשמות טריות שאמורות לעקוף כל מכסה
   * (ביקורת Codex, P1). `take` הוא גודל דף, לא תקרת עבודה.
   *
   * ## ‏שתי שאילתות ולא אחת
   *
   * ‏הכלל אומר „טריים מיד, ותיקים לפי מכסה”, ומיון אחד אינו יכול
   * לשרת את שניהם: הסדר שמשרת „ותיקים ראשונים” דוחק הרשמה טרייה
   * אל מעבר לדף. לכן כל קבוצה נשלפת בסדר שלה ובתקרה שלה — הטריים
   * ‏בלי תקרה כלל, והפיגור לפי המכסה.
   */
  private async enrollDue(now: Date, dailyQuota: number, pageSize: number): Promise<number> {
    /*
     * ‏משרד ללא תפוגת ניסיון הוקם ידנית — הוא אינו במסלול מכירה,
     * ואינו אמור לקבל „נשארו יומיים” על תקופה שאין לה סוף.
     *
     * ‎`funnelEnrollments: { none: … }` הוא מה שהופך את זה לנכון בכל
     * גודל קטלוג. הוא מחייב את השאילתה לרוץ בתוך `withFunnelAdmin`:
     * ‏`funnel_enrollments` תחת RLS, ובלי הדגל הצירוף לא היה רואה
     * אף שורה — כלומר **כולם** היו נראים כמי שטרם נרשמו.
     */
    const eligible = {
      status: "trial",
      trialEndsAt: { not: null },
      funnelEnrollments: { none: { track: "conversion" } },
    } as const;
    const freshFrom = new Date(now.getTime() - FUNNEL_FRESH_SIGNUP_HOURS * 60 * 60 * 1000);

    /*
     * ‎**הטריים: כולם, בלי תקרה.**
     *
     * ‎`take` בלי המשך היה משאיר את מי שמעבר לדף לסבב הבא, ובזרם
     * ‏מתמשך הם היו מזדקנים אל תוך הפיגור שמוגבל במכסה — כלומר
     * ‏מאבדים בדיוק את המעקף שנועד להם (ביקורת Codex).
     *
     * ‏הלולאה נעצרת מאליה: משרד שנרשם יוצא מ-`none` ולכן אינו חוזר
     * ‏בדף הבא. הבלימה על „דף בלי קליטה” היא נגד לולאה אינסופית אם
     * ‏שורה אינה ניתנת לתפיסה (מרוץ מול עותק אחר).
     *
     * ‏המיון `asc` אינו משפיע על התוצאה כל עוד הלולאה רצה עד הסוף —
     * ‏כולם נכנסים ממילא. הוא נשאר כהגנה על **המסלול היחיד שבו כן
     * ‏יש חיתוך**: אם הבלימה נתפסת, מי שקרוב לצאת מחלון הטריות הוא
     * ‏שכבר נכנס. `desc` היה מרעיב דווקא אותו.
     */
    let enrolled = 0;
    for (;;) {
      const page = await this.prisma.withFunnelAdmin((tx) =>
        tx.tenant.findMany({
          where: { ...eligible, createdAt: { gte: freshFrom } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: pageSize,
        }),
      );
      if (page.length === 0) break;
      const before = enrolled;
      for (const tenant of page) {
        /*
         * ‎**`startedAt` הוא `now`, ולא `tenant.createdAt`.**
         *
         * ‏זו ההחלטה עצמה בשורה אחת. `createdAt` היה מחזיר בדיוק את
         * ‏„הכניסה בנקודה” שנדחתה: משרד בן עשרה ימים היה מתחיל ביום
         * ‏10 ומפספס את כל תוכן ההפעלה.
         */
        if (await this.open(tenant.id, "conversion", now)) enrolled += 1;
      }
      if (enrolled === before) break;
    }

    /*
     * ‏הפיגור, ורק הוא, כפוף למכסה — זה כל תפקידה: לפרוס את הקבוצה
     * שהצטברה על פני כשבוע, ולא לחנוק את הקצב הרגיל.
     */
    if (dailyQuota > 0) {
      const backlog = await this.prisma.withFunnelAdmin((tx) =>
        tx.tenant.findMany({
          where: { ...eligible, createdAt: { lt: freshFrom } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: dailyQuota,
        }),
      );
      for (const tenant of backlog) {
        if (await this.open(tenant.id, "conversion", now)) enrolled += 1;
      }
    }
    return enrolled;
  }

  /**
   * ‏פתיחת רישום — או `false` כשכבר יש אחד.
   *
   * ‏המרוץ נחסם במסד ולא כאן: האינדקס החלקי על `(tenant_id, track)
   * WHERE ended_at IS NULL` הופך רישום חי שני לבלתי אפשרי, וגם שני
   * עותקים של הסורק שרצים באותו רגע ייצרו אחד. התפיסה בקוד הייתה
   * ‏„קרא ואז כתוב” — בדיוק המרוץ שההמרה בנכסים לגיוס לימדה עליו.
   */
  async open(tenantId: string, track: FunnelTrack, now: Date): Promise<boolean> {
    try {
      await this.prisma.withFunnelAdmin((tx) =>
        tx.funnelEnrollment.create({
          data: { id: ulid(), tenantId, track, startedAt: now },
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * ‎**סגירת מי שסיים** — שילם, מיצה את הרצף, או שהחיוב נפרע.
   *
   * ‏הסגירה אינה קוסמטית: רישום פתוח הוא מה שהסורק בשלב ב׳ יעבור
   * עליו בכל סבב. משרד ששילם ונשאר פתוח היה נבדק שוב ושוב, ובעיקר
   * — טעות אחת בתנאי השליחה הייתה שולחת לו „נשארו יומיים” אחרי
   * שכבר שילם.
   */
  private async closeFinished(now: Date, pageSize: number): Promise<number> {
    const stages = await this.stages.all();
    let closed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.withFunnelAdmin((tx) =>
        tx.funnelEnrollment.findMany({
          where: { endedAt: null },
          select: { id: true, tenantId: true, track: true, startedAt: true },
          /*
           * ‎**סמן, ולא `take` שמתחזה לתקרת עבודה.**
           *
           * ‏מיון לפי `startedAt` עם `take: 200` קרא בכל סבב בדיוק
           * את אותם 200 הרישומים הישנים. כל עוד הם פתוחים — וכולם
           * פתוחים, כי כל השלבים נזרעו כבויים — אף רישום מאוחר לא
           * נבדק, ומשרד שהזין כרטיס לא היה נסגר לעולם (ביקורת
           * Codex). המיון לפי `id` כי עליו יושב הסמן.
           */
          orderBy: { id: "asc" },
          take: pageSize,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        }),
      );
      if (page.length === 0) break;
      cursor = page[page.length - 1]?.id;
      closed += await this.closePage(page, stages, now);
      if (page.length < pageSize) break;
    }
    return closed;
  }

  /** ‏סגירת מה שסיים בתוך דף אחד. */
  private async closePage(
    live: { id: string; tenantId: string; track: string; startedAt: Date }[],
    stages: Awaited<ReturnType<FunnelStageService["all"]>>,
    now: Date,
  ): Promise<number> {
    const tenantIds = [...new Set(live.map((row) => row.tenantId))];
    const [tenants, subscriptions, sentRows] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, trialEndsAt: true },
      }),
      this.prisma.subscription.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
      }),
      this.prisma.withFunnelAdmin((tx) =>
        tx.funnelMessage.findMany({
          where: { enrollmentId: { in: live.map((row) => row.id) } },
          select: { enrollmentId: true, stageKey: true },
        }),
      ),
    ]);
    const trialById = new Map(tenants.map((t) => [t.id, t.trialEndsAt]));
    const cardById = new Map(subscriptions.map((s) => [s.tenantId, s]));
    const sentByEnrollment = new Map<string, string[]>();
    for (const row of sentRows) {
      const keys = sentByEnrollment.get(row.enrollmentId) ?? [];
      keys.push(row.stageKey);
      sentByEnrollment.set(row.enrollmentId, keys);
    }

    let closed = 0;
    for (const row of live) {
      const track = row.track;
      if (track !== "conversion" && track !== "dunning") {
        this.logger.warn(`רישום ${row.id}: מסלול לא מוכר (${track}) — לא נסגר`);
        continue;
      }
      const card = hasValidCard(cardById.get(row.tenantId) ?? null, now);
      /*
       * ‎`chargeFailing` נשען על הרישום עצמו ולא על שאילתה נוספת:
       * ‏רישום גבייה **פתוח** פירושו שהחיוב טרם נפרע. מי שסוגר אותו
       * הוא מי שראה תשלום מוצלח — וזה נכנס בשלב ב׳, יחד עם החיבור
       * ל-`RenewalService`. עד אז אין רישומי גבייה כלל.
       */
      const facts: FunnelFacts = {
        hasProperties: false,
        hasData: false,
        nextStepPending: false,
        featureUnused: false,
        hasValidCard: card,
        trialActive: isTrialActive(trialById.get(row.tenantId) ?? null, now),
        chargeFailing: track === "dunning",
      };
      const anchors: FunnelAnchors = {
        funnelStartedAt: row.startedAt,
        trialEndsAt: trialById.get(row.tenantId) ?? null,
        paymentFailedAt: track === "dunning" ? row.startedAt : null,
      };
      const reason = funnelExitReason({
        track,
        facts,
        stages,
        sent: sentByEnrollment.get(row.id) ?? [],
        anchors,
        now,
      });
      if (reason === null) continue;
      if (await this.close(row.id, reason, now)) closed += 1;
    }
    return closed;
  }

  /**
   * ‏סגירה מותנית — רק רישום שעדיין פתוח.
   *
   * ‏`endedAt: null` ב-`where` אינו נימוס: בלעדיו סבב שני היה דורס
   * את סיבת הסגירה הראשונה, ו„שילם” היה הופך ל„מיצה את הרצף” בלי
   * שדבר קרה.
   */
  async close(id: string, reason: FunnelExitReason, now: Date): Promise<boolean> {
    const updated = await this.prisma.withFunnelAdmin((tx) =>
      tx.funnelEnrollment.updateMany({
        where: { id, endedAt: null },
        data: { endedAt: now, endedReason: reason },
      }),
    );
    return updated.count > 0;
  }
}

/** ‏הניסיון עדיין בתוקף. משרד בלי תפוגה אינו „בניסיון פעיל”. */
function isTrialActive(trialEndsAt: Date | null, now: Date): boolean {
  return trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();
}

/** ‏התנגשות על אינדקס ייחודי — P2002 ב-Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}
