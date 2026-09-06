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
import { lockTenantSubscription } from "../../common/locks";
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
    /*
     * ‎**קודם פתיחה מחדש, ואז כניסה** — כי השתיים מתחרות על אותם
     * ‏משרדים: `enrollDue` מוציא מי שכבר היה לו רישום, ולכן משרד
     * ‏שמגיע לו רישום שנפתח מחדש לא היה מקבל דבר אם הכניסה רצה
     * ‏ראשונה. הסגירה נשארת אחרונה: היא זו שמכריעה על מה שקיים.
     */
    const reopened = await this.reopenLapsed(now, pageSize);
    const enrolled = await this.enrollDue(now, dailyQuota, pageSize);
    const closed = await this.closeFinished(now, pageSize);
    if (enrolled > 0 || closed > 0 || reopened > 0) {
      this.logger.log(
        `מסלול ההמרה: ${enrolled} נכנסו, ${closed} נסגרו${reopened > 0 ? `, ${reopened} נפתחו מחדש` : ""}`,
      );
    }
    return { enrolled, closed };
  }

  /**
   * ‎**רישום שנסגר כ„שילם” וכרטיסו נעלם מאוחר יותר** (ביקורת Codex, P2).
   *
   * ‏`reopenForRestoredTrial` נקרא ברגע שמנהל מחזיר ניסיון, והוא
   * ‏שואל אז „יש כרטיס תקף?”. תשובה חיובית **באותו רגע** משאירה
   * ‏את הרישום סגור — וזה נכון, כי הסבב הבא היה סוגר אותו שוב.
   *
   * ‏אבל הכרטיס יכול להיעלם **אחר כך**: הוא פג, או ש-
   * ‏`BillingService.cancel` מנקה אותו. אז אין מי שישאל שוב:
   * ‏הפתיחה-מחדש היא אירוע חד-פעמי, ו-`enrollDue` מוציא לתמיד כל
   * ‏מי שהיה לו רישום. התוצאה היא ניסיון חי בלי שום שלב שיישלח
   * ‏בו — אותה מלכודת קבועה של הממצא הקודם, רק בתזמון אחר.
   *
   * ‏לכן השאלה חוזרת בכל סבב, ולא רק ברגע ההחזרה. הכלל עצמו אינו
   * ‏משוכפל: `reopenRows` הוא שמכריע, על הכרטיס, בדיוק כמו קודם.
   */
  private async reopenLapsed(now: Date, pageSize: number): Promise<number> {
    let reopened = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.withFunnelAdmin(async (tx) => {
        const rows = await tx.funnelEnrollment.findMany({
          where: { track: "conversion", endedReason: "paid", endedAt: { not: null } },
          select: { id: true, tenantId: true },
          orderBy: { id: "asc" },
          take: pageSize,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        });
        if (rows.length === 0) return { rows, opened: 0 };
        /*
         * ‏רק משרד שהניסיון שלו חי — פתיחה מחדש למי שהניסיון שלו
         * ‏נגמר היא רישום שאין בו מה לשלוח.
         */
        const live = await tx.tenant.findMany({
          where: { id: { in: rows.map((row) => row.tenantId) }, ...trialActiveWhere(now) },
          select: { id: true },
        });
        /*
         * ‎**והכרטיס נבדק ב-`reopenRows` — ולא כאן.**
         *
         * ‏הניסוח הראשון סינן כאן ב-`withoutValidCard` **וגם** שם,
         * ‏ומוטציה שהסירה את הסינון כאן שרדה: הכלל הפנימי החזיק.
         * ‏כלומר זה לא היה „הגנה בעומק” אלא עותק שני של אותו כלל,
         * ‏שמחר יכול להסכים פחות. השאלה נשאלת פעם אחת, במקום שבו
         * ‏מתקבלת ההחלטה.
         *
         * ‏מה שכן נשאר כאן הוא הסינון ש-`reopenRows` **אינו** עושה:
         * ‏שהניסיון חי. פתיחה מחדש למשרד שיצא מהניסיון היא רישום
         * ‏שאין בו מה לשלוח.
         */
        let opened = 0;
        for (const tenant of live) {
          if (await this.reopenRows(tx, tenant.id, now)) opened += 1;
        }
        return { rows, opened };
      });
      if (page.rows.length === 0) break;
      cursor = page.rows[page.rows.length - 1]!.id;
      reopened += page.opened;
    }
    return reopened;
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
      ...trialActiveWhere(now),
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
     * ‎**ההתקדמות היא „עברנו את השורה”, ולא „היא יצאה מהשאילתה”.**
     *
     * ‏משרד שנרשם יוצא מ-`none`, אבל משרד שדולג בגלל כרטיס תקף
     * ‏**לא** נרשם וחוזר בדף הבא. הגרסה הקודמת אספה את המדולגים
     * ‏ל-`notIn`, וזה עבד — עם עלות ריבועית: חלון של 48 שעות יכול
     * ‏להכיל עשרות אלפי משרדים עם כרטיס, וכל דף שלח מחדש את כל
     * ‏המצטבר. `S²/pageSize` פרמטרים, עד תקרת הפרמטרים של הדרייבר
     * ‏או פסק זמן — והסבב הטרי נופל **לפני** שהגיע למי שבאמת
     * ‏מועמד (ביקורת Codex, P2).
     *
     * ‎**סמן מפתח (keyset) על `(createdAt, id)`** פותר את שניהם:
     * ‏הוא מתקדם על מה שראינו ולא על מה שנשאר, ולכן שורה שנרשמה
     * ‏ויצאה מהקבוצה אינה מפריעה לו — וזו בדיוק הנקודה שבה
     * ‏`cursor` של Prisma נכשל כאן קודם: הוא דורש ששורת הסמן
     * ‏תישאר בתוך התוצאה. הבדיקה „שלוש הרשמות טריות בדף של אחד”
     * ‏היא שתפסה את זה, והיא עוברת גם עכשיו.
     *
     * ‏המיון `asc` נשאר כהגנה על המסלול היחיד שבו יש חיתוך: מי
     * ‏שקרוב לצאת מחלון הטריות נכנס ראשון. `id` שובר שוויון, כי
     * ‏שתי הרשמות באותה מילישנייה היו מדלגות זו על זו.
     */
    let enrolled = 0;
    /*
     * ‏הטיפוס מפורש בשני המקומות ולא נגזר: `after` נכתב מתוך
     * ‏התוצאה של השאילתה שקוראת אותו, וגזירה הייתה מעגלית.
     */
    let after: SignupCursor | null = null;
    for (;;) {
      const cursor: SignupCursor | null = after;
      const page = await this.prisma.withFunnelAdmin(
        async (tx): Promise<{ rows: SignupCursor[]; prospects: { id: string }[] }> => {
        const rows = await tx.tenant.findMany({
          where: {
            ...eligible,
            createdAt: { gte: freshFrom },
            ...afterSignup(cursor),
          },
          select: { id: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: pageSize,
        });
        return { rows, prospects: await this.withoutValidCard(tx, rows, now) };
        },
      );
      if (page.rows.length === 0) break;
      const last = page.rows[page.rows.length - 1]!;
      after = { createdAt: last.createdAt, id: last.id };
      for (const tenant of page.prospects) {
        /*
         * ‎**`startedAt` הוא `now`, ולא `tenant.createdAt`.**
         *
         * ‏זו ההחלטה עצמה בשורה אחת. `createdAt` היה מחזיר בדיוק את
         * ‏„הכניסה בנקודה” שנדחתה: משרד בן עשרה ימים היה מתחיל ביום
         * ‏10 ומפספס את כל תוכן ההפעלה.
         */
        if (await this.openProspect(tenant.id, now)) enrolled += 1;
      }
    }

    return enrolled + (await this.enrollBacklog(now, dailyQuota, pageSize, freshFrom, eligible));
  }

  /**
   * ‎**מי מהדף הוא באמת מועמד להמרה — כלומר בלי כרטיס תקף.**
   *
   * ‏`status: "trial"` אינו אומר „לא שילם”: משרד בניסיון ששכר מספר
   * ‏או מקום וואטסאפ שילם, והכרטיס נשמר בלי שהסטטוס השתנה. משרד
   * ‏כזה שנרשם למשפך נסגר כ-`paid` באותו סבב עצמו — כלומר נספר
   * ‏כנכנס וכמשלם על התחלה שקרתה **אחרי** ההמרה, ומזהם את שני
   * ‏המדדים.
   *
   * ‎**שני המסלולים, ולא רק הפיגור.** הכלל ישב בפיגור בלבד, ולכן
   * ‏משרד טרי עם כרטיס נכנס בכל זאת — אותה תקלה, בצד שלא נבדק
   * ‏(ביקורת Codex, P2). ניסוח אחד לשניהם.
   *
   * ‎**ולמה זה לא עובר לשאילתה:** „כרטיס תקף” כולל תפוגה שנשענת על
   * ‏שתי עמודות מספריות, ו„יש טוקן כרטיס” אינו אותו דבר — משרד עם
   * ‏כרטיס **שפג** הוא בדיוק מועמד שצריך להיכנס. תנאי בשאילתה היה
   * ‏מוציא דווקא אותו.
   */
  private async withoutValidCard(
    tx: TenantTx,
    page: readonly { id: string }[],
    now: Date,
  ): Promise<{ id: string }[]> {
    if (page.length === 0) return [];
    const cards = await tx.subscription.findMany({
      where: { tenantId: { in: page.map((tenant) => tenant.id) } },
      select: { tenantId: true, cardTokenEncrypted: true, cardMonth: true, cardYear: true },
    });
    const cardById = new Map(cards.map((card) => [card.tenantId, card]));
    return page.filter((tenant) => !hasValidCard(cardById.get(tenant.id) ?? null, now));
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
      /*
       * ‎**ואותו סמן מפתח כמו בסבב הטרי** (ביקורת Codex, P2).
       *
       * ‏כאן היה `cursor` של Prisma, שדורש ששורת הסמן תישאר בתוצאה
       * ‏— והמשרד האחרון בדף יוצא ממנה בדיוק כשהוא נרשם. ראו
       * ‏`afterSignup`.
       */
      let after: SignupCursor | null = null;
      while (enrolled < remaining) {
        /* ‏מקומי ומוטפס, אחרת `after` נגזר מ-`page` שנגזר ממנו */
        const cursor: SignupCursor | null = after;
        const page: SignupCursor[] = await tx.tenant.findMany({
          where: { ...eligible, createdAt: { lt: freshFrom }, ...afterSignup(cursor) },
          select: { id: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: pageSize,
        });
        if (page.length === 0) break;
        const last = page[page.length - 1]!;
        after = { createdAt: last.createdAt, id: last.id };

        for (const tenant of await this.withoutValidCard(tx, page, now)) {
          /*
           * ‎**טרנזקציה משלו לכל משרד — ולא זו של המכסה**
           * ‏(ביקורת Codex, P2).
           *
           * ‏כאן נמסר `tx` החיצוני, ולכן סולם הנעילות של **כל**
           * ‏משרד בדף הצטבר בטרנזקציה אחת והוחזק עד סוף האצווה.
           * ‏`deletePlan` שמעדכן כמה מנויים בבת אחת נוגע בהם בסדר
           * ‏שלו, ושני מסלולים שמחזיקים שורות ומחכים זה לזה סוגרים
           * ‏מעגל — Postgres מפיל אחד מהם, ובחצי מהמקרים זה הסבב.
           *
           * ‏בטרנזקציה לכל משרד הסבב מחזיק שורות של **אחד** בכל
           * ‏רגע ואינו ממתין לאף אחד אחר, ולכן מעגל אינו נסגר. זה
           * ‏גם מה שהסבב הטרי כבר עושה — ההבדל היה מקרי.
           *
           * ‏הנעילה המייעצת של היום נשארת על הטרנזקציה החיצונית,
           * ‏שלא נוגעת בשורות בעצמה, ולכן המכסה עדיין מוגנת מפני
           * ‏שני סבבים במקביל. ומשרד שנכשל אינו מגלגל אחורה את מי
           * ‏שכבר נרשם באותו דף — שיפור, לא ויתור.
           */
          if (await this.openProspect(tenant.id, now)) enrolled += 1;
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
  /**
   * ‎**כניסה למשפך ההמרה — הזכאות נבדקת מחדש מתחת לנעילה** (ביקורת Codex, P2).
   *
   * ‏`withoutValidCard` קורא, והכתיבה קורית אחר כך. במסלול הטרי
   * ‏הקריאה אפילו **מאשרת** לפני שהכתיבה מתחילה, ובמסלול הפיגור
   * ‏הן באותה טרנזקציה אך בלי נעילה — וב-READ COMMITTED זה אותו
   * ‏דבר: תשלום שמאושר בין השניים אינו נראה לקריאה שכבר קרתה.
   *
   * ‏התוצאה היא משרד שכבר המיר, שנרשם למשפך המכירה: `started_at`
   * ‏מאוחר מההמרה שלו, שני המדדים מזוהמים, ובמסלול הפיגור הוא גם
   * ‏אכל מקום במכסה היומית של מועמד אמיתי. וכשההמרה היא הפעלה בלי
   * ‏כרטיס — קופון של 100% — הוא נשאר לקוח פעיל בתוך משפך מכירה.
   *
   * ‎**„קרא ואז כתוב” אינו אטומי, ולכן הבדיקה חוזרת ליד הכתיבה.**
   * ‏אותה נעילת ייעוץ ששאר המסלול לוקח (`lockTenantSubscription`)
   * ‏נלקחת כאן, ומתחתיה נקראים מחדש **הסטטוס** והכרטיס: הסטטוס
   * ‏תופס כל דרך לצאת מהניסיון, גם כזו שאינה עוברת דרך כרטיס.
   *
   * ‏החזרת `false` ולא זריקה: „כבר לא מועמד” אינו כשל של הסבב.
   */
  private async openProspect(tenantId: string, now: Date): Promise<boolean> {
    const attempt = async (t: TenantTx): Promise<boolean> => {
      await this.lockBilling(t, tenantId);
      const tenant = await t.tenant.findFirst({
        where: { id: tenantId },
        select: { status: true, trialEndsAt: true },
      });
      /* ‏אותו כלל בדיוק כמו `trialActiveWhere` — ראו שם */
      if (tenant === null || tenant.status !== "trial" || !isTrialActive(tenant.trialEndsAt, now)) {
        return false;
      }
      const card = await t.subscription.findFirst({
        where: { tenantId },
        select: { cardTokenEncrypted: true, cardMonth: true, cardYear: true },
      });
      if (hasValidCard(card, now)) return false;
      /*
       * ‎**וגם „כבר היה לו רישום” — מתחת לאותה נעילה.**
       *
       * ‏זה אותו תנאי בדיוק שהשאילתה מסננת בו (`funnelEnrollments:
       * ‏{ none: … }`), והוא נבדק מחדש כאן מאותה סיבה שהכרטיס
       * ‏נבדק: הקריאה קרתה קודם. בלעדיו שני סבבים במקביל היו
       * ‏מגיעים שניהם לכתיבה, והשני היה נופל על הפרת ייחודיות —
       * ‏שבתוך טרנזקציה של קורא **חייבת** להתפוצץ ולגלגל את הסבב
       * ‏כולו. הנעילה מסדרת אותם, והבדיקה הופכת את השני ל„אין מה
       * ‏לעשות” במקום לשגיאה. האינדקס הייחודי נשאר הרשת האחרונה.
       */
      const existing = await t.funnelEnrollment.findFirst({
        where: { tenantId, track: "conversion" },
        select: { id: true },
      });
      if (existing !== null) return false;
      return this.open(tenantId, "conversion", now, t);
    };
    return this.prisma.withFunnelAdmin(attempt);
  }

  /**
   * ‎**סולם הנעילות של מצב החיוב — ניסוח אחד לכל מי שנשען עליו.**
   *
   * ‏שלוש שורות, וכל אחת מהן מכסה חור שהשתיים האחרות אינן:
   *
   * ‎**נעילת הייעוץ** מכסה את המקרה ששורת המנוי **אינה קיימת**.
   * ‏משרד שנרשם בעצמו מקבל דייר ומשתמש בלבד, ושורת המנוי נוצרת
   * ‏במגע הראשון עם החיוב; `FOR UPDATE` על שורה שאינה קיימת נועל
   * ‏אפס שורות, בשקט.
   *
   * ‎**`FOR UPDATE` על השורות עצמן** מכסה את כל שאר הכותבים —
   * ‏`activateWithin`, קריאות התשלום על מספר ועל מקום וואטסאפ —
   * ‏שאינם נוגעים בנעילת הייעוץ כלל. נעילה שרק **אנחנו** לוקחים
   * ‏אינה מסדרת אותנו מולם; נעילת שורה נלקחת בכל `UPDATE` בין אם
   * ‏הכותב יודע עליה ובין אם לא (ביקורת Codex, P2).
   *
   * ‎**והסדר — מנוי, ואז דייר.** זה הסדר שמסלולי התשלום נועלים בו,
   * ‏והוא הרונג שכתוב ב-`common/locks.ts`. הפוך = deadlock.
   *
   * ‏הפונקציה קיימת מפני שהסולם הזה נדרש בשני מקומות — הסגירה
   * ‏והכניסה — ושני ניסוחים שלו הם שני סולמות שביום מן הימים
   * ‏אינם זהים.
   */
  private async lockBilling(tx: TenantTx, tenantId: string): Promise<void> {
    await lockTenantSubscription(tx, tenantId);
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  }

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
      /*
       * ‏הסגירה נכתבת מול אותו עוגן שההחלטה התקבלה עליו. אם הוא זז
       * ‏בינתיים — ניסיון שהוחזר — הכתיבה אינה חלה, וזה הנכון.
       */
      const closedNow = await this.close(row.id, reason, now, {
        tenantId: row.tenantId,
        trialEndsAt: tenant.trialEndsAt,
        trialConcludedAt: tenant.trialConcludedAt,
        hasCard: card,
      });
      if (closedNow) closed += 1;
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
   * ‏אותה — הוא נשאר סגור בכל מצב.
   *
   * ‎**ו-`paid` — רק כשהכרטיס באמת נעלם** (ביקורת Codex, P2).
   *
   * ‏הנימוק המקורי („ייסגר שוב מיד בסבב הבא ממילא”) נכון כל עוד
   * ‏הכרטיס עומד. אבל `switchToFreePlan` **מוחק** את שדות הכרטיס,
   * ‏ולכן משרד ששילם, ירד למסלול חינמי, וקיבל ניסיון מחדש — אין
   * ‏לו כרטיס, הסגירה לא הייתה חוזרת, והוא נתקע: אין פתיחה מחדש,
   * ‏ו-`enrollDue` מוציא אותו כי כבר היה לו רישום. ניסיון חי בלי
   * ‏שום שלב שיישלח בו.
   *
   * ‏הבדיקה היא על הכרטיס ולא על הסיבה, ולכן היא גם אינה שוברת
   * ‏את הנימוק: מי שעדיין מחזיק כרטיס תקף באמת ייסגר שוב מיד,
   * ‏ולכן הוא אינו נפתח.
   *
   * ‏האינדקס החלקי מתיר רישום חי אחד למסלול, ולכן קיים רישום פתוח
   * ‏עוצר — אין מה לפתוח, ויש כבר אחד שעובד.
   */
  async reopenForRestoredTrial(tenantId: string, now: Date = new Date()): Promise<boolean> {
    return this.prisma.withFunnelAdmin((tx) => this.reopenWithin(tx, tenantId, now));
  }

  /**
   * ‎**אותה פתיחה, בתוך טרנזקציה שכבר פתוחה.**
   *
   * ‏המסך שמחזיר ניסיון כותב את הדייר ואז פותח את הרישום. בשתי
   * ‏פעולות נפרדות, תקלה ביניהן משאירה ניסיון חי לצד רישום סגור —
   * ‏ומצב כזה **קבוע**: `closeFinished` סורק רק רישומים פתוחים,
   * ‏ו-`enrollDue` מוציא מי שהיה לו רישום (ביקורת Codex). לכן
   * ‏שתיהן באותה טרנזקציה.
   *
   * ‎`set_config` עם `true` הוא מקומי-לטרנזקציה, ולכן הדגל נדלק
   * ‏כאן בדיוק כמו ב-`withFunnelAdmin` ונכבה עם ה-COMMIT.
   */
  async reopenWithin(tx: TenantTx, tenantId: string, now: Date = new Date()): Promise<boolean> {
    await tx.$executeRaw`SELECT set_config('app.funnel_admin', 'on', true)`;
    return this.reopenRows(tx, tenantId, now);
  }

  private async reopenRows(tx: TenantTx, tenantId: string, now: Date): Promise<boolean> {
    return (async () => {
      const open = await tx.funnelEnrollment.findFirst({
        where: { tenantId, track: "conversion", endedAt: null },
        select: { id: true },
      });
      if (open !== null) return false;
      const closed = await tx.funnelEnrollment.findFirst({
        where: { tenantId, track: "conversion", endedReason: { in: ["completed", "paid"] } },
        orderBy: { endedAt: "desc" },
        select: { id: true, endedReason: true },
      });
      if (closed === null) return false;
      /*
       * ‏רישום שנסגר כ„שילם” נפתח רק אם הכרטיס כבר אינו שם. עם
       * ‏כרטיס תקף הסבב הבא היה סוגר אותו מיד, וזו פתיחה שכל
       * ‏תוצאתה היא רעש ביומן.
       */
      if (closed.endedReason === "paid") {
        const card = await tx.subscription.findFirst({
          where: { tenantId },
          select: { cardTokenEncrypted: true, cardMonth: true, cardYear: true },
        });
        if (hasValidCard(card, now)) return false;
      }
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
    })();
  }

  /**
   * ‏סגירה מותנית — רק רישום שעדיין פתוח.
   *
   * ‏`endedAt: null` ב-`where` אינו נימוס: בלעדיו סבב שני היה דורס
   * את סיבת הסגירה הראשונה, ו„שילם” היה הופך ל„מיצה את הרצף” בלי
   * שדבר קרה.
   */
  async close(
    id: string,
    reason: FunnelExitReason,
    now: Date,
    /**
     * ‎**מצב עוגן הניסיון שההחלטה התקבלה עליו — ולא קישוט.**
     *
     * ‏`closePage` קורא את שורת הדייר, מחליט, ואז כותב. בין השניים
     * ‏מנהל פלטפורמה יכול להחזיר ניסיון: הפתיחה-מחדש רואה רישום
     * ‏שעדיין פתוח ואינה עושה דבר, ואז הסבב המיושן סוגר אותו. התוצאה
     * ‏היא ניסיון חי לצד רישום סגור ש-`enrollDue` לעולם לא יקבל
     * ‏שוב (ביקורת Codex).
     *
     * ‏שני השדות ב-`where` הופכים את הכתיבה לתלוית-גרסה: אם העוגן
     * ‏השתנה מאז הקריאה, הסגירה פשוט אינה חלה, והסבב הבא יחליט על
     * ‏המצב החדש. זה זול מנעילה, ואינו מחזיק טרנזקציה פתוחה על פני
     * ‏דף שלם של רישומים.
     */
    snapshot: {
      tenantId: string;
      trialEndsAt: Date | null;
      trialConcludedAt: Date | null;
      /** ‏האם היה כרטיס תקף ברגע ההחלטה. */
      hasCard: boolean;
    },
  ): Promise<boolean> {
    return this.prisma.withFunnelAdmin(async (tx) => {
      /*
       * ‎**נעילה, ולא רק קריאה — כי „קרא ואז כתוב” אינו אטומי.**
       *
       * ‏ב-`READ COMMITTED` התנאי על שורת הדייר קורא את הגרסה
       * ‏**המאושרת האחרונה**: טרנזקציה של המסך שהחזיר ניסיון יכולה
       * ‏להיות פתוחה ולא מאושרת, השאילתה כאן תראה את הערכים הישנים
       * ‏ותסגור — ובמקביל הפתיחה-מחדש שלה תראה רישום שעדיין פתוח
       * ‏ולא תעשה דבר. שתיהן מאשרות, והתוצאה היא ניסיון חי לצד רישום
       * ‏סגור. טרנזקציה משותפת לבדה אינה יוצרת שום נעילה משותפת עם
       * ‏המסלול הזה (ביקורת Codex). אותו דבר בדיוק לגבי הכרטיס.
       *
       * ‎**והסדר אינו שרירותי: מנוי, ואז דייר.** זה הסדר שמסלולי
       * ‏התשלום נועלים בו (`activateWithin`, `switchToFreePlan` —
       * ‏מנוי ואז דייר), ונעילה בסדר הפוך היא מתכון ל-deadlock.
       */
      await this.lockBilling(tx, snapshot.tenantId);
      /*
       * ‎**גם הכרטיס — ולא רק העוגן.**
       *
       * ‏`closePage` קורא את המנוי יחד עם הדייר, ותשלום על מספר או
       * ‏על מקום וואטסאפ יכול לשמור כרטיס בין הקריאה לכתיבה. שורת
       * ‏המנוי משתנה, שורת הדייר לא — ולכן תנאי העוגן לבדו עובר,
       * ‏והרישום נסגר כ„מוצה” במקום כ„שילם”. סגירה היא בלתי הפיכה,
       * ‏והמסך והמדדים נשארים עם סיבה שגויה (ביקורת Codex).
       *
       * ‏הבדיקה בתוך הטרנזקציה ולא ב-`where`: אין יחס Prisma בין
       * ‏הדייר למנוי, ו„כרטיס תקף” נשען על שתי עמודות מספריות
       * ‏שאילוץ שוויון אינו יכול לבטא. שינוי — לכל כיוון — משאיר
       * ‏את ההכרעה לסבב הבא.
       */
      const subscription = await tx.subscription.findUnique({
        where: { tenantId: snapshot.tenantId },
        select: { cardTokenEncrypted: true, cardMonth: true, cardYear: true },
      });
      if (hasValidCard(subscription, now) !== snapshot.hasCard) return false;
      const updated = await tx.funnelEnrollment.updateMany({
        where: {
          id,
          endedAt: null,
          tenant: {
            trialEndsAt: snapshot.trialEndsAt,
            trialConcludedAt: snapshot.trialConcludedAt,
          },
        },
        data: { endedAt: now, endedReason: reason },
      });
      return updated.count > 0;
    });
  }
}

/** ‏הניסיון עדיין בתוקף. משרד בלי תפוגה אינו „בניסיון פעיל”. */
function isTrialActive(trialEndsAt: Date | null, now: Date): boolean {
  return trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();
}

/**
 * ‎**סמן מפתח על `(createdAt, id)` — ניסוח אחד לשני הסבבים**
 * ‏(ביקורת Codex, P2).
 *
 * ‏`cursor` של Prisma דורש **ששורת הסמן תישאר בתוך התוצאה**, וזה
 * ‏בדיוק מה שלא מתקיים כאן: המשרד האחרון בדף נרשם, ומאותו רגע
 * ‏`funnelEnrollments: { none: … }` מוציא אותו — כלומר העוגן נעלם
 * ‏מתחת לסמן. הדף הבא נעצר, והמכסה היומית מתמלאת חלקית: דף
 * ‏שרובו משרדים עם כרטיס ובסופו מועמד אחד הכניס את המועמד ההוא
 * ‏ואת איש מלבדו.
 *
 * ‏סמן מפתח מתקדם על **מה שראינו** ולא על מה שנשאר, ולכן שורה
 * ‏שיצאה מהקבוצה אינה מפריעה לו. הסבב הטרי כבר עבר לזה; הפיגור
 * ‏נשאר מאחור, ולכן הביטוי יושב עכשיו במקום אחד.
 */
interface SignupCursor {
  createdAt: Date;
  id: string;
}

function afterSignup(cursor: SignupCursor | null): {
  OR?: ({ createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } })[];
} {
  if (cursor === null) return {};
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * ‎**התאום של `isTrialActive` בשפת השאילתה** (ביקורת Codex, P2).
 *
 * ‏„הניסיון חי” נוסח בשני מקומות בשתי צורות שונות: כאן
 * ‏`trialEndsAt !== null && > now`, ובשאילתות `trialEndsAt: { not:
 * ‏null }` בלבד. הצורה החלשה מכניסה משרד שהתאריך שלו **עבר**.
 *
 * ‏זה לא תיאורטי: משרד ששילם בזמן שהיה מסומן `trial` שומר את
 * ‏`trialEndsAt` המקורי גם אחריו. אם הכרטיס פג מאוחר יותר,
 * ‏`reopenLapsed` ראה תאריך היסטורי, קרא לו „ניסיון משוחזר”, ופתח
 * ‏מחדש רישום למשרד שהניסיון שלו נגמר — שאותו הסבב עצמו יסגור
 * ‏כ„הושלם” ויעוות את מדד ההמרה.
 *
 * ‏שתי צורות נחוצות (שאילתה אינה יכולה לקרוא לפונקציה), שני כללים
 * ‏לא. מכאן והלאה הן זהות — ונבדקות זו מול זו.
 */
function trialActiveWhere(now: Date): { status: "trial"; trialEndsAt: { gt: Date } } {
  return { status: "trial", trialEndsAt: { gt: now } };
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
