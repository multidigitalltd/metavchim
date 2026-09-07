import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ‎**מספר הלקוח — מול Postgres אמיתי, כי כולו במסד.**
 *
 * ‏אין כאן היגיון להריץ: הרצף, ברירת המחדל והייחודיות קיימים
 * ‏בסכימה בלבד. בדיקה עם מסד מדומה הייתה מוודאת שכתבנו את
 * ‏המחרוזת שאנחנו חושבים שכתבנו, ולא את מה שבאמת עומד למבחן —
 * ‏שכל משרד חדש מקבל מספר, שהוא בן שש ספרות לפחות, ושאין שניים
 * ‏שקיבלו את אותו אחד.
 */

let owner: PrismaClient;
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
});

afterAll(async () => {
  await owner?.$executeRawUnsafe(`DELETE FROM tenants WHERE id LIKE '${PREFIX}%'`);
  await owner?.$disconnect();
});

describe("‏מספר הלקוח של המשרד", () => {
  it("‏משרד חדש מקבל מספר בלי שאיש נקב בו", async () => {
    const first = await createTenant("1");
    expect(Number.isInteger(first)).toBe(true);
  });

  /*
   * ‎**שש ספרות לפחות** — זו הדרישה. מספר קצר („משרד 7”) נקרא
   * ‏כמונה פנימי ולא כזהות, ומספרים באורך משתנה אינם נסרקים
   * ‏בעין בטור אחד.
   */
  it("‏והוא בן שש ספרות לפחות", async () => {
    const value = await createTenant("2");
    expect(value).toBeGreaterThanOrEqual(100000);
    expect(String(value).length).toBeGreaterThanOrEqual(6);
  });

  it("‏שני משרדים אינם מקבלים את אותו מספר", async () => {
    const [a, b] = [await createTenant("3"), await createTenant("4")];
    expect(a).not.toBe(b);
  });

  /*
   * ‏הרצף עולה, ולכן המספרים נקראים כהיסטוריה. זו אינה דרישה
   * ‏שהמשתמש ניסח, אבל היא מה שהופך „מספר לקוח” לדבר שאפשר
   * ‏להעריך לפיו ותק — ורצף שיורד היה מפתיע.
   */
  it("‏והמספרים עולים לפי סדר ההקמה", async () => {
    const before = await createTenant("5");
    const after = await createTenant("6");
    expect(after).toBeGreaterThan(before);
  });

  /* ‏וכל המשרדים הקיימים מוספרו במיגרציה — אין שורה בלי מספר */
  it("‏אין משרד בלי מספר", async () => {
    const rows = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM tenants WHERE customer_no IS NULL`,
    );
    expect(Number(rows[0]?.n ?? 0n)).toBe(0);
  });
});
