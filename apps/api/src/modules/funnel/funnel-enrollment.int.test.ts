import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../core/prisma.service";
import { FunnelEnrollmentService } from "./funnel-enrollment.service";
import { FunnelStageService } from "./funnel-stage.service";

/**
 * ‎**הכניסה למסלול — מול מסד אמיתי.**
 *
 * ## ‏למה אינטגרציה ולא יחידה
 *
 * ‏שלושה מהדברים שנבדקים כאן אינם לוגיקה אלא **התנהגות של
 * PostgreSQL**, ומוק היה מחזיר בדיוק את ההנחה שלי:
 *
 * ‏1. האינדקס החלקי שמונע רישום חי שני — מוק לא היה נכשל עליו.
 * ‏2. פוליסת ה-RLS שנפתחת ב-`withFunnelAdmin` ולא בלעדיה.
 * ‏3. `startedAt` שנכתב ונקרא בחזרה כ-`timestamp`, ולא כאובייקט
 *    שנשאר בזיכרון.
 *
 * ## ‏מה נבדק, ולמה דווקא זה
 *
 * ‏הטענה המרכזית של שלב א׳ היא **„כל משרד מיום 0 שלו”**. אני יכול
 * לכתוב אותה בתיעוד ולהיות בטוח בה, אבל הדרך היחידה לדעת שהיא
 * נכונה היא לשתול משרד בן חודש, להריץ, ולקרוא מהמסד ש-`startedAt`
 * שלו הוא **היום** ולא לפני חודש.
 */

const OLD_TENANT = "01M1FNNLTEST0LDTENANT00001";
const THIRD_TENANT = "01M1FNNLTESTZZZLASTBYID001";
const NEW_TENANT = "01M1FNNLTESTNEWTENANT00001";
const DAY = 24 * 60 * 60 * 1000;

let direct: PrismaClient;
let prisma: PrismaService;
let service: FunnelEnrollmentService;

/**
 * ‎**משרד בניסיון עם ותק נתון — והניסיון שלו חי.**
 *
 * ‏קודם `trialEndsAt` נגזר מ-`createdAt` (‎+14 יום), ולכן „משרד
 * ‏ותיק בן 30 יום” היה משרד שהניסיון שלו נגמר לפני שבועיים. זה
 * ‏ערבב שני דברים שהבדיקות מפרידות ביניהם: `createdAt` קובע טרי
 * ‏מול פיגור, ו-`trialEndsAt` קובע אם יש בכלל מה לשלוח.
 *
 * ‏העירוב לא הפריע כל עוד השאילתה שאלה `trialEndsAt: { not: null }`
 * ‏— תאריך שעבר עונה על זה. מרגע שהיא שואלת „הניסיון חי” (ראו
 * ‏`trialActiveWhere`), הפיקסצ׳ר הזה תיאר משרדים שאינם מועמדים
 * ‏כלל. „ותיק” כאן פירושו נרשם מזמן, לא „הניסיון נגמר”: כל
 * ‏הבדיקות שמסיימות ניסיון עושות זאת במפורש, ב-`trial_ends_at =
 * ‏NULL`.
 */
async function seedTenant(id: string, name: string, ageDays: number): Promise<void> {
  const createdAt = new Date(Date.now() - ageDays * DAY);
  const trialEndsAt = new Date(Date.now() + 7 * DAY);
  await direct.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, plan, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'basic', 'trial', $3, $4, now())
     ON CONFLICT (id) DO UPDATE
       SET status = 'trial', trial_ends_at = EXCLUDED.trial_ends_at, created_at = EXCLUDED.created_at,
           plan = 'basic', paid_until = NULL, trial_concluded_at = NULL`,
    id,
    name,
    trialEndsAt,
    createdAt,
  );
}

async function enrollments(): Promise<
  { tenantId: string; startedAt: Date; endedAt: Date | null; endedReason: string | null }[]
> {
  const rows = await direct.$queryRawUnsafe<
    { tenant_id: string; started_at: Date; ended_at: Date | null; ended_reason: string | null }[]
  >(
    `SELECT tenant_id, started_at, ended_at, ended_reason FROM funnel_enrollments
      WHERE tenant_id IN ($1, $2, $3) ORDER BY tenant_id`,
    OLD_TENANT,
    NEW_TENANT,
    THIRD_TENANT,
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
  }));
}

/**
 * ‏אותה קריאה, לכל מזהה שיימסר: `enrollments()` מקובעת לשלושת
 * ‏המשרדים הוותיקים של הקובץ, והבדיקות החדשות זורעות משלהן.
 */
async function enrollmentsOf(
  ids: readonly string[],
): Promise<{ tenantId: string; endedAt: Date | null; endedReason: string | null }[]> {
  const rows = await direct.$queryRawUnsafe<
    { tenant_id: string; ended_at: Date | null; ended_reason: string | null }[]
  >(
    `SELECT tenant_id, ended_at, ended_reason FROM funnel_enrollments
      WHERE tenant_id = ANY($1) ORDER BY tenant_id`,
    [...ids],
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
  }));
}

beforeAll(async () => {
  const url = process.env["DIRECT_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DIRECT_DATABASE_URL חסר — הבדיקה דורשת מסד אמיתי");
  }
  direct = new PrismaClient({ datasources: { db: { url } } });
  /*
   * ‎**דרך תפקיד האפליקציה, לא דרך הבעלים.**
   *
   * ‏הבעלים עוקף RLS, ולכן בדיקה שרצה דרכו הייתה עוברת גם אם
   * ‏`withFunnelAdmin` לא היה מדליק דבר — כלומר מאמתת את ההפך ממה
   * שהיא מתיימרת.
   */
  prisma = new PrismaService();
  service = new FunnelEnrollmentService(prisma, new FunnelStageService(prisma));
});

beforeEach(async () => {
  await direct.$executeRawUnsafe(
    `DELETE FROM funnel_messages WHERE tenant_id IN ($1, $2, $3)`,
    OLD_TENANT,
    NEW_TENANT,
    THIRD_TENANT,
  );
  await direct.$executeRawUnsafe(
    `DELETE FROM funnel_enrollments WHERE tenant_id IN ($1, $2, $3)`,
    OLD_TENANT,
    NEW_TENANT,
    THIRD_TENANT,
  );
  await direct.$executeRawUnsafe(
    `DELETE FROM subscriptions WHERE tenant_id IN ($1, $2, $3)`,
    OLD_TENANT,
    NEW_TENANT,
    THIRD_TENANT,
  );
  await seedTenant(OLD_TENANT, "משרד ותיק", 30);
  await seedTenant(NEW_TENANT, "משרד טרי", 0);
  await seedTenant(THIRD_TENANT, "משרד אחרון לפי מזהה", 20);
});

afterAll(async () => {
  if (direct !== undefined) {
    await direct.$executeRawUnsafe(
      `DELETE FROM funnel_enrollments WHERE tenant_id IN ($1, $2, $3)`,
      OLD_TENANT,
      NEW_TENANT,
      THIRD_TENANT,
    );
    await direct.$executeRawUnsafe(
      `DELETE FROM subscriptions WHERE tenant_id IN ($1, $2, $3)`,
      OLD_TENANT,
      NEW_TENANT,
      THIRD_TENANT,
    );
    await direct.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id IN ($1, $2, $3)`,
      OLD_TENANT,
      NEW_TENANT,
      THIRD_TENANT,
    );
    await direct.$disconnect();
  }
  if (prisma !== undefined) await prisma.$disconnect();
});

