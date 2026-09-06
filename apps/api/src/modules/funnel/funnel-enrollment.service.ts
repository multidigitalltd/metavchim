import { Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  FUNNEL_DEFAULT_DAILY_ENTRIES,
  FUNNEL_FRESH_SIGNUP_HOURS,
  funnelExitReason,
  hasValidCard,
  trialAnchorConcluded,
  jerusalemDayStart,
  jerusalemWallParts,
  type FunnelAnchors,
  type FunnelExitReason,
  type FunnelFacts,
  type FunnelTrack,
} from "@metavchim/shared";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
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

    return enrolled + (await this.enrollBacklog(now, dailyQuota, pageSize, freshFrom, eligible));
  }

  /**
   * ‎**הפיגור, ורק הוא, כפוף למכסה — והמכסה היא ליום, לא לסבב.**
   *
   * ‏זו לא קפדנות על שם משתנה. הסורק בשלב ב׳ ירוץ **כל שעה**, ואז
   * ‏`take: dailyQuota` בכל סבב פירושו עשרים וארבע מכסות ביום:
   * ‏הפיגור מתנקז ביממה אחת במקום בשבוע, וגל השליחה שכל הפריסה
   * ‏נועדה למנוע קורה בדיוק (ביקורת Codex). לכן נספר מה שכבר נכנס
   * ‏**היום** ונשלף רק ההפרש.
   *
   * ## ‎**ולמה כל זה בטרנזקציה אחת, מתחת לנעילה**
   *
   * ‏„ספור ואז קח” הוא בדיקה-ואז-פעולה. שני עותקים של ה-API שרצים
   * ‏במקביל: א׳ סופר 0 ומחשב 25 שנותרו, ב׳ מספיק לרשום 25 ולסיים,
   * ‏ואז השאילתה של א׳ **מדלגת** על אותם 25 (הם כבר רשומים) ורושמת
   * ‏את ה-25 הבאים. חמישים ביום, כלומר בדיוק גל השליחה שהמכסה
   * ‏קיימת כדי למנוע (ביקורת Codex, P1). המכסה שנשמרת במסד אינה
   * ‏מספיקה — צריך שהספירה, השליפה והכתיבה יהיו פעולה אחת.
   *
   * ‎`pg_try_advisory_xact_lock` ולא `pg_advisory_xact_lock`: אם
   * ‏עותק אחר מוציא את המכסה ברגע זה, **הדבר הנכון הוא לא לחכות
   * לו** אלא לוותר על הפיגור בסבב הזה. המתנה הייתה מחזיקה טרנזקציה
   * ‏פתוחה עד הפסקת זמן, והתוצאה אחרי ההמתנה זהה בלאו הכי: אפס
   * ‏שנותרו. המפתח נושא את היום, כי זה בדיוק מה שמחולק.
   */
  private async enrollBacklog(
    now: Date,
    dailyQuota: number,
    pageSize: number,
    freshFrom: Date,
    eligible: Record<string, unknown>,
  ): Promise<number> {
    const lockKey = `funnel-backlog:${jerusalemWallParts(now).date}`;
    return this.prisma.withFunnelAdmin(async (tx) => {
      const [lock] = await tx.$queryRaw<{ taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS taken
      `;
      if (lock?.taken !== true) return 0;

      const remaining = dailyQuota - (await this.backlogEnrolledToday(tx, now));
      if (remaining <= 0) return 0;

      /*
       * ‎**מי שכבר יש לו כרטיס תקף אינו צורך מקום במכסה.**
       *
       * ‏`status: "trial"` אינו אומר „לא שילם”: משרד בניסיון ששכר
       * ‏מספר שילם, והכרטיס נשמר בלי שהסטטוס השתנה. הוא היה נכנס,
       * ‏תופס מקום, ו-`closeFinished` היה סוגר אותו כ-`paid` באותו
       * ‏סבב עצמו. אם `dailyQuota` הוותיקים כולם כאלה — אף מועמד
       * ‏אמיתי לא נכנס באותו יום, והפריסה נתקעת (ביקורת Codex).
       *
       * ‏הסינון אינו יכול לעבור לשאילתה: „כרטיס תקף” כולל תפוגה
       * ‏שנשענת על שתי עמודות מספריות, ו„יש טוקן כרטיס” אינו אותו
       * ‏דבר — משרד עם כרטיס **שפג** הוא בדיוק מועמד שצריך להיכנס.
       * ‏לכן דפדוף עם סמן עד שהמכסה מתמלאת, ולא `take` שמתחזה
       * ‏לתקרת עבודה: זו הייתה הטעות בשלוש הביקורות הראשונות.
       */
      let enrolled = 0;
      let cursor: string | undefined;
      while (enrolled < remaining) {
        const page = await tx.tenant.findMany({
          where: { ...eligible, createdAt: { lt: freshFrom } },
          select: { id: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: pageSize,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1]!.id;

        const cards = await tx.subscription.findMany({
          where: { tenantId: { in: page.map((t) => t.id) } },
          select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
        });
        const cardById = new Map(cards.map((c) => [c.tenantId, c]));

        for (const tenant of page) {
          if (hasValidCard(cardById.get(tenant.id) ?? null, now)) continue;
          await this.open(tenant.id, "conversion", now, tx);
          enrolled += 1;
          if (enrolled >= remaining) break;
        }
      }
      return enrolled;
    });
  }

  /**
   * ‎**כמה משרדי פיגור כבר נכנסו היום.**
   *
   * ## ‏למה זה נגזר ולא נשמר בעמודה
   *
   * ‏„נכנס מהפיגור” אינו מצב חדש — הוא **יחס בין שני תאריכים
   * ‏שכבר קיימים**: המשרד נחשב פיגור אם ברגע הכניסה הוא כבר לא היה
   * ‏טרי, כלומר `createdAt < startedAt − חלון הטריות`. עמודה נוספת
   * ‏הייתה עותק שני של אותה עובדה, ועותק שני יכול לסטות.
   *
   * ## ‏למה גם מי שכבר יצא נספר
   *
   * ‏אין סינון על `endedAt`: משרד שנכנס הבוקר ושילם בצהריים **צרך
   * ‏את המקום** וקיבל את ההודעה הראשונה. אילו סגירה הייתה מפנה מקום,
   * ‏יום עם המרות מהירות היה מכניס פי כמה — בדיוק ההפך מהכוונה.
   *
   * ‏היום הוא יום ירושלים, כמו שעות השקט — ולא UTC, שהיה מאפס את
   * ‏המכסה בשתיים בלילה באמצע הערב שלנו.
   */
  private async backlogEnrolledToday(tx: TenantTx, now: Date): Promise<number> {
    const dayStart = jerusalemDayStart(now);
    const today = await tx.funnelEnrollment.findMany({
      where: { track: "conversion", startedAt: { gte: dayStart } },
      select: { tenantId: true, startedAt: true },
    });
    if (today.length === 0) return 0;

    const tenants = await tx.tenant.findMany({
      where: { id: { in: today.map((row) => row.tenantId) } },
      select: { id: true, createdAt: true },
    });
    const createdById = new Map(tenants.map((tenant) => [tenant.id, tenant.createdAt]));
    const freshMs = FUNNEL_FRESH_SIGNUP_HOURS * 60 * 60 * 1000;
    return today.filter((row) => {
      const createdAt = createdById.get(row.tenantId);
      if (createdAt === undefined) return false;
      return createdAt.getTime() < row.startedAt.getTime() - freshMs;
    }).length;
  }

  /**
   * ‏פתיחת רישום — או `false` כשכבר יש אחד.
   *
   * ‏המרוץ נחסם במסד ולא כאן: האינדקס החלקי על `(tenant_id, track)
   * WHERE ended_at IS NULL` הופך רישום חי שני לבלתי אפשרי, וגם שני
   * עותקים של הסורק שרצים באותו רגע ייצרו אחד. התפיסה בקוד הייתה
   * ‏„קרא ואז כתוב” — בדיוק המרוץ שההמרה בנכסים לגיוס לימדה עליו.
   */
  async open(tenantId: string, track: FunnelTrack, now: Date, tx?: TenantTx): Promise<boolean> {
    const write = (t: TenantTx): Promise<unknown> =>
      t.funnelEnrollment.create({
        data: { id: ulid(), tenantId, track, startedAt: now },
      });

    /*
     * ‎**בתוך טרנזקציה של הקורא — התנגשות **חייבת** להתפוצץ.**
     *
     * ‏ב-PostgreSQL הפרת ייחודיות פוסלת את כל הטרנזקציה. בליעה כאן
     * ‏הייתה מחזירה `false` ומשאירה את הקורא ממשיך לכתוב לתוך
     * ‏טרנזקציה מתה — כלומר „נרשמו 24” על אפס שורות. הזריקה מגלגלת
     * ‏את הסבב כולו, והסבב הבא חוזר עליו.
     */
    if (tx !== undefined) {
      await write(tx);
      return true;
    }

    try {
      await this.prisma.withFunnelAdmin(write);
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
    /*
     * ‎**גם הפסולים, ולא רק התקפים.**
     *
     * ‏שורת שלב שלא הצלחנו לקרוא נעדרת מ-`stages`, ואז „לא נשאר
     * ‏שלב שיכול לצאת” נכון על מה שקראנו בלבד. סגירה היא בלתי
     * ‏הפיכה — `enrollDue` מוציא מהמועמדות כל מי שכבר היה לו רישום
     * ‏— ולכן אין סוגרים כל עוד ההגדרה חסרה (ביקורת Codex, P1).
     */
    const { stages, invalid } = await this.stages.catalog();
    if (invalid.length > 0) {
      this.logger.warn(
        `הגדרות שלבים פסולות (${invalid.join(", ")}) — רישומים לא ייסגרו כ„מוצו” עד שיתוקנו`,
      );
    }
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
      closed += await this.closePage(page, stages, invalid.length > 0, now);
      if (page.length < pageSize) break;
    }
    return closed;
  }

  /** ‏סגירת מה שסיים בתוך דף אחד. */
  private async closePage(
    live: { id: string; tenantId: string; track: string; startedAt: Date }[],
    stages: Awaited<ReturnType<FunnelStageService["all"]>>,
    definitionsIncomplete: boolean,
    now: Date,
  ): Promise<number> {
    const tenantIds = [...new Set(live.map((row) => row.tenantId))];
    const [tenants, subscriptions, sentRows] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        /*
         * ‎`trialConcludedAt` אינו קישוט: `trialEndsAt` ריק נקרא
         * ‏אחרת לגמרי כשהניסיון **נגמר** מכשהערך **חסר**, והעמודה
         * ‏הזו היא מה שמבדיל ביניהם (`trialAnchorConcluded`) — סיבה
         * ‏שנרשמה, ולא ניחוש משאר השורה.
         */
        select: { id: true, trialEndsAt: true, trialConcludedAt: true },
      }),
      this.prisma.subscription.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
      }),
      this.prisma.withFunnelAdmin((tx) =>
        /*
         * ‎**„נשלח” הוא `sent`, ולא „יש שורה”.**
         *
         * ‏ברירת המחדל של העמודה היא `queued`, ויש גם `failed`.
         * ‏שורה כזו נספרה כשלב שיצא, ולכן ניסיון אחרון שנכשל היה
         * ‏סוגר את הרישום כ„מוצה” בלי שההודעה נשלחה — וניסיון חוזר
         * ‏לא היה מגיע אליו לעולם (ביקורת Codex).
         *
         * ‎`sentAt` **וגם** `status`: השדות נכתבים יחד, ובדיקה של
         * ‏אחד מהם בלבד הופכת כל אי-התאמה ביניהם לסגירה שגויה
         * ‏בכיוון אחד.
         */
        tx.funnelMessage.findMany({
          where: {
            enrollmentId: { in: live.map((row) => row.id) },
            status: "sent",
            sentAt: { not: null },
          },
          select: { enrollmentId: true, stageKey: true },
        }),
      ),
    ]);
    /*
     * ‎**שורת הדייר כולה, ולא שדה לכל מפה.**
     *
     * ‏שלוש המפות שהיו כאן חייבו ברירת מחדל לכל אחת בנפרד, ואז
     * ‏„הדייר לא נמצא” היה שלוש הכרעות שקטות שאפשר לענות עליהן
     * ‏אחרת. שורה אחת חסרה היא מקרה **אחד**, והוא נענה למטה במפורש.
     */
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
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
      /*
       * ‎**דייר שאינו בשליפה — דילוג רועש, ולא ניחוש שקט.**
       *
       * ‏השליפות אינן בטרנזקציה אחת, ולכן מחיקה שקרתה ביניהן מגיעה
       * ‏לכאן כשורה חסרה. כל ברירת מחדל כאן היא המצאה: „אין ניסיון”
       * ‏היה סוגר את הרישום על סמך כלום, ו„יש ניסיון” היה משאיר אותו
       * ‏פתוח על סמך כלום. הדילוג משאיר את ההחלטה לסבב הבא, שבו
       * ‏השורה או תהיה או שהרישום כבר לא יהיה.
       */
      const tenant = tenantById.get(row.tenantId);
      if (tenant === undefined) {
        this.logger.warn(`רישום ${row.id}: שורת הדייר לא נמצאה — לא נסגר`);
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
        trialActive: isTrialActive(tenant.trialEndsAt, now),
        chargeFailing: track === "dunning",
      };
      const anchors: FunnelAnchors = {
        funnelStartedAt: row.startedAt,
        trialEndsAt: tenant.trialEndsAt,
        trialConcluded: trialAnchorConcluded(tenant),
        paymentFailedAt: track === "dunning" ? row.startedAt : null,
      };
      const reason = funnelExitReason({
        track,
        facts,
        stages,
        definitionsIncomplete,
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
   * ‎**ניסיון שהוחזר פותח מחדש את הרישום שנסגר — ולא פותח חדש.**
   *
   * ## ‏הבעיה
   *
   * ‏משרד שעבר למסלול חינמי סוגר את רישומו כ„מוצה” אחרי ששלבי שעון
   * ‏המשפך פגו. מנהל פלטפורמה יכול להחזיר אותו לניסיון אמיתי
   * ‏(`PATCH billing-override` עם תאריך), ואז יש לו שוב תפוגה
   * ‏שאפשר להזהיר מפניה — אבל `enrollDue` מוציא מהמועמדות כל מי
   * ‏שאי פעם היה לו רישום, ולכן הוא לא היה מקבל דבר (ביקורת Codex).
   *
   * ## ‎**ולמה פתיחה מחדש ולא כניסה חדשה**
   *
   * ‏`startedAt` נשאר כשהיה, וזה בדיוק הרצוי: המשרד **כבר קיבל**
   * ‏את תוכן ההפעלה של ימים 0–17, ושלביו פגו מזמן. מה שחסר לו הוא
   * ‏שלבי הניסיון, והם מחושבים מהתאריך החדש. כניסה חדשה הייתה
   * ‏מגישה לו את „הוסיפו נכס ראשון” בפעם השנייה.
   *
   * ## ‏רק „מוצה”
   *
   * ‏`opted_out` הוא בקשה מפורשת להפסיק, ופתיחה מחדש הייתה מבטלת
   * ‏אותה. `paid` ייסגר שוב מיד בסבב הבא ממילא. רק רישום שנסגר כי
   * ‏„לא נשאר מה לשלוח” נפתח כשיש שוב מה.
   *
   * ‏האינדקס החלקי מתיר רישום חי אחד למסלול, ולכן קיים רישום פתוח
   * ‏עוצר — אין מה לפתוח, ויש כבר אחד שעובד.
   */
  async reopenForRestoredTrial(tenantId: string): Promise<boolean> {
    return this.prisma.withFunnelAdmin(async (tx) => {
      const open = await tx.funnelEnrollment.findFirst({
        where: { tenantId, track: "conversion", endedAt: null },
        select: { id: true },
      });
      if (open !== null) return false;
      const closed = await tx.funnelEnrollment.findFirst({
        where: { tenantId, track: "conversion", endedReason: "completed" },
        orderBy: { endedAt: "desc" },
        select: { id: true },
      });
      if (closed === null) return false;
      /*
       * ‎`endedAt: { not: null }` ב-`where` ולא רק במזהה: בין
       * ‏השליפה לכתיבה סבב אחר יכול לפתוח רישום, ואז שתי שורות
       * ‏פתוחות מפרות את האינדקס החלקי.
       */
      const updated = await tx.funnelEnrollment.updateMany({
        where: { id: closed.id, endedAt: { not: null } },
        data: { endedAt: null, endedReason: null },
      });
      if (updated.count > 0) {
        this.logger.log(`רישום ${closed.id} נפתח מחדש — הניסיון של המשרד הוחזר`);
      }
      return updated.count > 0;
    });
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
