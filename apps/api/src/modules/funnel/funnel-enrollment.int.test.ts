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
       SET status = 'trial', trial_ends_at = EXCLUDED.trial_ends_at, created_at = EXCLUDED.created_at`,
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
