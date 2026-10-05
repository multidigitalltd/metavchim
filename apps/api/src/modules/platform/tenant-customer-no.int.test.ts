import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ‎**מספר הלקוח — מול Postgres אמיתי, כי כולו במסד.**
 *
 * ‏אין כאן היגיון להריץ: הרצף, ברירת המחדל והייחודיות קיימים
 * ‏בסכימה בלבד. בדיקה עם מסד מדומה הייתה מוודאת שכתבנו את
 * ‏המחרוזת שאנחנו חושבים שכתבנו, ולא את מה שבאמת עומד למבחן —
 * ‏שכל משרד חדש מקבל מספר, שהוא בן שש ספרות, שאין שניים שקיבלו את
 * ‏אותו אחד, ושהמספר אינו מסגיר כמה משרדים כבר יש.
 */

let owner: PrismaClient;
/**
 * ‎**וגם כתפקיד האפליקציה — התפקיד שבאמת פותח משרדים.**
 *
 * ‏כל הבדיקות למעלה כתבו כבעלים, ולכן פספסו את מה שנפל בפועל:
 * ‏לתפקיד האפליקציה לא הייתה הרשאה על הרצף החדש, והעמודה נכתבת
 * ‏דרך `DEFAULT nextval(...)` — כלומר כל יצירת משרד, הרשמה עצמית
 * ‏ופתיחה ממסך הפלטפורמה כאחת, נפלה על
 * ‎`permission denied for sequence`‎ (ביקורת Codex).
 */
let app: PrismaClient;
const PREFIX = "01CUSTNO";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