describe("כניסה למשפך — מול מסד אמיתי", () => {
  /**
   * ‎**הטענה המרכזית של שלב א׳.**
   *
   * ‏משרד שנרשם לפני חודש נכנס **היום** ביום 0, ולא ביום 30. זו
   * ההחלטה שהוחלפה — „כניסה בנקודה” הייתה כותבת כאן את `created_at`.
   */
  it("משרד בן חודש מתחיל מהיום, לא מתאריך ההרשמה שלו", async () => {
    const before = Date.now();
    await service.sweep(new Date());
    const rows = await enrollments();

    const old = rows.find((r) => r.tenantId === OLD_TENANT);
    expect(old).toBeDefined();
    expect(old!.startedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    // ‏ולא לפני חודש — זה בדיוק מה שהיה קורה עם `createdAt`
    expect(old!.startedAt.getTime()).toBeGreaterThan(before - 29 * DAY);
  });

  it("הרשמה טרייה נכנסת מיד גם כשהמכסה אפסה על הוותיקים", async () => {
    await service.sweep(new Date(), { dailyQuota: 0 });
    const rows = await enrollments();
    expect(rows.map((r) => r.tenantId)).toEqual([NEW_TENANT]);
  });

  it("סבב שני אינו פותח רישום נוסף ואינו מאפס את יום 0", async () => {
    await service.sweep(new Date());
    const first = await enrollments();
    expect(first).toHaveLength(3);

    await service.sweep(new Date(Date.now() + 60_000));
    const second = await enrollments();
    expect(second).toHaveLength(3);
    expect(second.map((r) => r.startedAt.getTime())).toEqual(
      first.map((r) => r.startedAt.getTime()),
    );
  });

  /**
   * ‏רישום פתוח הוא מה שהסורק בשלב ב׳ יעבור עליו. משרד ששילם
   * ונשאר פתוח היה מועמד קבוע לקבל „נשארו יומיים” אחרי שכבר שילם.
   */
  it("משרד עם כרטיס תקף נסגר עם הסיבה „שילם”", async () => {
    await service.sweep(new Date());
    expect((await enrollments()).every((r) => r.endedAt === null)).toBe(true);

    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N01",
      OLD_TENANT,
      nextYear,
    );

    await service.sweep(new Date());
    const rows = await enrollments();
    const old = rows.find((r) => r.tenantId === OLD_TENANT);
    expect(old?.endedReason).toBe("paid");
    expect(old?.endedAt).not.toBeNull();
    // ‏והמשרד שלא שילם נשאר פתוח
    expect(rows.find((r) => r.tenantId === NEW_TENANT)?.endedAt).toBeNull();
  });

  /**
   * ‏המרוץ נחסם במסד ולא בקוד. שני סבבים במקביל הם בדיוק מה שקורה
   * כששני עותקים של ה-API עולים יחד.
   */
  it("שני סבבים במקביל פותחים רישום אחד", async () => {
    const now = new Date();
    await Promise.all([service.sweep(now), service.sweep(now), service.sweep(now)]);
    const rows = await enrollments();
    expect(rows).toHaveLength(3);
  });

  /**
   * ‎**הסריקה עוברת על כל הרישומים, ולא על הדף הראשון.**
   *
   * ‏`THIRD_TENANT` נבחר כך שהמזהה שלו **אחרון** — הוא בדף השלישי
   * ‏כש-`pageSize` הוא 1. בגרסה הקודמת (`take` בלי סמן) הסריקה קראה
   * ‏בכל סבב את אותה שורה ראשונה, ולכן משרד עם כרטיס תקף שיושב
   * ‏מאחוריה **לא היה נסגר לעולם** (ביקורת Codex).
   */
  it("משרד שנמצא מעבר לדף הראשון עדיין נסגר", async () => {
    await service.sweep(new Date());
    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N03",
      THIRD_TENANT,
      nextYear,
    );

    await service.sweep(new Date(), { pageSize: 1 });
    const rows = await enrollments();
    expect(rows.find((r) => r.tenantId === THIRD_TENANT)?.endedReason).toBe("paid");
  });

  /**
   * ‎**כרטיס תקף פוסל גם בצד הטרי, לא רק בפיגור.**
   *
   * ‏`status: "trial"` אינו „לא שילם”: משרד שנרשם היום ומיד שכר
   * ‏מספר שילם, והכרטיס נשמר בלי שהסטטוס זז. הכלל ישב בפיגור
   * ‏בלבד, ולכן משרד כזה נכנס — ונסגר כ-`paid` באותו סבב עצמו,
   * ‏כלומר התחלה שנרשמה **אחרי** ההמרה בשני המדדים (ביקורת
   * ‏Codex, P2).
   */
  it("משרד טרי עם כרטיס תקף אינו נרשם כלל", async () => {
    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N04",
      NEW_TENANT,
      nextYear,
    );

    await service.sweep(new Date());
    const rows = await enrollments();
    expect(rows.find((r) => r.tenantId === NEW_TENANT)).toBeUndefined();
    // ‏והצד השני: מי שאין לו כרטיס נכנס כרגיל
    expect(rows.find((r) => r.tenantId === OLD_TENANT)?.endedAt).toBeNull();
  });

  /**
   * ‎**והדילוג אינו מרעיב את מי שמאחוריו.**
   *
   * ‏זו הסיבה שהלולאה הטרייה עברה לסמן: היא נעצרה על „דף בלי
   * ‏קליטה”, ומשרד שדולג **חוזר** בדף הבא (הוא לא נרשם). דף שכולו
   * ‏מדולגים היה נראה בדיוק כמו סוף הרשימה — כלומר כל הטריים
   * ‏שמאחוריו לא היו נכנסים לעולם.
   *
   * ‏`pageSize: 1` הוא מה שמפריד: המשרד עם הכרטיס הוא הדף הראשון,
   * ‏והמשרד השני נמצא רק אם הסמן התקדם בלעדיו.
   */
  it("ודף שכולו מדולגים אינו עוצר את הטריים שאחריו", async () => {
    /* ‏שני המשרדים טריים; המזהה של השני ממיין אחריו */
    await seedTenant(THIRD_TENANT, "משרד טרי שני", 0);
    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N05",
      NEW_TENANT,
      nextYear,
    );

    await service.sweep(new Date(), { pageSize: 1 });
    const rows = await enrollments();
    expect(rows.find((r) => r.tenantId === NEW_TENANT)).toBeUndefined();
    expect(rows.find((r) => r.tenantId === THIRD_TENANT)?.endedAt).toBeNull();
  });

  /**
   * ‎**כל הטריים נכנסים בסבב אחד, גם כשהם יותר מדף.**
   *
   * ‏שלושתם טריים ו-`pageSize` הוא 1. בגרסה הקודמת (`take` בלי
   * ‏המשך) היה נכנס אחד בלבד, והשאר היו ממתינים לסבב הבא —
   * ‏ובזרם מתמשך היו מזדקנים אל תוך הפיגור שמוגבל במכסה
   * ‏(ביקורת Codex). `dailyQuota: 0` מוודא שהקליטה כאן היא של
   * ‏הטריים בלבד ולא של הפיגור.
   */
  it("שלוש הרשמות טריות נכנסות בסבב אחד גם בדף של אחד", async () => {
    await seedTenant(OLD_TENANT, "משרד ותיק", 0);
    await seedTenant(THIRD_TENANT, "משרד אחרון לפי מזהה", 0);

    await service.sweep(new Date(), { dailyQuota: 0, pageSize: 1 });
    expect(await enrollments()).toHaveLength(3);
  });

  /**
   * ‎**הקליטה נמשכת מעבר למי שכבר רשום.**
   *
   * ‏בגרסה הקודמת הסינון היה **אחרי** השליפה: ברגע שדף שלם התמלא
   * ‏במי שכבר נרשם, הרשימה התרוקנה והפונקציה חזרה עם 0 — והמשפך
   * ‏הפסיק לקלוט לנצח (ביקורת Codex, P1).
   */
  it("מכסה של אחד ביום נשמרת גם על פני כמה סבבים באותו יום", async () => {
    const today = new Date();
    await service.sweep(today, { dailyQuota: 1 });
    // ‏הטרי עוקף מכסה, ולכן בסבב הראשון נכנסים שניים: הטרי + ותיק אחד
    expect(await enrollments()).toHaveLength(2);

    /*
     * ‎**סבב שני באותו יום אינו מוסיף מכסה.**
     *
     * ‏הגרסה הקודמת של הבדיקה הזאת ציפתה כאן ל-3 — כלומר **קיבעה
     * ‏את הבאג**: `take: dailyQuota` בכל סבב, וסורק שעתי בשלב ב׳
     * ‏היה מנקז את כל הפיגור ביממה במקום בשבוע (ביקורת Codex).
     */
    await service.sweep(new Date(today.getTime() + 60_000), { dailyQuota: 1 });
    expect(await enrollments()).toHaveLength(2);

    // ‏למחרת המכסה מתאפסת, והבא בתור נכנס
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    await service.sweep(tomorrow, { dailyQuota: 1 });
    expect(await enrollments()).toHaveLength(3);
  });

  /**
   * ‎**משרד שכבר יש לו כרטיס תקף אינו צורך מקום במכסה.**
   *
   * ‏`status: "trial"` אינו „לא שילם”: משרד בניסיון ששכר מספר שילם,
   * ‏והכרטיס נשמר בלי שהסטטוס השתנה. הוא היה נכנס, תופס את המקום
   * ‏היחיד של היום, ו-`closeFinished` היה סוגר אותו כ-`paid` באותו
   * ‏סבב — כלומר אף מועמד אמיתי לא נכנס באותו יום (ביקורת Codex).
   *
   * ‏הוותיק הוא בעל הכרטיס והוא גם הראשון בתור לפי `createdAt`,
   * ‏ולכן בלי התיקון הוא זה שהיה תופס את המכסה.
   *
   * ‎**`pageSize: 1` אינו קישוט.** בדף גדול המועמד האמיתי יושב
   * ‏באותו דף כמו בעל הכרטיס, ואז גם מימוש שגוי — כזה שסופר את
   * ‏המדולג כאילו נכנס — עדיין מגיע אליו במקרה. דף של אחד מפריד
   * ‏בין „דילגתי” ל„דילגתי ובזבזתי את המקום”: רק אם הדילוג **אינו**
   * ‏נספר, הלולאה ממשיכה לדף הבא ומגיעה למועמד.
   */
  it("בעל כרטיס תקף מדולג, והמקום עובר למועמד אמיתי", async () => {
    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N03",
      OLD_TENANT,
      nextYear,
    );

    await service.sweep(new Date(), { dailyQuota: 1, pageSize: 1 });

    const ids = (await enrollments()).map((r) => r.tenantId);
    // ‏הטרי עוקף מכסה תמיד; המקום היחיד בפיגור הלך למועמד האמיתי
    expect(ids).toContain(NEW_TENANT);
    expect(ids).toContain(THIRD_TENANT);
    expect(ids).not.toContain(OLD_TENANT);
  });

  /**
   * ‎**המכסה מוגנת נגד עותק שני של ה-API — נעילה אמיתית, לא ספירה.**
   *
   * ‏„ספור ואז קח” בשתי טרנזקציות נותן לשני עותקים להוציא כל אחד
   * ‏מכסה שלמה: א׳ סופר 0, ב׳ רושם את שלו, ואז השאילתה של א׳
   * ‏מדלגת על אלה ולוקחת את הבאים (ביקורת Codex, P1).
   *
   * ‏הבדיקה תופסת את **המנגנון** ולא את התוצאה: חיבור נפרד מחזיק
   * ‏את אותה נעילה בדיוק, ולכן הסבב חייב לוותר על הפיגור. סימולציה
   * ‏של מרוץ אמיתי בין שני תהליכים אינה דטרמיניסטית; החזקת הנעילה
   * ‏היא בדיוק המצב שבו העותק השני נמצא.
   *
   * ‏והטריים כן נכנסים — הם מחוץ למכסה ומחוץ לנעילה מלכתחילה.
   */
  it("סבב מוותר על הפיגור כשעותק אחר מחזיק את נעילת היום", async () => {
    const today = new Date();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(today);

    const holder = new PrismaClient({
      datasources: { db: { url: process.env["DIRECT_DATABASE_URL"]! } },
    });
    try {
      /*
       * ‏הנעילה חייבת להיות מוחזקת **לאורך** הסבב, ולכן טרנזקציה
       * ‏פתוחה על חיבור אחר ולא קריאה בודדת: נעילת טרנזקציה משתחררת
       * ‏ברגע שהיא נסגרת.
       */
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const holding = holder.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `funnel-backlog:${day}`,
        );
        await held;
      });
      // ‏שהות קצרה כדי שהנעילה תיתפס לפני הסבב
      await new Promise((r) => setTimeout(r, 100));

      await service.sweep(today, { dailyQuota: 5 });
      // ‏רק הטרי; שני הוותיקים נשארו בחוץ
      expect((await enrollments()).map((r) => r.tenantId)).toEqual([NEW_TENANT]);

      release!();
      await holding;
    } finally {
      await holder.$disconnect();
    }

    // ‏אחרי שהנעילה שוחררה, הסבב הבא כן מוציא את המכסה
    await service.sweep(new Date(today.getTime() + 60_000), { dailyQuota: 5 });
    expect(await enrollments()).toHaveLength(3);
  });

  /**
   * ‎**סגירה אינה מפנה מקום במכסה.**
   *
   * ‏משרד שנכנס הבוקר ושילם בצהריים כבר צרך את המקום וקיבל את
   * ‏ההודעה הראשונה. אילו הספירה הייתה מסננת רישומים שנסגרו, יום
   * ‏עם המרות מהירות היה מכניס פי כמה — ההפך הגמור מהפריסה.
   *
   * ‏שלושה סבבים ולא שניים, כי הכניסה קודמת לסגירה בתוך אותו סבב:
   * ‏רק בסבב השלישי הרישום הסגור כבר קיים בזמן הספירה.
   */
  it("רישום שנסגר באותו יום אינו מחזיר מקום למכסה", async () => {
    const today = new Date();
    await service.sweep(today, { dailyQuota: 1 });
    expect(await enrollments()).toHaveLength(2);

    const nextYear = new Date().getUTCFullYear() + 2;
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTSUBSCR1PT10N02",
      OLD_TENANT,
      nextYear,
    );

    // ‏הסבב הזה סוגר את הוותיק שנכנס
    await service.sweep(new Date(today.getTime() + 60_000), { dailyQuota: 1 });
    expect((await enrollments()).find((r) => r.tenantId === OLD_TENANT)?.endedReason).toBe("paid");

    // ‏ועכשיו: המקום שהוא צרך נשאר תפוס עד סוף היום
    await service.sweep(new Date(today.getTime() + 120_000), { dailyQuota: 1 });
    expect(await enrollments()).toHaveLength(2);
  });
});


