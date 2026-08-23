import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";

/**
 * הפוליסה הציבורית של טופס הלקוח — **מול מסד אמיתי.**
 *
 * ## למה זו בדיקת אינטגרציה
 *
 * מה שמגן כאן אינו קוד אלא **פוליסת RLS**. הקוד מבקש שורה לפי
 * טוקן; מה שמחליט אם הוא יקבל אותה, ורק אותה, הוא Postgres. מוק
 * של Prisma יחזיר את מה שנכתוב בו — כלומר בדיוק את ההנחה שאנחנו
 * מנסים לבדוק.
 *
 * ## מה נבדק
 *
 * לא רק „הטוקן עובד”, אלא שלושת התנאים שהוא קיים בשבילם:
 *
 * 1. **בלי טוקן ובלי דייר — אין כלום.** זו ברירת המחדל, ואם היא
 *    נשברת הטבלה פתוחה לכל מי שמגיע לנתיב הציבורי.
 * 2. **טוקן חושף שורה אחת.** טוקן של משרד א׳ אינו מראה את השורה
 *    של משרד ב׳, גם כשהיא באותה טבלה.
 * 3. **הפוליסה היא `FOR SELECT` בלבד.** עדכון עם טוקן בלבד חייב
 *    להיכשל: הצד הציבורי קורא, וכל כתיבה עוברת תחת הקשר דייר
 *    מפורש. זו ההפרדה שמצמצמת את משטח הגישה הציבורי לשורה אחת
 *    בטבלה אחת.
 */

const TENANT_A = "01JWAINTAKETENANTAAAAAAAAA";
const TENANT_B = "01JWAINTAKETENANTBBBBBBBBB";
const TOKEN_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

let owner: PrismaClient;
let app: PrismaClient;

async function seed(tenantId: string, token: string): Promise<void> {
  await owner.$executeRawUnsafe(
    `INSERT INTO intake_requests
       (id, tenant_id, token, subject, subject_id, contact_id, status, channel, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'buyer', $4, $5, 'sent', 'manual', now() + interval '14 days', now(), now())`,
    ulid(),
    tenantId,
    token,
    ulid(),
    ulid(),
  );
}

async function clean(): Promise<void> {
  await owner.$executeRaw`
    DELETE FROM intake_requests WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
}

/** קריאה בתפקיד האפליקציה, עם ההקשר שהמסלול הציבורי מגדיר. */
async function asPublic<T>(
  token: string | null,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    if (token !== null) {
      await tx.$executeRaw`SELECT set_config('app.intake_token', ${token}, true)`;
    }
    return fn(tx as unknown as PrismaClient);
  }) as Promise<T>;
}

beforeAll(async () => {
  const ownerUrl = process.env["DIRECT_DATABASE_URL"];
  const appUrl = process.env["APP_DATABASE_URL"];
  if (!ownerUrl || !appUrl) {
    throw new Error("DIRECT_DATABASE_URL / APP_DATABASE_URL חסרים — נדרש מסד אמיתי");
  }
  owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  await clean();
  await seed(TENANT_A, TOKEN_A);
  await seed(TENANT_B, TOKEN_B);
});

afterAll(async () => {
  if (owner !== undefined) {
    await clean();
    await owner.$disconnect();
  }
  if (app !== undefined) await app.$disconnect();
});

describe("פוליסת הטוקן הציבורי", () => {
  it("בלי טוקן ובלי דייר — לא נראית אף שורה", async () => {
    const rows = await asPublic(null, (tx) =>
      tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM intake_requests`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("טוקן חושף בדיוק שורה אחת — שלו", async () => {
    const rows = await asPublic(TOKEN_A, (tx) =>
      tx.$queryRaw<{ token: string; tenant_id: string }[]>`
        SELECT token, tenant_id FROM intake_requests`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token.trim()).toBe(TOKEN_A);
    expect(rows[0]?.tenant_id.trim()).toBe(TENANT_A);
  });

  it("טוקן של משרד אחד אינו חושף את השורה של השני", async () => {
    const rows = await asPublic(TOKEN_A, (tx) =>
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM intake_requests WHERE tenant_id = ${TENANT_B}`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("טוקן שאינו קיים אינו חושף דבר", async () => {
    const rows = await asPublic("z".repeat(43), (tx) =>
      tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM intake_requests`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("עם טוקן בלבד אי אפשר לעדכן — הפוליסה היא לקריאה", async () => {
    /*
     * הלב של ההפרדה. אילו הפוליסה הייתה `FOR ALL`, מי שמחזיק
     * קישור היה יכול לכתוב לשורה ישירות — וכל הכתיבה בשירות עוברת
     * דווקא תחת הקשר דייר מפורש כדי שזה לא יהיה אפשרי.
     */
    const updated = await asPublic(TOKEN_A, (tx) =>
      tx.$executeRaw`
        UPDATE intake_requests SET status = 'submitted' WHERE token = ${TOKEN_A}`,
    );
    expect(updated).toBe(0);

    const still = await owner.$queryRaw<{ status: string }[]>`
      SELECT status FROM intake_requests WHERE token = ${TOKEN_A}`;
    expect(still[0]?.status.trim()).toBe("sent");
  });

  it("תחת הקשר דייר — הכתיבה עוברת", async () => {
    /* המסלול שהשירות משתמש בו בפועל, כדי שהבדיקה מעל לא תעבור בטעות. */
    const updated = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return tx.$executeRaw`
        UPDATE intake_requests SET status = 'opened' WHERE token = ${TOKEN_A}`;
    });
    expect(updated).toBe(1);
  });
});