/** ‏משרד חדש **בלי** לנקוב במספר — בדיוק כמו הרשמה אמיתית. */
async function createTenant(suffix: string): Promise<number> {
  const id = `${PREFIX}${suffix}`.padEnd(26, "A");
  await owner.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, created_at, updated_at)
     VALUES ('${id}', 'בדיקת מספר לקוח', now(), now())`,
  );
  const rows = await owner.$queryRawUnsafe<{ customer_no: number }[]>(
    `SELECT customer_no FROM tenants WHERE id = '${id}'`,
  );
  const value = rows[0]?.customer_no;
  if (value === undefined) throw new Error("לא נוצר מספר לקוח");
  return Number(value);
}

beforeAll(() => {
  owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  app = new PrismaClient({
    datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } },
  });
});

afterAll(async () => {
  await app?.$disconnect();
  await owner?.$executeRawUnsafe(`DELETE FROM tenants WHERE id LIKE '${PREFIX}%'`);
  await owner?.$disconnect();
});

describe("‏מספר הלקוח של המשרד", () => {
  it("‏משרד חדש מקבל מספר בלי שאיש נקב בו", async () => {
    const first = await createTenant("1");
    expect(Number.isInteger(first)).toBe(true);
  });

  /*
   * ‎**שש ספרות, תמיד.** מספר קצר („משרד 7”) נקרא כמונה פנימי
   * ‏ולא כזהות, ומספרים באורך משתנה אינם נסרקים בעין בטור אחד.
   *
   * ‏„לפחות שש” הפך ל„בדיוק שש”: התמורה מפזרת על תחום סגור
   * ‏(100000–999999), ולכן האורך אינו תלוי עוד בכמה משרדים יש.
   */
  it("‏והוא בן שש ספרות בדיוק", async () => {
    const value = await createTenant("2");
    expect(value).toBeGreaterThanOrEqual(100000);
    expect(value).toBeLessThanOrEqual(999999);
  });

  it("‏שני משרדים אינם מקבלים את אותו מספר", async () => {
    const [a, b] = [await createTenant("3"), await createTenant("4")];
    expect(a).not.toBe(b);
  });

  /*
   * ‎**והוא אינו מסגיר כמה משרדים יש** (בקשת המשתמש).
   *
   * ‏קודם המספרים עלו לפי סדר ההקמה, ולכן משרד שנרשם וראה
   * ‏„100004” ידע מיד שהוא הרביעי. זו הייתה תכונה מכוונת —
   * ‏„המספרים נקראים כהיסטוריה” — והיא בדיוק מה שהוסר.
   *
   * ‏הטענה נבדקת על **הפונקציה** ולא על הכנסות: כך היא דטרמיניסטית
   * ‏ואינה תלויה בכמה משרדים כבר יש במסד הבדיקה.
   */
  it("‏שני מקומות סמוכים ברצף אינם שני מספרים סמוכים", async () => {
    const rows = await owner.$queryRawUnsafe<{ gap: number }[]>(
      `SELECT count(*)::int AS gap
       FROM generate_series(0, 999) AS n
       WHERE tenant_customer_no(100001 + n) - tenant_customer_no(100000 + n) = 1`,
    );
    expect(rows[0]?.gap).toBe(0);
  });

  /*
   * ‎**וכל שש הספרות פעילות, לא רק שתיים.** זה החלק השני של
   * ‏הבקשה: גם בלי לחשב, „1000xx” נקרא כמונה מפני שרק הזנב זז.
   */
  it("‏גם הספרה הראשונה משתנה בין משרדים סמוכים", async () => {
    const rows = await owner.$queryRawUnsafe<{ leading: number }[]>(
      `SELECT count(DISTINCT left(tenant_customer_no(100000 + n)::text, 1))::int AS leading
       FROM generate_series(0, 19) AS n`,
    );
    /* ‏עשרים משרדים ראשונים — לפחות חמש ספרות פתיחה שונות */
    expect(rows[0]?.leading).toBeGreaterThanOrEqual(5);
  });

  /**
   * ‎**התמורה חד-חד-ערכית — וזו הטענה שנושאת את הייחודיות.**
   *
   * ‏אילו היה כאן פיזור אקראי, האינדקס הייחודי היה מנגנון ההגנה
   * ‏היחיד, ושתי הרשמות היו נופלות ביום שבו הגריל אותו מספר.
   * ‏רשת Feistel עם הליכה מחזורית היא חד-חד-ערכית **מבנית**: כל
   * ‏מקום ברצף מגיע למספר אחר, על כל התחום ולא בדגימה.
   *
   * ‏900,000 קלטים ⇐ 900,000 פלטים שונים, בדיוק בין 100000
   * ‏ל-999999. משרד 900,001 יתנגש — והוא ייפול על האינדקס בקול.
   */
  it("‏ואין שני מקומות ברצף שמגיעים לאותו מספר — על כל התחום", async () => {
    const rows = await owner.$queryRawUnsafe<{
      total: number;
      distinct_out: number;
      lo: number;
      hi: number;
    }[]>(
      `SELECT count(*)::int AS total,
              count(DISTINCT tenant_customer_no(100000 + n))::int AS distinct_out,
              min(tenant_customer_no(100000 + n))::int AS lo,
              max(tenant_customer_no(100000 + n))::int AS hi
       FROM generate_series(0, 899999) AS n`,
    );
    expect(rows[0]?.distinct_out).toBe(rows[0]?.total);
    expect(rows[0]?.total).toBe(900000);
    expect(rows[0]?.lo).toBe(100000);
    expect(rows[0]?.hi).toBe(999999);
  });

  /**
   * ‎**והעמודה באמת עוברת דרך התמורה.**
   *
   * ‏שתי הבדיקות שמעל מוכיחות מה הפונקציה עושה; זו מוכיחה שהיא
   * ‏זו שמחלקת. בלעדיה החזרה ל-`nextval` חשוף הייתה עוברת ירוקה:
   * ‏המספרים שנוצרו עדיין בטווח ועדיין ייחודיים, וזה כל מה שנבדק
   * ‏עליהם.
   *
   * ‏נבדק על הגדרת העמודה ולא על שתי הכנסות סמוכות, כי „שני
   * ‏מספרים שאינם צמודים” נכון בהסתברות 1 פחות 1 ל-450,000 —
   * ‏כלומר שער שנופל פעם באלף הרצות הוא שער שמתחילים להתעלם ממנו.
   */
  it("‏ברירת המחדל של העמודה עוברת דרך התמורה", async () => {
    const rows = await owner.$queryRawUnsafe<{ expr: string }[]>(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'tenants'::regclass AND a.attname = 'customer_no'`,
    );
    expect(rows[0]?.expr).toContain("tenant_customer_no(");
    expect(rows[0]?.expr).toContain("nextval(");
  });

  /**
   * ‎**הבדיקה שהייתה חסרה.**
   *
   * ‏המשרד נפתח כאן כתפקיד האפליקציה, כמו בייצור. בלי הרשאה על
   * ‏הרצף השורה הזו נופלת על `permission denied for sequence` —
   * ‏וזה בדיוק מה שקרה על כל מסד שהוקצה לפני שהרצף נוצר, מפני
   * ‏שברירות המחדל של ההקצאה כיסו טבלאות ולא רצפים.
   */
  it("‏גם כשתפקיד האפליקציה הוא שפותח את המשרד", async () => {
    const id = `${PREFIX}APP`.padEnd(26, "A");
    await app.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, created_at, updated_at)
       VALUES ('${id}', 'בדיקת מספר לקוח', now(), now())`,
    );
    const rows = await app.$queryRawUnsafe<{ customer_no: number }[]>(
      `SELECT customer_no FROM tenants WHERE id = '${id}'`,
    );
    expect(Number(rows[0]?.customer_no)).toBeGreaterThanOrEqual(100000);
    expect(Number(rows[0]?.customer_no)).toBeLessThanOrEqual(999999);
  });

  /* ‏וכל המשרדים הקיימים מוספרו במיגרציה — אין שורה בלי מספר */
  it("‏אין משרד בלי מספר", async () => {
    const rows = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM tenants WHERE customer_no IS NULL`,
    );
    expect(Number(rows[0]?.n ?? 0n)).toBe(0);
  });
});