/**
 * ‎**הודעה אינה יכולה לשאת רישום של משרד אחד ומזהה משרד של אחר.**
 *
 * ‏שני מפתחות זרים נפרדים קיבלו כל צירוף ביניהם, ופוליסת ה-RLS על
 * ‏`funnel_messages` מסננת לפי `tenant_id` בלבד — כלומר משרד ב׳ היה
 * ‏קורא נמען, יעד ונתוני מסירה של משרד א׳ (ביקורת Codex, P1).
 *
 * ‏הבדיקה רצה **דרך הבעלים**, שעוקף RLS, בכוונה: היא שואלת על
 * ‏האילוץ במסד ולא על הפוליסה. אילוץ שאפשר לעקוף בכתיבה ישירה אינו
 * ‏אילוץ.
 */
/**
 * ‎**„נשלח” הוא מצב, לא קיום שורה.**
 *
 * ‏עמודת `status` ב-`funnel_messages` נולדת `queued`, ויכולה להיות
 * ‏`failed`. הספירה של „אילו שלבים כבר יצאו” לא הסתכלה עליה בכלל,
 * ‏ולכן **ניסיון שנכשל** נחשב כשלב שיצא: הרישום היה נסגר כ„מוצה”
 * ‏על סמך הודעה שמעולם לא הגיעה, ו-`enrollDue` מוציא מהמועמדות כל
 * ‏מי שכבר היה לו רישום — כלומר ניסיון חוזר לא היה מגיע אליו
 * ‏לעולם (ביקורת Codex).
 *
 * ‏הבדיקה מריצה את שני המצבים על **אותו רגע ואותן שורות**, וזה מה
 * ‏שמבודד את התנאי: ההבדל היחיד בין „נשאר פתוח” ל„נסגר” הוא ערך
 * ‏העמודה.
 */
describe("רק הודעה שנשלחה נחשבת לשלב שיצא", () => {
  /** ‏עשרת שלבי מסלול ההמרה, כפי שנזרעו במיגרציה. */
  const CONVERSION_STAGES = [
    "d0_first_action",
    "d1_empty_screen",
    "d3_one_feature",
    "d5_intro_call",
    "d8_what_we_did",
    "d11_before_money",
    "d17_data_waiting",
    "trial_heads_up",
    "trial_closing",
    "trial_last_call",
  ];

  async function seedMessages(enrollmentId: string, status: string): Promise<void> {
    for (const [index, key] of CONVERSION_STAGES.entries()) {
      await direct.$executeRawUnsafe(
        `INSERT INTO funnel_messages
           (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel,
            token, status, sent_at, updated_at)
         VALUES ($1, $2, $3, 'conversion', $4, $5, 'a@b.com', 'email', $6, $7,
                 CASE WHEN $7 = 'sent' THEN now() ELSE NULL END, now())`,
        `01M1FNNLTESTMSG${String(index).padStart(11, "0")}`,
        OLD_TENANT,
        enrollmentId,
        key,
        "01M1FNNLTESTUSER0000000001",
        `sent-status-token-${index}`,
        status,
      );
    }
  }

  async function enrollmentIdOf(tenantId: string): Promise<string> {
    const rows = await direct.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
      tenantId,
    );
    return rows[0]!.id;
  }

  it("שורות `queued` אינן סוגרות את הרישום", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    await seedMessages(await enrollmentIdOf(OLD_TENANT), "queued");

    await service.sweep(now, { dailyQuota: 5 });
    const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(old?.endedAt, "ניסיון שלא נשלח נספר כשלב שיצא").toBeNull();
  });

  /*
   * ‏החצי השני, ובלעדיו „אף פעם לא סוגרים” היה עובר את הבדיקה
   * ‏הראשונה: אותן שורות בדיוק, במצב `sent`, כן סוגרות.
   */
  it("אותן שורות במצב `sent` כן סוגרות אותו", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    await seedMessages(await enrollmentIdOf(OLD_TENANT), "sent");

    await service.sweep(now, { dailyQuota: 5 });
    const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(old?.endedReason).toBe("completed");
  });

  /*
   * ‎**`status` ו-`sentAt` נבדקים שניהם, וזו אינה כפילות.**
   *
   * ‏השדות נכתבים יחד, ולכן שורה שנושאת `sent` בלי חותמת זמן היא
   * ‏שורה שמשהו בה השתבש — כתיבה חלקית, מיגרציה, תיקון ידני. בדיקה
   * ‏של אחד מהם בלבד הופכת כל אי-התאמה כזו לסגירה בלתי הפיכה, וזה
   * ‏הכיוון שאסור לטעות בו.
   */
  it("שורה שנושאת `sent` בלי חותמת זמן אינה נספרת", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const enrollmentId = await enrollmentIdOf(OLD_TENANT);
    await seedMessages(enrollmentId, "sent");
    await direct.$executeRawUnsafe(
      `UPDATE funnel_messages SET sent_at = NULL WHERE enrollment_id = $1`,
      enrollmentId,
    );

    await service.sweep(now, { dailyQuota: 5 });
    const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(old?.endedAt).toBeNull();
  });
});

/**
 * ‎**הגדרה שלא הצלחנו לקרוא עוצרת סגירה — מקצה לקצה.**
 *
 * ‏שורת שלב עם שעון לא מוכר נזרקת ב-`FunnelStageService`, ולכן היא
 * ‏נעדרת מרשימת השלבים שמגיעה ל-`funnelExitReason` — ואז „לא נשאר
 * ‏שלב שיכול לצאת” נכון על מה שקראנו בלבד. סגירה היא בלתי הפיכה,
 * ‏ולכן אין סוגרים על תמונה חלקית (ביקורת Codex, P1).
 *
 * ‏הבדיקה כאן ולא ביחידה כי היא מודדת את **החיבור**: שהשירות אכן
 * ‏מדווח על הפסולה, ושהסבב אכן מעביר את הדיווח הלאה.
 */
