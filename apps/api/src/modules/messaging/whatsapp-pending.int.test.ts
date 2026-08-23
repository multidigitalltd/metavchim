import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { advancePendingRow, takePendingRow } from "./whatsapp-pending";
import type { TenantTx } from "../../core/prisma.service";

/**
 * צריכת ההצעה הממתינה של סוכן הוואטסאפ — **מול מסד אמיתי.**
 *
 * ## למה זו בדיקת אינטגרציה ולא בדיקת יחידה
 *
 * מה שנשבר כאן לא היה לוגיקה אלא **סמנטיקה של PostgreSQL**:
 *
 * ```sql
 * UPDATE whatsapp_chats SET pending = NULL ... RETURNING pending
 * ```
 *
 * `RETURNING` מחזיר את הערך **החדש** של השורה. השאילתה הזו החזירה
 * תמיד `NULL` — בדיוק מה שהיא זה עתה כתבה — ולכן כל לחיצה על „אשר”
 * רוקנה את ההצעה ואז ענתה „הפעולה כבר בוצעה או בוטלה”, בלי לבצע
 * דבר. משימה שהתבקשה לא נוצרה, נכס שהתבקש לא נוצר.
 *
 * שום מוק אינו יכול לתפוס את זה: מוק של `$queryRaw` מחזיר את מה
 * שכתבנו בו, כלומר בדיוק את ההנחה השגויה. רק Postgres אמיתי אומר
 * את האמת, ולכן הבדיקה כאן ולא בסוויטת היחידה.
 *
 * ## מה נבדק
 *
 * לא רק „מחזיר משהו”: גם שההצעה **התרוקנה** אחריו (אחרת אישור כפול
 * היה מבצע פעמיים), שאישור שני מקבל `null`, ושחותם שאינו תואם אינו
 * נוגע בהצעה שממתינה — שלושת התנאים שהמנגנון קיים בשבילם.
 */

/* מזהים באורך 26 בדיוק — `char(26)` בסכימה, בלי ריפוד שישבש השוואה. */
const TENANT = "01JWAPENDINGTEST0000000001";
const USER = "01JWAPENDINGUSER0000000001";

let db: PrismaClient;

/** הרצה תחת הקשר דייר, כמו `withExplicitTenant` בייצור. */
async function asTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as TenantTx);
  });
}

/** שתילת שורת צ'אט עם הצעה ממתינה, ומחיקת מה שהיה לפניה. */
async function seedPending(pending: Record<string, unknown>): Promise<void> {
  await db.$executeRaw`
    DELETE FROM whatsapp_chats WHERE tenant_id = ${TENANT} AND user_id = ${USER}`;
  await db.$executeRawUnsafe(
    `INSERT INTO whatsapp_chats (id, tenant_id, user_id, pending, history, handled_ids, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, '[]'::jsonb, now())`,
    ulid(),
    TENANT,
    USER,
    JSON.stringify(pending),
  );
}

async function storedPending(): Promise<unknown> {
  const rows = await db.$queryRaw<{ pending: unknown }[]>`
    SELECT pending FROM whatsapp_chats WHERE tenant_id = ${TENANT} AND user_id = ${USER}`;
  return rows[0]?.pending ?? null;
}

beforeAll(() => {
  const url = process.env["DIRECT_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DIRECT_DATABASE_URL חסר — הבדיקה דורשת מסד אמיתי");
  }
  db = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  if (db !== undefined) {
    await db.$executeRaw`DELETE FROM whatsapp_chats WHERE tenant_id = ${TENANT}`;
    await db.$disconnect();
  }
});

describe("takePendingRow", () => {
  it("מחזירה את ההצעה שהייתה, לא את הריק שנכתב במקומה", async () => {
    /*
     * זו הרגרסיה עצמה. עם `RETURNING pending` הישן הציפייה הזו
     * נכשלת: מתקבל `null`, ההצעה נמחקת, והפעולה לא מבוצעת לעולם.
     */
    await seedPending({ token: "tok-1", awaiting: "confirm", extraParams: {} });

    const took = await asTenant(TENANT, (tx) =>
      takePendingRow(tx, TENANT, USER, "tok-1"),
    );

    expect(took).not.toBeNull();
    expect(took?.["token"]).toBe("tok-1");
    expect(took?.["awaiting"]).toBe("confirm");
  });

  it("ההצעה מתרוקנת, ואישור שני אינו מבצע שוב", async () => {
    await seedPending({ token: "tok-2", awaiting: "confirm", extraParams: {} });

    const first = await asTenant(TENANT, (tx) =>
      takePendingRow(tx, TENANT, USER, "tok-2"),
    );
    const second = await asTenant(TENANT, (tx) =>
      takePendingRow(tx, TENANT, USER, "tok-2"),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await storedPending()).toBeNull();
  });

  it("חותם שאינו תואם אינו נוגע בהצעה שממתינה", async () => {
    /*
     * לחיצה על „אשר” של הצעה ישנה שנשארה בצ'אט. היא חייבת להיכשל
     * *ולהשאיר* את ההצעה הנוכחית — אחרת כפתור ישן מוחק בקשה חדשה.
     */
    await seedPending({ token: "tok-3", awaiting: "confirm", extraParams: {} });

    const took = await asTenant(TENANT, (tx) =>
      takePendingRow(tx, TENANT, USER, "tok-ישן"),
    );

    expect(took).toBeNull();
    expect((await storedPending()) as { token: string }).toMatchObject({
      token: "tok-3",
    });
  });

  it("בלי חותם — הצעה שקדמה לחותמים — עדיין נצרכת", async () => {
    await seedPending({ awaiting: "confirm", extraParams: {} });

    const took = await asTenant(TENANT, (tx) =>
      takePendingRow(tx, TENANT, USER),
    );

    expect(took).not.toBeNull();
    expect(await storedPending()).toBeNull();
  });

  it("אין הצעה — מחזירה null ולא נכשלת", async () => {
    await db.$executeRaw`
      DELETE FROM whatsapp_chats WHERE tenant_id = ${TENANT} AND user_id = ${USER}`;

    expect(
      await asTenant(TENANT, (tx) => takePendingRow(tx, TENANT, USER, "tok-x")),
    ).toBeNull();
  });
});

describe("advancePendingRow", () => {
  it("מקדמת בחירה לאישור ומחליפה את החותם", async () => {
    await seedPending({ token: "tok-4", awaiting: "choice", extraParams: {} });

    const advanced = await asTenant(TENANT, (tx) =>
      advancePendingRow(tx, TENANT, USER, "tok-4", {
        token: "tok-5",
        awaiting: "confirm",
        extraParams: {},
      }),
    );

    expect(advanced).toBe(true);
    expect((await storedPending()) as { token: string }).toMatchObject({
      token: "tok-5",
    });
  });

  it("חותם שאינו תואם אינו דורס הצעה חדשה", async () => {
    await seedPending({ token: "tok-6", awaiting: "confirm", extraParams: {} });

    const advanced = await asTenant(TENANT, (tx) =>
      advancePendingRow(tx, TENANT, USER, "tok-ישן", {
        token: "tok-7",
        awaiting: "confirm",
        extraParams: {},
      }),
    );

    expect(advanced).toBe(false);
    expect((await storedPending()) as { token: string }).toMatchObject({
      token: "tok-6",
    });
  });
});
