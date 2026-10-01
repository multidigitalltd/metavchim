import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServerErrorDigestService, serverErrors } from "./server-errors";

/**
 * ‎**ספירת השגיאות — מול Postgres אמיתי, כתפקיד האפליקציה.**
 *
 * ‏הצבירה בין מופעים ובין דקות היא `ON CONFLICT … count + EXCLUDED.count`,
 * ‏והשליחה-פעם-אחת היא `UPDATE … WHERE notified_at IS NULL RETURNING` —
 * ‏שניהם קיימים רק במסד.
 */

let prisma: PrismaClient;
let owner: PrismaClient;
const SOURCE = `int-${ulid()}`;
/** ‏יום ישן ומבודד — אף בדיקה אחרת אינה כותבת אליו. 08:00 בישראל למחרת. */
const DAY_AT = new Date("2026-09-20T09:00:00.000Z");
const NEXT_MORNING = new Date("2026-09-21T05:00:00.000Z");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

function service(sent = 1) {
  const notices: { subject: string; details?: { label: string }[] }[] = [];
  const notifier = {
    notify: async (notice: { subject: string; details?: { label: string }[] }) => {
      notices.push(notice);
      return { sent, failed: 0 };
    },
  };
  return { digest: new ServerErrorDigestService(prisma as never, notifier as never), notices };
}

async function stored(): Promise<{ count: number; notified: boolean } | undefined> {
  const [row] = await owner.$queryRawUnsafe<{ count: number; notified: boolean }[]>(
    `SELECT count, notified_at IS NOT NULL AS notified FROM server_errors WHERE source = '${SOURCE}'`,
  );
  return row;
}

beforeAll(() => {
  prisma = new PrismaClient({ datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } } });
  owner = new PrismaClient({ datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } } });
  serverErrors.drain();
});

afterAll(async () => {
  await owner?.$executeRawUnsafe(`DELETE FROM server_errors WHERE source = '${SOURCE}'`);
  await prisma?.$disconnect();
  await owner?.$disconnect();
});

describe("‏שגיאות השרת במסד", () => {
  it("‏הספירה נצברת בין כתיבות — שורה אחת לאותה תקלה באותו יום", async () => {
    const { digest } = service();
    serverErrors.record(SOURCE, "order 17 failed", DAY_AT);
    serverErrors.record(SOURCE, "order 18 failed", DAY_AT);
    await digest.flush();
    serverErrors.record(SOURCE, "order 19 failed", DAY_AT);
    await digest.flush();
    expect(await stored()).toEqual({ count: 3, notified: false });
  });

  it("‏מייל שלא הגיע לאיש — השורה משתחררת", async () => {
    const { digest, notices } = service(0);
    await digest.digest(NEXT_MORNING);
    expect(notices).toHaveLength(1);
    expect((await stored())?.notified).toBe(false);
  });

  it("‏הסיכום יוצא פעם אחת — הסבב הבא אינו שולח שוב", async () => {
    const first = service();
    await first.digest.digest(NEXT_MORNING);
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]?.details?.some((detail) => detail.label === `3× · ${SOURCE}`)).toBe(true);
    expect((await stored())?.notified).toBe(true);

    const second = service();
    await second.digest.digest(NEXT_MORNING);
    expect(second.notices).toEqual([]);
  });
});