describe("שורת שלב פסולה עוצרת סגירה", () => {
  const BAD_STAGE_ID = "01M1FNNLTESTBADSTAGE000001";

  async function withBadStage(run: () => Promise<void>, track = "conversion"): Promise<void> {
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_stages
         (id, track, key, title, clock, offset_days, audience, channels, sort_order, updated_at)
       VALUES ($1, $2, 'zz_bad_clock', 'שעון שאינו קיים', 'lunar', 99,
               '{always}', '{email}', 999, now())`,
      BAD_STAGE_ID,
      track,
    );
    try {
      await run();
    } finally {
      await direct.$executeRawUnsafe(`DELETE FROM funnel_stages WHERE id = $1`, BAD_STAGE_ID);
    }
  }

  /** ‏מביא את הרישום של המשרד הוותיק לנקודה שבה כל שלביו נשלחו. */
  async function sendEveryStage(now: Date, prefix: string): Promise<void> {
    await service.sweep(now, { dailyQuota: 5 });
    const enrollmentId = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    for (const [index, key] of [
      "d0_first_action",
      "d1_empty_screen",
      "d3_one_feature",
      "d5_intro_call",
      "d8_what_we_did",
      "d11_before_money",
      "d17_data_waiting",
      "trial_heads_up",
      "trial_closing",
      "trial_last_call",
    ].entries()) {
      await direct.$executeRawUnsafe(
        `INSERT INTO funnel_messages
           (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel,
            token, status, sent_at, updated_at)
         VALUES ($1, $2, $3, 'conversion', $4, $5, 'a@b.com', 'email', $6, 'sent', now(), now())`,
        `${prefix}${String(index).padStart(26 - prefix.length, "0")}`,
        OLD_TENANT,
        enrollmentId,
        key,
        "01M1FNNLTESTUSER0000000001",
        `${prefix}-token-${index}`,
      );
    }
  }

  /*
   * ‎**שורה פסולה חוסמת את המסלול שלה, ולא את התור כולו**
   * ‏(ביקורת Codex, P2).
   *
   * ‏הדגל היה אחד לכל הרישומים, ולכן שורת **גבייה** שבורה — טבלה
   * ‏שמנהל הפלטפורמה עורך — מנעה סגירה של רישומי **המרה** שמוצו
   * ‏לגמרי, וכל סבב המשיך לסרוק אותם עד שתתוקן.
   *
   * ‏אותו מצב בדיוק כמו הבדיקה הראשונה כאן, ורק המסלול של השורה
   * ‏הפסולה שונה — ולכן היא זו שמפרידה בין „פסולה” ל„פסולה שלי”.
   */
  it("שורה פסולה במסלול הגבייה אינה מונעת סגירת רישום המרה", async () => {
    await withBadStage(async () => {
      const now = new Date();
      await sendEveryStage(now, "01M1FNNLTESTDUNBAD");
      await service.sweep(now, { dailyQuota: 5 });
      const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
      expect(old?.endedReason, "נחסם על שורה של מסלול אחר").toBe("completed");
    }, "dunning");
  });

  /*
   * ‏והצד השלישי: שורה שגם המסלול שלה אינו מוכר. שם באמת אי אפשר
   * ‏לדעת את מי היא מייצגת, ולכן היא חוסמת את כולם — כולל את המרה.
   */
  it("שורה שגם המסלול שלה אינו מוכר חוסמת גם את ההמרה", async () => {
    await withBadStage(async () => {
      const now = new Date();
      await sendEveryStage(now, "01M1FNNLTESTNOTRACK");
      await service.sweep(now, { dailyQuota: 5 });
      const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
      expect(old?.endedAt, "נסגר על שורה שאין לדעת למי היא שייכת").toBeNull();
    }, "zz_unknown");
  });

  it("כל השלבים התקפים נשלחו — והרישום נשאר פתוח", async () => {
    await withBadStage(async () => {
      const now = new Date();
      await service.sweep(now, { dailyQuota: 5 });
      const enrollmentId = (
        await direct.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
          OLD_TENANT,
        )
      )[0]!.id;
      for (const [index, key] of [
        "d0_first_action",
        "d1_empty_screen",
        "d3_one_feature",
        "d5_intro_call",
        "d8_what_we_did",
        "d11_before_money",
        "d17_data_waiting",
        "trial_heads_up",
        "trial_closing",
        "trial_last_call",
      ].entries()) {
        await direct.$executeRawUnsafe(
          `INSERT INTO funnel_messages
             (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel,
              token, status, sent_at, updated_at)
           VALUES ($1, $2, $3, 'conversion', $4, $5, 'a@b.com', 'email', $6, 'sent', now(), now())`,
          `01M1FNNLTESTBAD${String(index).padStart(11, "0")}`,
          OLD_TENANT,
          enrollmentId,
          key,
          "01M1FNNLTESTUSER0000000001",
          `bad-stage-token-${index}`,
        );
      }

      await service.sweep(now, { dailyQuota: 5 });
      const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
      expect(old?.endedAt, "נסגר למרות שורת שלב שלא נקראה").toBeNull();
    });
  });

  /*
   * ‏והצד השני: ברגע שהשורה הפסולה נעלמת, אותו מצב בדיוק כן נסגר.
   * ‏בלי זה „אף פעם לא סוגרים” היה עובר את הבדיקה שמעל.
   */
  it("בלי השורה הפסולה — אותו מצב נסגר כ„מוצה”", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const enrollmentId = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    for (const [index, key] of [
      "d0_first_action",
      "d1_empty_screen",
      "d3_one_feature",
      "d5_intro_call",
      "d8_what_we_did",
      "d11_before_money",
      "d17_data_waiting",
      "trial_heads_up",
      "trial_closing",
      "trial_last_call",
    ].entries()) {
      await direct.$executeRawUnsafe(
        `INSERT INTO funnel_messages
           (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel,
            token, status, sent_at, updated_at)
         VALUES ($1, $2, $3, 'conversion', $4, $5, 'a@b.com', 'email', $6, 'sent', now(), now())`,
        `01M1FNNLTESTGOOD${String(index).padStart(10, "0")}`,
        OLD_TENANT,
        enrollmentId,
        key,
        "01M1FNNLTESTUSER0000000001",
        `good-stage-token-${index}`,
      );
    }

    await service.sweep(now, { dailyQuota: 5 });
    const old = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(old?.endedReason).toBe("completed");
  });
});

/**
 * ‎**עוגן שנמחק בכוונה מול עוגן שרק חסר.**
 *
 * ‏אחרי שהסבב הקודם היפך את הכלל — „עוגן חסר הוא לא-ידוע ולא
 * ‏בלתי-אפשרי” — נשארה השאלה שביקשתי לבדוק בעצמי: האם יש מצב
 * ‏**שגרתי** שמייצר `null` קבוע. יש, ושלושה כאלה: מעבר עצמי
 * ‏למסלול חינמי, העברה לחינמי ממסך הפלטפורמה, והענקת תקופה ידנית.
 * ‏בכולם `trial_ends_at` נמחק ואין כרטיס — כלומר הרישום היה נשאר
 * ‏פתוח לנצח וכל סבב היה סורק אותו מחדש (ביקורת Codex).
 *
 * ‏הבדיקות כאן הן על ההבחנה עצמה, מול המסד: אותו משרד, אותו רגע,
 * ‏ושתי דרכים שונות שבהן התאריך נעלם.
 */
describe("ניסיון שנגמר סוגר, ניסיון שנעלם אינו סוגר", () => {
  /** ‏אחרי חלון כל שלבי שעון המשפך (יום 17 ועוד תקרת פיגור של שבוע). */
  const AFTER_FUNNEL_CLOCK = 60 * DAY;

  /** ‏פותח רישום למשרד הוותיק ומחזיר את הרגע שאחרי כל שלבי המשפך. */
  async function enrolledThenLater(): Promise<Date> {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const open = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(open?.endedAt, "הרישום לא נפתח").toBeNull();
    return new Date(now.getTime() + AFTER_FUNNEL_CLOCK);
  }

  async function reasonAfterSweep(later: Date): Promise<string | null | undefined> {
    await service.sweep(later, { dailyQuota: 5 });
    return (await enrollments()).find((r) => r.tenantId === OLD_TENANT)?.endedReason;
  }

  it("מעבר למסלול חינמי — הרישום נסגר במקום להישאר פתוח לנצח", async () => {
    const later = await enrolledThenLater();
    // ‏בדיוק מה ש-`switchToFreePlan` כותב: פעיל, בלי ניסיון, בלי כרטיס
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', plan = 'free', trial_ends_at = NULL,
                          paid_until = NULL, trial_concluded_at = now() WHERE id = $1`,
      OLD_TENANT,
    );
    expect(await reasonAfterSweep(later)).toBe("completed");
  });

  it("הענקת תקופה ידנית מסיימת אותו גם כשהסטטוס נשאר „ניסיון”", async () => {
    const later = await enrolledThenLater();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = NULL, paid_until = $2, trial_concluded_at = now()
        WHERE id = $1`,
      OLD_TENANT,
      new Date(later.getTime() + 30 * DAY),
    );
    expect(await reasonAfterSweep(later)).toBe("completed");
  });

  /*
   * ‏והצד השני — בלעדיו כל הבדיקה שמעל הייתה עוברת גם עם „תמיד
   * ‏לסגור”, כלומר עם הבאג שהסבב הקודם תיקן. אותו תאריך שנמחק,
   * ‏אבל מ-`billing-override` בלבד: המשרד עדיין בניסיון, התאריך
   * ‏יכול לחזור מאותו מסך, והרישום נשאר פתוח.
   */
  /*
   * ‎**„פתח ללא תפוגה” — המקרה שהניחוש לא יכול היה לראות.**
   *
   * ‏הכפתור שולח `paidUntil: null`, והשרת מוחק גם את תאריך הניסיון
   * ‏ומשאיר את הסטטוס „ניסיון”. כלומר שלוש העמודות זהות לאיפוס
   * ‏הזמני, וכל הסקה מהן הייתה חייבת לטעות באחד משני הכיוונים
   * ‏(ביקורת Codex). הסיבה הרשומה מכריעה.
   */
  it("„פתח ללא תפוגה” מסיים את הניסיון — למרות שהסטטוס נשאר „ניסיון”", async () => {
    const later = await enrolledThenLater();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = NULL, paid_until = NULL,
                          trial_concluded_at = now() WHERE id = $1`,
      OLD_TENANT,
    );
    expect(await reasonAfterSweep(later)).toBe("completed");
  });

  it("איפוס התאריך לבדו — הרישום נשאר פתוח", async () => {
    const later = await enrolledThenLater();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = NULL WHERE id = $1`,
      OLD_TENANT,
    );
    await service.sweep(later, { dailyQuota: 5 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נסגר על עוגן שרק חסר").toBeNull();
  });

  /*
   * ‎**קופון של 100%‎ — הפעלה בלי כרטיס** (ביקורת Codex, P2).
   *
   * ‏בדיוק מה ש-`activateWithin` כותב במסלול הקופון: מסלול בתשלום,
   * ‏סטטוס פעיל, תקופה בתשלום פתוחה, הניסיון נגמר ונרשם — **ואין
   * ‏שורת מנוי עם כרטיס**. השעון כאן הוא יום למחרת, כלומר בזמן
   * ‏ששלבי שעון-המשפך עדיין בתוקף: זו הנקודה שבה `hasValidCard`
   * ‏לבדו היה משאיר את הרישום פתוח, והלקוח המופעל היה נשאר מועמד
   * ‏להודעות מכירה.
   */
  it("הפעלה בקופון של 100%‎ נסגרת כ„שילם”, כבר בזמן שלבי המשפך", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', plan = 'basic', trial_ends_at = NULL,
                          paid_until = $2, trial_concluded_at = now() WHERE id = $1`,
      OLD_TENANT,
      new Date(now.getTime() + 30 * DAY),
    );
    await service.sweep(new Date(now.getTime() + DAY), { dailyQuota: 5 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedReason, "נשאר פתוח בלי כרטיס").toBe("paid");
  });

  /*
   * ‏ושהסגירה אינה מקדימה את זמנה: אותו משרד חינמי בדיוק, אבל
   * ‏בעוד שלבי שעון המשפך בתוקף, נשאר פתוח ויקבל אותם.
   *
   * ‏זו גם ההבחנה שהבדיקה שמעליה נשענת עליה: שתי הכתיבות משאירות
   * ‏‎`status = 'active'` ללא כרטיס, ורק `paid_until` מפריד ביניהן.
   */
  it("משרד חינמי אינו נסגר כל עוד שלבי המשפך בתוקף", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', plan = 'free', trial_ends_at = NULL,
                          paid_until = NULL, trial_concluded_at = now() WHERE id = $1`,
      OLD_TENANT,
    );
    await service.sweep(new Date(now.getTime() + DAY), { dailyQuota: 5 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נסגר לפני שכל שלבי המשפך פגו").toBeNull();
  });
});

/**
 * ‎**ניסיון שהוחזר פותח מחדש את הרישום שנסגר.**
 *
 * ‏`enrollDue` מוציא מהמועמדות כל מי שאי פעם היה לו רישום, ולכן
 * ‏משרד שנסגר כ„מוצה” וקיבל אחר כך ניסיון חדש לא היה מקבל דבר —
 * ‏גם כשיש לו שוב תפוגה אמיתית להזהיר מפניה (ביקורת Codex).
 */
describe("ניסיון שהוחזר פותח מחדש רישום שנסגר", () => {
  const AFTER = 60 * 24 * 60 * 60 * 1000;

  async function closeAsCompleted(): Promise<void> {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', plan = 'free', trial_ends_at = NULL,
                          paid_until = NULL, trial_concluded_at = now() WHERE id = $1`,
      OLD_TENANT,
    );
    await service.sweep(new Date(now.getTime() + AFTER), { dailyQuota: 5 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedReason, "ההכנה נכשלה — הרישום לא נסגר").toBe("completed");
  }

  /**
   * ‎**„ניסיון שהוחזר” הוא סטטוס **וגם** תאריך** (ביקורת Codex, P2).
   *
   * ‏שתי בדיקות כאן קראו ל-`reopenForRestoredTrial` על משרד שהוא
   * ‏`active` בלי תפוגה — כלומר ניסיון שלא הוחזר כלל — וציפו
   * ‏שייפתח. הן היו ירוקות בדיוק על הבאג: הפתיחה לא שאלה על
   * ‏הניסיון, ומסך העקיפה יכול היה לפתוח רישום למשרד פעיל.
   *
   * ‏המצב שהבדיקה מתארת נבנה עכשיו במלואו, וכמו במסלול האמיתי —
   * ‏שורת הדייר מתעדכנת **לפני** הפתיחה, באותה טרנזקציה שבה
   * ‏`reopenWithin` רץ אצל הבקר.
   */
  async function restoreTrial(): Promise<void> {
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'trial', trial_ends_at = $2, trial_concluded_at = NULL
        WHERE id = $1`,
      OLD_TENANT,
      new Date(Date.now() + 10 * DAY),
    );
  }

  it("נפתח מחדש, ובלי לאפס את יום 0", async () => {
    await closeAsCompleted();
    await restoreTrial();
    const before = (await enrollments()).find((r) => r.tenantId === OLD_TENANT)!;

    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(true);

    const after = (await enrollments()).find((r) => r.tenantId === OLD_TENANT)!;
    expect(after.endedAt).toBeNull();
    expect(after.endedReason).toBeNull();
    /*
     * ‎**וזה העיקר.** המשרד כבר קיבל את תוכן ההפעלה; מה שחסר לו הוא
     * ‏שלבי הניסיון. `startedAt` שהיה מתאפס היה מגיש לו את „הוסיפו
     * ‏נכס ראשון” בפעם השנייה.
     */
    expect(after.startedAt.getTime()).toBe(before.startedAt.getTime());
  });

  it("רישום פתוח אינו נפתח שוב ואינו נכפל", async () => {
    await service.sweep(new Date(), { dailyQuota: 5 });
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
    const rows = (await enrollments()).filter((r) => r.tenantId === OLD_TENANT);
    expect(rows.length).toBe(1);
  });

  /*
   * ‎`opted_out` הוא בקשה מפורשת להפסיק, ופתיחה מחדש הייתה מבטלת
   * ‏אותה. זו ההבחנה שבלעדיה „לפתוח כל מה שנסגר” היה עובר.
   */
  it("מי שביקש להפסיק אינו נפתח מחדש", async () => {
    await closeAsCompleted();
    /* ‏הניסיון מוחזר, אחרת „לא נפתח” היה נכון מסיבה אחרת לגמרי */
    await restoreTrial();
    await direct.$executeRawUnsafe(
      `UPDATE funnel_enrollments SET ended_reason = 'opted_out' WHERE tenant_id = $1`,
      OLD_TENANT,
    );
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt).not.toBeNull();
  });

  /*
   * ‎**האינדקס החלקי מתיר רישום סגור לצד רישום פתוח, ולכן המצב הזה
   * ‏קיים במסד גם אם הקוד אינו יוצר אותו.**
   *
   * ‏פתיחה מחדש בלי הבדיקה הייתה מייצרת שני רישומים פתוחים —
   * ‏הפרה של האינדקס, כלומר 500 על פעולת ניהול תמימה. השורה
   * ‏נשתלת ישירות כי זו בדיוק הנקודה: השער קיים בשביל מצב שהקוד
   * ‏מבטיח שלא ייווצר, וההבטחה אינה מה שנאכף במסד.
   */
  it("רישום פתוח לצד רישום סגור — לא נפתח שני", async () => {
    await closeAsCompleted();
    await restoreTrial();
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, updated_at)
       VALUES ($1, $2, 'conversion', now(), now())`,
      "01M1FNNLTESTSECONDOPEN0001",
      OLD_TENANT,
    );
    try {
      expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
      const rows = (await enrollments()).filter(
        (r) => r.tenantId === OLD_TENANT && r.endedAt === null,
      );
      expect(rows.length, "נוצר רישום פתוח שני").toBe(1);
    } finally {
      await direct.$executeRawUnsafe(
        `DELETE FROM funnel_enrollments WHERE id = $1`,
        "01M1FNNLTESTSECONDOPEN0001",
      );
    }
  });

  /*
   * ‎**המרוץ: הסבב קרא, המנהל החזיר ניסיון, הסבב כתב.**
   *
   * ‏הפתיחה-מחדש רואה רישום שעדיין פתוח ואינה עושה דבר; הסבב
   * ‏המיושן סוגר אותו על סמך תמונה שכבר אינה נכונה, והתוצאה היא
   * ‏ניסיון חי לצד רישום סגור ש-`enrollDue` לא יקבל שוב (ביקורת
   * ‏Codex). `close` מותנה בעוגן שההחלטה התקבלה עליו, ולכן הכתיבה
   * ‏המיושנת פשוט אינה חלה.
   */
  it("סגירה על סמך תמונה מיושנת אינה חלה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    // ‏התמונה שהסבב קרא: ניסיון שנגמר
    const stale = { trialEndsAt: null, trialConcludedAt: new Date() };
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', trial_ends_at = NULL,
                          trial_concluded_at = $2 WHERE id = $1`,
      OLD_TENANT,
      stale.trialConcludedAt,
    );
    // ‏ואז המנהל החזיר ניסיון, לפני שהסבב הספיק לכתוב
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'trial', trial_ends_at = $2,
                          trial_concluded_at = NULL WHERE id = $1`,
      OLD_TENANT,
      new Date(now.getTime() + 10 * DAY),
    );

    expect(await service.close(id, "completed", now, { ...stale, tenantId: OLD_TENANT, hasCard: false })).toBe(
      false,
    );
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נסגר על סמך תמונה מיושנת").toBeNull();
  });

  /*
   * ‎**והמרוץ האמיתי: שתי טרנזקציות בו-זמנית.**
   *
   * ‏הבדיקות שלמעלה מזיזות את העוגן ואז קוראות ל-`close` — כלומר
   * ‏הן בודקות את **התנאי**, לא את הנעילה. ב-`READ COMMITTED`
   * ‏השאילתה קוראת את הגרסה המאושרת האחרונה, ולכן טרנזקציה פתוחה
   * ‏ולא מאושרת הייתה בלתי נראית לה והסגירה הייתה חלה על תמונה
   * ‏מיושנת (ביקורת Codex). כאן הטרנזקציה השנייה באמת פתוחה בזמן
   * ‏שהסגירה רצה.
   */
  it("סגירה ממתינה לטרנזקציה שמחזירה ניסיון, ואז אינה חלה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    const concluded = new Date();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', trial_ends_at = NULL,
                          trial_concluded_at = $2 WHERE id = $1`,
      OLD_TENANT,
      concluded,
    );

    let closed: boolean | undefined;
    await direct.$transaction(async (tx) => {
      // ‏המסך מחזיר ניסיון ונועל את שורת הדייר — ועדיין לא אישר
      await tx.$executeRawUnsafe(
        `UPDATE tenants SET status = 'trial', trial_ends_at = $2,
                            trial_concluded_at = NULL WHERE id = $1`,
        OLD_TENANT,
        new Date(now.getTime() + 10 * DAY),
      );
      /*
       * ‏הסגירה יוצאת לדרך **בזמן** שהטרנזקציה פתוחה. בלי הנעילה
       * ‏היא הייתה קוראת את הערכים הישנים, מוצאת התאמה, וסוגרת.
       * ‏עם הנעילה היא ממתינה כאן עד ה-COMMIT שלמטה.
       */
      const racing = service
        .close(id, "completed", now, {
          tenantId: OLD_TENANT,
          trialEndsAt: null,
          trialConcludedAt: concluded,
          hasCard: false,
        })
        .then((result) => {
          closed = result;
        });
      // ‏שהות קצרה כדי שהסגירה תגיע לנעילה לפני שאנחנו מאשרים
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(closed, "הסגירה לא המתינה לנעילה").toBeUndefined();
      // ‏ה-COMMIT קורה כשהקולבק מסתיים; הסגירה משתחררת אחריו
      void racing;
    });

    // ‏עכשיו היא רצה על הערכים החדשים ואינה חלה
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(closed, "נסגר למרות שהניסיון הוחזר").toBe(false);
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt).toBeNull();
  });

  /**
   * ‎**ושורת מנוי שאינה קיימת — `FOR UPDATE` עליה נועל אפס שורות.**
   *
   * ‏משרד שנרשם בעצמו מקבל דייר ומשתמש בלבד; שורת המנוי נוצרת רק
   * ‏במגע הראשון עם החיוב. עד אז הנעילה על „המנוי של המשרד” אינה
   * ‏נועלת דבר — **בשקט** — וקריאה חוזרת של תשלום יכולה ליצור את
   * ‏השורה עם כרטיס בדיוק אחרי שהסגירה קראה „אין כרטיס”. שתי
   * ‏הטרנזקציות מאשרות, והרישום נסגר כ„מוצה” על משרד ששילם
   * ‏(ביקורת Codex, P2).
   *
   * ‏הבדיקה מחזיקה את נעילת הייעוץ מחיבור שני — בדיוק מה שיוצר
   * ‏המנוי לוקח — ומראה שהסגירה **ממתינה** לה. בלי הנעילה בקוד
   * ‏היא הייתה עוברת מיד; זו העדות שהיא נלקחת.
   */
  it("סגירה ממתינה גם כשאין עדיין שורת מנוי", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    /* ‏אין שורת מנוי — זה בדיוק המצב שנבדק */
    expect(
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM subscriptions WHERE tenant_id = $1`,
        OLD_TENANT,
      ),
    ).toHaveLength(0);

    /* ‏העוגן נקרא מהשורה עצמה — סגירה שאינה חלה אינה מוכיחה דבר */
    const anchor = (
      await direct.$queryRawUnsafe<{ trial_ends_at: Date | null; trial_concluded_at: Date | null }[]>(
        `SELECT trial_ends_at, trial_concluded_at FROM tenants WHERE id = $1`,
        OLD_TENANT,
      )
    )[0]!;

    let closed: boolean | undefined;
    let racing: Promise<void> | undefined;
    await direct.$transaction(async (tx) => {
      // ‏יוצר המנוי לוקח את נעילת הייעוץ ועדיין לא אישר
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `subscription:${OLD_TENANT}`,
      );
      racing = service
        .close(id, "completed", now, {
          tenantId: OLD_TENANT,
          trialEndsAt: anchor.trial_ends_at,
          trialConcludedAt: anchor.trial_concluded_at,
          hasCard: false,
        })
        .then((result) => {
          closed = result;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(closed, "הסגירה לא המתינה לנעילה שאין מאחוריה שורה").toBeUndefined();
    });

    await racing;
    expect(closed, "לא נסגרה גם אחרי שהנעילה שוחררה").toBe(true);
  });

  /*
   * ‎**וכל אחת משתי העמודות לבדה עוצרת את הסגירה.**
   *
   * ‏במסלולי האפליקציה השתיים זזות יחד — המסך שמחזיר ניסיון כותב
   * ‏תאריך **וגם** מנקה את הסיום — ולכן בדיקה שמזיזה את שתיהן
   * ‏עוברת גם עם חצי מהשער. במסד הן עמודות נפרדות, והשער אמור
   * ‏לזהות **כל** שינוי בעוגן ולא צירוף אחד. לכן כל עמודה נבדקת
   * ‏לבדה, בכתיבה ישירה.
   */
  it("שינוי בתאריך הניסיון לבדו עוצר את הסגירה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    const concluded = new Date();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = $2, trial_concluded_at = $3 WHERE id = $1`,
      OLD_TENANT,
      new Date(now.getTime() + 10 * DAY),
      concluded,
    );
    // ‏הסיום זהה לתמונה; רק התאריך זז
    expect(
      await service.close(id, "completed", now, {
        tenantId: OLD_TENANT,
        trialEndsAt: null,
        trialConcludedAt: concluded,
        hasCard: false,
      }),
    ).toBe(false);
  });

  it("שינוי בסיום הניסיון לבדו עוצר את הסגירה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = NULL, trial_concluded_at = NULL WHERE id = $1`,
      OLD_TENANT,
    );
    // ‏התאריך זהה לתמונה (ריק); רק הסיום זז
    expect(
      await service.close(id, "completed", now, {
        tenantId: OLD_TENANT,
        trialEndsAt: null,
        trialConcludedAt: new Date(),
        hasCard: false,
      }),
    ).toBe(false);
  });

  /*
   * ‎**וגם הכרטיס — לא רק העוגן.**
   *
   * ‏תשלום על מספר או על מקום וואטסאפ שומר כרטיס בשורת המנוי בלבד.
   * ‏שורת הדייר אינה זזה, ולכן תנאי העוגן עובר והרישום היה נסגר
   * ‏כ„מוצה” במקום כ„שילם” — סיבה שגויה על סגירה בלתי הפיכה
   * ‏(ביקורת Codex).
   */
  it("כרטיס שנוסף בין הקריאה לכתיבה עוצר את הסגירה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    /*
     * ‎**העוגן חייב להתאים לתמונה** — אחרת תנאי העוגן דוחה ממילא
     * ‏והבדיקה אינה נוגעת בכרטיס כלל. זה בדיוק מה שקרה בגרסה
     * ‏הראשונה שלה: מוטציה שהסירה את בדיקת הכרטיס שרדה אותה.
     */
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = NULL, trial_concluded_at = NULL WHERE id = $1`,
      OLD_TENANT,
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status,
                                  card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'active', 'tok', 12, 2099, now(), now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET card_token_encrypted = 'tok', card_month = 12, card_year = 2099`,
      "01M1FNNLTESTCARDRACE000001",
      OLD_TENANT,
    );
    // ‏התמונה נקראה לפני התשלום: „אין כרטיס”
    expect(
      await service.close(id, "completed", now, {
        tenantId: OLD_TENANT,
        trialEndsAt: null,
        trialConcludedAt: null,
        hasCard: false,
      }),
    ).toBe(false);
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נסגר כ„מוצה” אחרי שנכנס כרטיס").toBeNull();
  });

  /*
   * ‏והצד השני, שבלעדיו „לעולם לא לסגור” היה עובר: אותה קריאה
   * ‏בדיוק, כשהעוגן לא זז, כן סוגרת.
   */
  it("ואותה סגירה כשהעוגן לא זז — חלה", async () => {
    const now = new Date();
    await service.sweep(now, { dailyQuota: 5 });
    const id = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;
    const concluded = new Date();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', trial_ends_at = NULL,
                          trial_concluded_at = $2 WHERE id = $1`,
      OLD_TENANT,
      concluded,
    );
    expect(
      await service.close(id, "completed", now, {
        tenantId: OLD_TENANT,
        trialEndsAt: null,
        trialConcludedAt: concluded,
        hasCard: false,
      }),
    ).toBe(true);
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedReason).toBe("completed");
  });

  it("משרד שמעולם לא נרשם — אין מה לפתוח", async () => {
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
  });

  /*
   * ‎**תאריך עתידי למשרד פעיל אינו „ניסיון שהוחזר”** (ביקורת Codex,
   * ‏P2).
   *
   * ‏מסך העקיפה מזין תאריך בלבד ואינו נוגע בסטטוס. בלי השאלה הזו
   * ‏נפתח רישום המרה למשרד **משלם**, שאיש לא התכוון אליו ושאין לו
   * ‏מה לשלוח — וניקוי התאריך אחר כך היה משאיר אותו פתוח לתמיד.
   */
  it("תאריך עתידי למשרד פעיל — אינו נפתח", async () => {
    await closeAsCompleted();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', trial_ends_at = $2 WHERE id = $1`,
      OLD_TENANT,
      new Date(Date.now() + 10 * DAY),
    );
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נפתח למשרד שאינו בניסיון").not.toBeNull();
  });

  /*
   * ‏ואותו משרד בדיוק, כשהסטטוס **כן** חזר לניסיון — נפתח. בלי
   * ‏הצד הזה „לעולם אל תפתח” היה עובר.
   */
  it("ואותו משרד כשהסטטוס חזר לניסיון — נפתח", async () => {
    await closeAsCompleted();
    await restoreTrial();
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(true);
  });

  /*
   * ‎**וגם הסבב אינו פותח אותו** — הסינון עבר לתוך שאילתת הרישומים
   * ‏(ביקורת Codex, P2), ולכן זו הדרך לראות שהוא באמת שם: רישום
   * ‏שנסגר כ„שילם”, למשרד עם תאריך עתידי ובלי סטטוס ניסיון, אינו
   * ‏חוזר מהשאילתה כלל.
   */
  it("והסבב אינו פותח רישום ששולם למשרד שאינו בניסיון", async () => {
    await closeAsCompleted();
    await direct.$executeRawUnsafe(
      `UPDATE funnel_enrollments SET ended_reason = 'paid' WHERE tenant_id = $1`,
      OLD_TENANT,
    );
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active', trial_ends_at = $2 WHERE id = $1`,
      OLD_TENANT,
      new Date(Date.now() + 10 * DAY),
    );
    await service.sweep(new Date(), { dailyQuota: 5, pageSize: 1 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "הסבב פתח רישום למשרד שאינו בניסיון").not.toBeNull();
  });

  /* ‏והצד השני: אותו רישום „שילם”, כשהמשרד באמת בניסיון — נפתח. */
  it("ופותח אותו כשהמשרד בניסיון חי", async () => {
    await closeAsCompleted();
    await direct.$executeRawUnsafe(
      `UPDATE funnel_enrollments SET ended_reason = 'paid' WHERE tenant_id = $1`,
      OLD_TENANT,
    );
    await restoreTrial();
    await service.sweep(new Date(), { dailyQuota: 5, pageSize: 1 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "הסבב לא פתח רישום למשרד בניסיון חי").toBeNull();
  });

  /*
   * ‏ואחרי הפתיחה, הסבב אינו סוגר אותו מיד: התאריך החדש מחזיר את
   * ‏שלבי הניסיון לתוקף, וזו כל מטרת הפתיחה.
   */
  it("אחרי החזרת התאריך הסבב אינו סוגר אותו שוב", async () => {
    await closeAsCompleted();
    await restoreTrial();
    expect(await service.reopenForRestoredTrial(OLD_TENANT), "לא נפתח מחדש").toBe(true);
    await service.sweep(new Date(), { dailyQuota: 5 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "נסגר למרות שהניסיון חזר").toBeNull();
  });
});

