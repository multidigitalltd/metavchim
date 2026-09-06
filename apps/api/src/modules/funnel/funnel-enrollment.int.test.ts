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

/** ‏משרד בניסיון עם ותק נתון. */
async function seedTenant(id: string, name: string, ageDays: number): Promise<void> {
  const createdAt = new Date(Date.now() - ageDays * DAY);
  const trialEndsAt = new Date(createdAt.getTime() + 14 * DAY);
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

  async function withBadStage(run: () => Promise<void>): Promise<void> {
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_stages
         (id, track, key, title, clock, offset_days, audience, channels, sort_order, updated_at)
       VALUES ($1, 'conversion', 'zz_bad_clock', 'שעון שאינו קיים', 'lunar', 99,
               '{always}', '{email}', 999, now())`,
      BAD_STAGE_ID,
    );
    try {
      await run();
    } finally {
      await direct.$executeRawUnsafe(`DELETE FROM funnel_stages WHERE id = $1`, BAD_STAGE_ID);
    }
  }

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
   * ‏ושהסגירה אינה מקדימה את זמנה: אותו משרד חינמי בדיוק, אבל
   * ‏בעוד שלבי שעון המשפך בתוקף, נשאר פתוח ויקבל אותם.
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

  it("נפתח מחדש, ובלי לאפס את יום 0", async () => {
    await closeAsCompleted();
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
   * ‏ואחרי הפתיחה, הסבב אינו סוגר אותו מיד: התאריך החדש מחזיר את
   * ‏שלבי הניסיון לתוקף, וזו כל מטרת הפתיחה.
   */
  it("אחרי החזרת התאריך הסבב אינו סוגר אותו שוב", async () => {
    await closeAsCompleted();
    await service.reopenForRestoredTrial(OLD_TENANT);
    const restored = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET status = 'trial', trial_ends_at = $2, trial_concluded_at = NULL
        WHERE id = $1`,
      OLD_TENANT,
      restored,
    );
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
