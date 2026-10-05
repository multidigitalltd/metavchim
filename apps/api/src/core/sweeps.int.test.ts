import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SweepScheduler, type SweepOptions } from "./sweeps";

/**
 * ‎**חכירת הסבבים — מול Postgres אמיתי, כתפקיד האפליקציה.**
 *
 * ‏כל ההגנה היא משפט SQL אחד (`INSERT … ON CONFLICT … WHERE`), והוא
 * ‏קיים רק במסד: מסד מדומה היה מאשר שכתבנו את המחרוזת, ולא שהיא תופסת
 * ‏סבב אחד בלבד, משחררת אותו כשפג, ושתפקיד האפליקציה רשאי לכתוב בה.
 *
 * ‏שני מתזמנים כאן הם שני מופעי API: לכל אחד מזהה מחזיק משלו.
 */

let prisma: PrismaClient;
let owner: PrismaClient;
const PREFIX = `int-${ulid().toLowerCase()}`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

const instance = (): SweepScheduler =>
  new SweepScheduler({} as never, {} as never, {} as never, prisma as never);

const sweep = (name: string): SweepOptions => ({ name: `${PREFIX}-${name}`, everyMs: 60 * 60 * 1000 });

async function counted(scheduler: SweepScheduler, options: SweepOptions): Promise<number> {
  let ran = 0;
  await scheduler.runOnce(options, async () => {
    ran += 1;
  });
  return ran;
}

beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } } });
  owner = new PrismaClient({ datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } } });
});

afterAll(async () => {
  await owner?.$executeRawUnsafe(`DELETE FROM sweep_leases WHERE name LIKE '${PREFIX}-%'`);
  await prisma?.$disconnect();
  await owner?.$disconnect();
});

describe("‏חכירת סבב בין מופעים", () => {
  it("‏מופע אחד תופס, והשני מדלג באותה תקופה", async () => {
    const options = sweep("one-of-two");
    const [a, b] = [instance(), instance()];
    expect(await counted(a, options)).toBe(1);
    expect(await counted(b, options)).toBe(0);
  });

  it("‏המחזיק עצמו ממשיך — חכירה שלו אינה חוסמת אותו", async () => {
    const options = sweep("same-holder");
    const a = instance();
    expect(await counted(a, options)).toBe(1);
    expect(await counted(a, options)).toBe(1);
  });

  it("‏חכירה שפגה — מופע אחר תופס", async () => {
    const options = sweep("expired");
    const [a, b] = [instance(), instance()];
    expect(await counted(a, options)).toBe(1);
    await owner.$executeRawUnsafe(
      `UPDATE sweep_leases SET until = now() - interval '1 second' WHERE name = '${options.name}'`,
    );
    expect(await counted(b, options)).toBe(1);
    expect(await counted(a, options), "ועכשיו היא של השני").toBe(0);
  });

  it("‏החכירה נמשכת כמעט תקופה שלמה, לפי השעון של המסד", async () => {
    const options = sweep("length");
    await counted(instance(), options);
    const [row] = await owner.$queryRawUnsafe<{ seconds: number }[]>(
      `SELECT EXTRACT(EPOCH FROM (until - now()))::float8 AS seconds FROM sweep_leases WHERE name = '${options.name}'`,
    );
    expect(row?.seconds).toBeGreaterThan(58 * 60);
    expect(row?.seconds).toBeLessThanOrEqual(59 * 60);
  });

  it("‏המחזיק נעלם — המופע שדילג רץ כשהחכירה פגה, בלי לחכות לטיק הבא", async () => {
    const options = sweep("standby");
    const [a, b] = [instance(), instance()];
    expect(await counted(a, options)).toBe(1);
    /* ‏החכירה של A נגמרת בעוד שתי שניות, ו-A עצמו כבר לא יחזור */
    await owner.$executeRawUnsafe(
      `UPDATE sweep_leases SET until = now() + interval '2 seconds' WHERE name = '${options.name}'`,
    );
    let ran = 0;
    expect(
      await b.runOnce(options, async () => {
        ran += 1;
      }),
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(ran).toBe(1);
    b.onModuleDestroy();
  });

  it("‏שני מופעים בבת אחת — רק אחד רץ", async () => {
    const options = sweep("race");
    const runs = await Promise.all(Array.from({ length: 6 }, () => counted(instance(), options)));
    expect(runs.reduce((sum, value) => sum + value, 0)).toBe(1);
  });
});