describe("שלמות בין הודעה לרישום", () => {
  it("‏‎INSERT עם רישום של משרד אחר נדחה במסד", async () => {
    await service.sweep(new Date(), { dailyQuota: 5 });
    const rows = await enrollments();
    const mine = rows.find((r) => r.tenantId === OLD_TENANT);
    expect(mine, "לא נפתח רישום לוותיק").toBeDefined();

    const enrollmentId = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;

    await expect(
      direct.$executeRawUnsafe(
        `INSERT INTO funnel_messages
           (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel, token, updated_at)
         VALUES ($1, $2, $3, 'conversion', 'day0', $4, 'a@b.com', 'email', $5, now())`,
        "01M1FNNLTESTCROSSTENANT01",
        // ‏מזהה משרד **אחר** מזה שהרישום שייך לו
        NEW_TENANT,
        enrollmentId,
        "01M1FNNLTESTUSER0000000001",
        "cross-tenant-token-1",
      ),
    ).rejects.toThrow();
  });

  it("‏‎INSERT עם אותו משרד מתקבל — האילוץ אינו חוסם שימוש תקין", async () => {
    await service.sweep(new Date(), { dailyQuota: 5 });
    const enrollmentId = (
      await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1 LIMIT 1`,
        OLD_TENANT,
      )
    )[0]!.id;

    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_messages
         (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel, token, updated_at)
       VALUES ($1, $2, $3, 'conversion', 'day0', $4, 'a@b.com', 'email', $5, now())`,
      "01M1FNNLTESTSAMETENANT01A",
      OLD_TENANT,
      enrollmentId,
      "01M1FNNLTESTUSER0000000001",
      "same-tenant-token-1",
    );

    const count = await direct.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM funnel_messages WHERE id = $1`,
      "01M1FNNLTESTSAMETENANT01A",
    );
    expect(Number(count[0]!.n)).toBe(1);
  });
});

/**
 * ‎**הכניסה עצמה — נעילה, בדיקה חוזרת, ופתיחה מחדש** (ביקורת Codex, P2).
 *
 * ‏שלושת הממצאים כאן הם אותה משפחה: **מה שנקרא קודם אינו מה שנכון
 * ‏עכשיו.** תשלום שמאושר בין הקריאה לכתיבה, כרטיס שנמחק אחרי
 * ‏שהרישום נסגר, ורשימת מדולגים שגדלה מדף לדף.
 */
describe("כניסה למשפך — הזכאות נבדקת ליד הכתיבה", () => {
  const FUTURE_YEAR = new Date().getUTCFullYear() + 2;

  async function giveCard(tenantId: string, id: string): Promise<void> {
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())
       ON CONFLICT (tenant_id) DO UPDATE SET card_token_encrypted = 'tok', card_month = 12, card_year = EXCLUDED.card_year`,
      id,
      tenantId,
      FUTURE_YEAR,
    );
  }

  /*
   * ‏הראיה שהכניסה **ממתינה** לנעילה: בלעדיה היא רצה מיד, ואז
   * ‏תשלום שמאושר באותו רגע אינו נראה לה. אותה צורה בדיוק כמו
   * ‏בדיקת הנעילה של הסגירה.
   */
  /*
   * ‎**ונעילת שורה, ולא רק נעילת הייעוץ** (ביקורת Codex, P2).
   *
   * ‏נעילת הייעוץ מכסה את המקרה ששורת המנוי אינה קיימת, אבל היא
   * ‏נלקחת רק על ידי מי שיודע עליה — ומסלולי התשלום (`activateWithin`,
   * ‏רכישת מספר או מקום וואטסאפ) אינם. נעילת שורה נלקחת בכל
   * ‏`UPDATE`, בין אם הכותב יודע עליה ובין אם לא, ולכן היא זו
   * ‏שמסדרת אותנו מולם.
   *
   * ‏הבדיקה מחזיקה את **השורה** מחיבור שני, בלי נעילת הייעוץ כלל.
   */
  it("הכניסה ממתינה גם לנעילת שורת המנוי עצמה", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', now(), now())`,
      "01M1FNNLTESTR0WL0CKSUB0001",
      NEW_TENANT,
    );
    let enrolled: number | undefined;
    let racing: Promise<void> | undefined;
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT id FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`,
        NEW_TENANT,
      );
      racing = service.sweep(new Date(), { dailyQuota: 0 }).then((result) => {
        enrolled = result.enrolled;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(enrolled, "הכניסה לא המתינה לנעילת השורה").toBeUndefined();
    });
    await racing;
    expect(enrolled, "לא נכנסה גם אחרי שהנעילה שוחררה").toBeGreaterThan(0);
  });

  it("הכניסה ממתינה לנעילת המנוי של אותו משרד", async () => {
    expect(await enrollments()).toHaveLength(0);

    let enrolled: number | undefined;
    let racing: Promise<void> | undefined;
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `subscription:${NEW_TENANT}`,
      );
      racing = service
        .sweep(new Date(), { dailyQuota: 0 })
        .then((result) => {
          enrolled = result.enrolled;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(enrolled, "הכניסה לא המתינה לנעילה").toBeUndefined();
    });

    await racing;
    expect(enrolled, "לא נכנסה גם אחרי שהנעילה שוחררה").toBeGreaterThan(0);
  });

  /**
   * ‎**ומה שהנעילה מגנה עליו: הבדיקה החוזרת — במרוץ אמיתי.**
   *
   * ‏גרסה ראשונה של הבדיקות האלה שינתה את המצב **לפני** הסבב,
   * ‏ושתי מוטציות שרדו אותן: סינון הדף (`status: "trial"`,
   * ‏`withoutValidCard`) תפס את המקרה לפני שהבדיקה החוזרת רצה
   * ‏בכלל, כלומר הן בדקו את הסינון ולא את מה שנוסף.
   *
   * ‏כאן ההמרה קורית **בתוך החלון**: הטרנזקציה מחזיקה את הנעילה,
   * ‏הסבב כבר קרא את הדף וממתין, ההמרה נכתבת ומאושרת יחד עם
   * ‏שחרור הנעילה. זה בדיוק התזמון שהממצא מתאר.
   */
  async function convertWhileSweepWaits(
    write: (tx: Parameters<Parameters<typeof direct.$transaction>[0]>[0]) => Promise<unknown>,
  ): Promise<number> {
    let enrolled: number | undefined;
    let racing: Promise<void> | undefined;
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `subscription:${NEW_TENANT}`,
      );
      racing = service.sweep(new Date(), { dailyQuota: 0 }).then((result) => {
        enrolled = result.enrolled;
      });
      /* ‏הסבב קרא את הדף (המשרד עדיין זכאי) וממתין לנעילה */
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(enrolled, "הסבב לא המתין לנעילה — אין חלון לבדוק בו").toBeUndefined();
      await write(tx);
    });
    await racing;
    return enrolled ?? -1;
  }

  it("המרה שמאושרת בחלון — המשרד אינו נרשם (קופון של 100%, בלי כרטיס)", async () => {
    expect(
      await convertWhileSweepWaits((tx) =>
        tx.$executeRawUnsafe(`UPDATE tenants SET status = 'active' WHERE id = $1`, NEW_TENANT),
      ),
    ).toBe(0);
    expect((await enrollments()).some((r) => r.tenantId === NEW_TENANT)).toBe(false);
  });

  it("וכרטיס שנשמר בחלון — גם הוא עוצר את הכניסה", async () => {
    expect(
      await convertWhileSweepWaits((tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
           VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
          "01M1FNNLTESTRACECARD000001",
          NEW_TENANT,
          FUTURE_YEAR,
        ),
      ),
    ).toBe(0);
    expect((await enrollments()).some((r) => r.tenantId === NEW_TENANT)).toBe(false);
  });

  /*
   * ‎**דף שכולו מדולגים אינו עוצר את הסבב ואינו מרעיב את מי
   * שאחריו.** הסמן מתקדם על מה שנראה, לא על מה שנשאר.
   */
  it("דף מלא בבעלי כרטיס אינו מסתיר את המועמד שאחריו", async () => {
    /*
     * ‏משרד טרי נוסף, ותיק ממנו ביום — כלומר **קודם** ב-`createdAt
     * ‏asc` — ועם כרטיס תקף. עם `pageSize: 1` הדף הראשון כולו
     * ‏מדולג, והמועמד האמיתי יושב בדף השני.
     *
     * ‏זו הצורה שהפילה את הגרסה שלפני הסמן: „דף בלי קליטה” נראה
     * ‏כמו סוף הרשימה. הגרסה עם `notIn` פתרה את זה במחיר רשימה
     * ‏שגדלה בלי גבול; הסמן מתקדם על מה שנראה.
     */
    const blocker = "01M1FNNLTESTBL0CKERFRESH01";
    await seedTenant(blocker, "משרד טרי עם כרטיס", 1);
    await giveCard(blocker, "01M1FNNLTESTCARDBL0CKER001");
    try {
      await service.sweep(new Date(), { dailyQuota: 0, pageSize: 1 });
      const rows = await enrollments();
      expect(rows.some((r) => r.tenantId === blocker)).toBe(false);
      expect(rows.some((r) => r.tenantId === NEW_TENANT)).toBe(true);
    } finally {
      await direct.$executeRawUnsafe(
        `DELETE FROM funnel_enrollments WHERE tenant_id = $1`,
        blocker,
      );
      await direct.$executeRawUnsafe(`DELETE FROM subscriptions WHERE tenant_id = $1`, blocker);
      await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, blocker);
    }
  });
});

describe("פתיחה מחדש — גם אחרי „שילם”, כשהכרטיס נעלם", () => {
  const FUTURE_YEAR = new Date().getUTCFullYear() + 2;

  async function closedAs(reason: string): Promise<void> {
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, ended_at, ended_reason, created_at, updated_at)
       VALUES ($1, $2, 'conversion', now() - interval '10 days', now() - interval '1 day', $3, now(), now())`,
      "01M1FNNLTESTREOPENROW00001",
      OLD_TENANT,
      reason,
    );
  }

  /*
   * ‏הנימוק המקורי — „`paid` ייסגר שוב מיד” — נכון רק כל עוד
   * ‏הכרטיס קיים. `switchToFreePlan` מוחק אותו, ואז המשרד נתקע:
   * ‏ניסיון חי, רישום סגור, ו-`enrollDue` אינו מקבל אותו שוב.
   */
  it("רישום שנסגר כ„שילם” נפתח כשאין כרטיס", async () => {
    await closedAs("paid");
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(true);
  });

  it("ואינו נפתח כשהכרטיס עדיין תקף — הסבב הבא היה סוגר אותו מיד", async () => {
    await closedAs("paid");
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTREOPENCARD0001",
      OLD_TENANT,
      FUTURE_YEAR,
    );
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
  });

  /* ‏„ביקש להפסיק” נשאר סגור בכל מצב — זו בקשה מפורשת */
  it("‏„ביקש להפסיק” אינו נפתח גם בלי כרטיס", async () => {
    await closedAs("opted_out");
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);
  });

  /*
   * ‎**והשאלה חוזרת בכל סבב, ולא רק ברגע ההחזרה** (ביקורת Codex, P2).
   *
   * ‏פתיחה-מחדש היא אירוע חד-פעמי, ו-`enrollDue` מוציא לתמיד מי
   * ‏שהיה לו רישום. כרטיס שפג **אחרי** ההחזרה השאיר לכן ניסיון
   * ‏חי בלי שום שלב שיישלח בו — אותה מלכודת קבועה, בתזמון אחר.
   */
  it("כרטיס שפג אחרי ההחזרה — הסבב פותח את הרישום", async () => {
    await closedAs("paid");
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTLAPSEDCARD0001",
      OLD_TENANT,
      FUTURE_YEAR,
    );
    /* ‏ברגע ההחזרה יש כרטיס — ולכן הרישום נשאר סגור, וזה נכון */
    expect(await service.reopenForRestoredTrial(OLD_TENANT)).toBe(false);

    /* ‏ואז הכרטיס פג */
    await direct.$executeRawUnsafe(
      `UPDATE subscriptions SET card_year = 2020 WHERE tenant_id = $1`,
      OLD_TENANT,
    );
    await service.sweep(new Date(), { dailyQuota: 0 });

    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedAt, "הרישום לא נפתח מחדש אחרי שהכרטיס פג").toBeNull();
    expect(row?.endedReason).toBeNull();
  });

  /*
   * ‏הסינון היחיד שהסבב עושה בעצמו: שהניסיון חי. בלעדיו משרד
   * ‏שיצא מהניסיון — ואפילו משלם — היה מקבל רישום מכירה פתוח
   * ‏ברגע שהכרטיס שלו מנוקה.
   */
  it("משרד שכבר אינו בניסיון אינו נפתח מחדש, גם בלי כרטיס", async () => {
    await closedAs("paid");
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'active' WHERE id = $1`,
      OLD_TENANT,
    );
    await service.sweep(new Date(), { dailyQuota: 0 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedReason).toBe("paid");
  });

  it("ועם כרטיס תקף הסבב אינו פותח", async () => {
    await closedAs("paid");
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, card_token_encrypted, card_month, card_year, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', 'tok', 12, $3, now(), now())`,
      "01M1FNNLTESTVAL1DCARD00001",
      OLD_TENANT,
      FUTURE_YEAR,
    );
    await service.sweep(new Date(), { dailyQuota: 0 });
    const row = (await enrollments()).find((r) => r.tenantId === OLD_TENANT);
    expect(row?.endedReason).toBe("paid");
  });
});

/**
 * ‎**סבב שלישי: הדפדוף, הניסיון שנגמר, והנעילות שנצברו** (ביקורת
 * ‏Codex, P2).
 *
 * ‏שלושתם מול מסד אמיתי ולא מוק, כי שלושתם **התנהגות של
 * ‏PostgreSQL ושל Prisma**: `cursor` שדורש ששורת העוגן תישאר
 * ‏בתוצאה, `timestamp` שמושווה ל-`now()`, ושורות שננעלות בתוך
 * ‏טרנזקציה ומשוחררות בסופה.
 */
/**
 * ‎**משרדים שהבדיקות האלה זורעות — ונמחקים אחריהן.**
 *
 * ‏המסד משותף לכל הקובץ, והמכסה היומית נספרת על **כל** הרישומים
 * ‏של היום. משרד שנשאר מאחור צורך מכסה בבדיקות אחרות, ולכן
 * ‏„המכסה נשמרת” הייתה נכשלת על שיירים ולא על הקוד.
 */
const SEEDED_HERE = [
  "01M1FNNLBACKLOGAAAAAAAAA01",
  "01M1FNNLBACKLOGBBBBBBBBB02",
  "01M1FNNLBACKLOGCCCCCCCCC03",
  "01M1FNNLLAPSEDTRIALAAAAA01",
];

async function forgetSeeded(): Promise<void> {
  await direct.$executeRawUnsafe(
    `DELETE FROM funnel_messages WHERE tenant_id = ANY($1)`,
    SEEDED_HERE,
  );
  await direct.$executeRawUnsafe(
    `DELETE FROM funnel_enrollments WHERE tenant_id = ANY($1)`,
    SEEDED_HERE,
  );
  await direct.$executeRawUnsafe(
    `DELETE FROM subscriptions WHERE tenant_id = ANY($1)`,
    SEEDED_HERE,
  );
  await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, SEEDED_HERE);
}

describe("הפיגור: דפדוף שאינו מאבד את מקומו", () => {
  const BACKLOG = [
    "01M1FNNLBACKLOGAAAAAAAAA01",
    "01M1FNNLBACKLOGBBBBBBBBB02",
    "01M1FNNLBACKLOGCCCCCCCCC03",
  ];

  beforeEach(async () => {
    await forgetSeeded();
    for (const [index, id] of BACKLOG.entries()) {
      /* ‏ותק שונה לכל אחד — הסדר הוא `(created_at, id)` */
      /*
       * ‏ותיקים מהמשרדים שהקובץ זורע למעלה, כדי שהם יהיו הראשונים
       * ‏בסדר `(created_at, id)` — אחרת בדיקת המכסה מודדת אותם.
       */
      await seedTenant(id, `פיגור ${index}`, 40 + index);
    }
  });

  afterAll(forgetSeeded);

  /*
   * ‎**זו הבדיקה שהממצא תיאר.** דף של אחד: המשרד היחיד בדף נרשם,
   * ‏ומאותו רגע `funnelEnrollments: { none: … }` מוציא אותו מהקבוצה.
   * ‏`cursor` של Prisma עוגן עליו, ולכן הדף הבא חזר ריק והמכסה
   * ‏נשארה חלקית. סמן מפתח מתקדם על מה שראינו, ולכן שלושתם נכנסים.
   */
  it("דף של אחד — שלושת משרדי הפיגור נכנסים, ולא רק הראשון", async () => {
    /*
     * ‏`freshFrom` הוא 48 שעות, וכל השלושה ותיקים ממנו — כלומר
     * ‏כולם בפיגור, וכולם עוברים דרך המכסה והסמן.
     */
    await service.sweep(new Date(), { dailyQuota: 10, pageSize: 1 });
    const enrolled = (await enrollmentsOf(BACKLOG)).map((row) => row.tenantId).sort();
    expect(enrolled).toEqual([...BACKLOG].sort());
  });

  /* ‏והמכסה עדיין חוסמת — אחרת „שלושה נכנסו” היה נכון מסיבה אחרת */
  it("והמכסה עדיין חותכת", async () => {
    await service.sweep(new Date(), { dailyQuota: 2, pageSize: 1 });
    const enrolled = await enrollmentsOf(BACKLOG);
    expect(enrolled).toHaveLength(2);
  });

  /*
   * ‎**והנעילות אינן נצברות על פני האצווה.**
   *
   * ‏קודם `openProspect` קיבל את הטרנזקציה של המכסה, ולכן סולם
   * ‏הנעילות של כל משרד בדף הוחזק עד סופה. הבדיקה: אחרי הסבב,
   * ‏עדכון על שורת המנוי של המשרד הראשון מצליח מיד — כלומר איש
   * ‏אינו מחזיק אותה.
   *
   * ‏בגרסה הישנה השורות שוחררו רק ב-COMMIT של הסבב כולו, ומכאן
   * ‏מעגל ה-deadlock מול `deletePlan` שמעדכן כמה מנויים בסדר משלו.
   */
  /*
   * ‎**וכל משרד באצווה נרשם בטרנזקציה משלו.**
   *
   * ‏מה שנצפה כאן הוא **משך** ההחזקה, ומדידה אחרי הסבב אינה יכולה
   * ‏לראות אותו: בסופו הכול משוחרר בשתי הגרסאות. מה שכן נראה הוא
   * ‏התוצאה של טרנזקציה נפרדת — משרד שנכשל אינו מגלגל אחורה את מי
   * ‏שנרשם לפניו באותו דף.
   *
   * ‏הכישלון נוצר אמיתי: שורת המשרד השני ננעלת מחיבור אחר עד
   * ‏שהסבב יסתיים. בטרנזקציה משותפת הראשון היה ממתין איתו וכולם
   * ‏היו חוזרים יחד; בטרנזקציה לכל משרד הראשון כבר commit.
   */
  it("משרד שנתקע אינו מגלגל אחורה את מי שנרשם לפניו", async () => {
    /*
     * ‏הסדר הוא `created_at` עולה — כלומר **הוותיק ביותר ראשון**,
     * ‏וה-`ageDays` שלנו הוא `40 + index`. לכן האחרון במערך הוא
     * ‏הראשון בתור, והשני בתור הוא זה שבאמצע.
     */
    const [, blocked, firstInLine] = BACKLOG as [string, string, string];
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', now(), now())`,
      "01M1FNNLBACKLOGSUB00000001",
      blocked,
    );
    let racing: Promise<unknown> | undefined;
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT id FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`,
        blocked,
      );
      racing = service.sweep(new Date(), { dailyQuota: 10, pageSize: 3 });
      /*
       * ‏החלון: הסבב עבר את הראשון וממתין על השני. בטרנזקציה
       * ‏משותפת שום דבר לא היה commit עדיין.
       */
      await new Promise((resolve) => setTimeout(resolve, 600));
      const done = await enrollmentsOf([firstInLine]);
      expect(done, "הראשון לא נשמר בעוד השני ממתין — טרנזקציה משותפת").toHaveLength(1);
    });
    await racing;
    /* ‏ואחרי השחרור — כולם */
    expect(await enrollmentsOf(BACKLOG)).toHaveLength(3);
  });
});

describe("ניסיון שתאריכו עבר אינו „ניסיון חי”", () => {
  const LAPSED = "01M1FNNLLAPSEDTRIALAAAAA01";

  /*
   * ‎**זה המקרה שהממצא תיאר.** משרד ששילם בזמן שהיה `trial` שומר
   * ‏את `trialEndsAt` המקורי גם אחרי שעבר. `{ not: null }` קרא לו
   * ‏„ניסיון חי”, ולכן משרד שהניסיון שלו נגמר לפני חודש היה נכנס
   * ‏למסלול — ואותו סבב היה סוגר אותו כ„הושלם”, כלומר ספירת המרה
   * ‏מעוותת.
   */
  afterAll(forgetSeeded);

  beforeEach(async () => {
    await forgetSeeded();
    await seedTenant(LAPSED, "ניסיון שנגמר", 30);
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = now() - interval '30 days' WHERE id = $1`,
      LAPSED,
    );
  });

  it("תאריך שעבר — לא נכנס למסלול", async () => {
    await service.sweep(new Date(), { dailyQuota: 10 });
    expect(await enrollmentsOf([LAPSED])).toEqual([]);
  });

  it("ואינו נפתח מחדש כשהכרטיס פג", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, ended_at, ended_reason, created_at, updated_at)
       VALUES ($1, $2, 'conversion', now() - interval '40 days', now() - interval '35 days', 'paid', now(), now())`,
      "01M1FNNLLAPSEDENROLL000001",
      LAPSED,
    );
    await service.sweep(new Date(), { dailyQuota: 0 });
    const row = (await enrollmentsOf([LAPSED]))[0];
    expect(row?.endedReason, "ניסיון שנגמר נפתח מחדש").toBe("paid");
  });

  /*
   * ‎**והבדיקה החוזרת ליד הכתיבה — לא רק הסינון בשאילתה.**
   *
   * ‏השאילתה כבר מוציאה ניסיון שתאריכו עבר, ולכן היא לבדה מכסה את
   * ‏המוטציה שמחלישה **אותה**. את הבדיקה שליד הכתיבה היא אינה
   * ‏מכסה: מוטציה שהחזירה שם `trialEndsAt === null` שרדה, כי
   * ‏המועמד לא הגיע לשם מלכתחילה.
   *
   * ‏המרוץ האמיתי: הניסיון פג **בין** השאילתה לכתיבה. הבדיקה
   * ‏מחזיקה את שורת המנוי, מתחילה סבב שממתין עליה, מעדכנת את
   * ‏`trial_ends_at` לעבר בתוך החלון, ומשחררת. הקריאה כבר קרתה;
   * ‏רק הבדיקה החוזרת יכולה לעצור את זה.
   */
  it("ניסיון שפג בין הקריאה לכתיבה — הבדיקה החוזרת עוצרת", async () => {
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = now() + interval '5 days' WHERE id = $1`,
      LAPSED,
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, billing_cycle, status, created_at, updated_at)
       VALUES ($1, $2, 'basic', 'monthly', 'trial', now(), now())`,
      "01M1FNNLLAPSEDSUB000000001",
      LAPSED,
    );
    let racing: Promise<void> | undefined;
    await direct.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT id FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`,
        LAPSED,
      );
      racing = service.sweep(new Date(), { dailyQuota: 10 }).then(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));
      /* ‏החלון: הסבב כבר קרא את המשרד וממתין על השורה */
      await tx.$executeRawUnsafe(
        `UPDATE tenants SET trial_ends_at = now() - interval '1 day' WHERE id = $1`,
        LAPSED,
      );
    });
    await racing;
    expect(await enrollmentsOf([LAPSED]), "ניסיון שפג בחלון נרשם בכל זאת").toEqual([]);
  });

  /* ‏והצד השני: תאריך עתידי כן נכנס, אחרת „חסום הכול” היה עובר */
  it("ותאריך עתידי כן נכנס", async () => {
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = now() + interval '5 days' WHERE id = $1`,
      LAPSED,
    );
    await service.sweep(new Date(), { dailyQuota: 10 });
    expect(await enrollmentsOf([LAPSED])).toHaveLength(1);
  });
});

/**
 * ‎**הדפדוף על הרישומים — אותה תקלה, בכיוון ההפוך** (ביקורת Codex,
 * ‏P2, סבב רביעי).
 *
 * ‏בסבבי המשרדים העוגן נעלם כשהמשרד **נרשם**. כאן הוא נעלם כשהרישום
 * ‏**נסגר** (`endedAt` נכתב) או **נפתח מחדש** (`endedAt` מנוקה) —
 * ‏ובשני המקרים זו העבודה שהצליחה שמוציאה אותו מהתוצאה.
 *
 * ‏שתי הבדיקות רצות עם `pageSize: 1`, שהוא המקרה שהממצא תיאר בגדול:
 * ‏דף שסופו שורה שתיעלם.
 */
describe("דפדוף הרישומים אינו מאבד את מקומו", () => {
  const OFFICES = [
    "01M1FNNLPAGEAAAAAAAAAAAA01",
    "01M1FNNLPAGEBBBBBBBBBBBB02",
    "01M1FNNLPAGECCCCCCCCCCCC03",
  ];

  async function forgetPaging(): Promise<void> {
    await direct.$executeRawUnsafe(
      `DELETE FROM funnel_messages WHERE tenant_id = ANY($1)`,
      OFFICES,
    );
    await direct.$executeRawUnsafe(
      `DELETE FROM funnel_enrollments WHERE tenant_id = ANY($1)`,
      OFFICES,
    );
    await direct.$executeRawUnsafe(`DELETE FROM subscriptions WHERE tenant_id = ANY($1)`, OFFICES);
    await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, OFFICES);
  }

  beforeEach(async () => {
    await forgetPaging();
    for (const [index, id] of OFFICES.entries()) {
      await seedTenant(id, `דפדוף ${index}`, 5);
    }
  });

  afterAll(forgetPaging);

  /*
   * ‎**סגירה.** שלושה משרדים שיצאו מהניסיון, שלושה רישומים פתוחים,
   * ‏דף של אחד. עם `cursor` של Prisma השורה הראשונה נסגרת, יוצאת
   * ‏מ-`endedAt: null`, והדף הבא חוזר ריק — כלומר רישום אחד לסבב.
   */
  it("סגירה: שלושה רישומים נסגרים בדף של אחד", async () => {
    for (const [index, id] of OFFICES.entries()) {
      await direct.$executeRawUnsafe(
        `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, created_at, updated_at)
         VALUES ($1, $2, 'conversion', now() - interval '5 days', now(), now())`,
        `01M1FNNLPAGEENROLL00000${index}0`,
        id,
      );
      /* ‏יצא מהניסיון — ולכן הרישום אמור להיסגר */
      await direct.$executeRawUnsafe(
        `UPDATE tenants SET status = 'active', plan = 'free', trial_ends_at = NULL,
           trial_concluded_at = now() WHERE id = $1`,
        id,
      );
    }
    /* ‏אחרי כל שלבי שעון המשפך — אחרת אין מה לסגור */
    const later = new Date(Date.now() + 60 * DAY);
    await service.sweep(later, { dailyQuota: 0, pageSize: 1 });
    const rows = await enrollmentsOf(OFFICES);
    expect(rows.filter((row) => row.endedAt !== null)).toHaveLength(3);
  });

  /*
   * ‎**פתיחה מחדש.** שלושה רישומים „שילם”, שלושה ניסיונות חיים בלי
   * ‏כרטיס, דף של אחד. אותו מנגנון: הראשון נפתח, מאבד את
   * ‏`endedReason: "paid"`, והעוגן נעלם.
   */
  it("פתיחה מחדש: שלושה רישומים נפתחים בדף של אחד", async () => {
    for (const [index, id] of OFFICES.entries()) {
      await direct.$executeRawUnsafe(
        `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, ended_at, ended_reason, created_at, updated_at)
         VALUES ($1, $2, 'conversion', now() - interval '5 days', now() - interval '1 day', 'paid', now(), now())`,
        `01M1FNNLPAGEREOPEN00000${index}0`,
        id,
      );
    }
    await service.sweep(new Date(), { dailyQuota: 0, pageSize: 1 });
    const rows = await enrollmentsOf(OFFICES);
    expect(rows.filter((row) => row.endedAt === null)).toHaveLength(3);
  });
});
