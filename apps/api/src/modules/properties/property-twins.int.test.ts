import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { canonicalTwinPair } from "@metavchim/shared";

/**
 * הסדר הקנוני של זוג נכסים תאומים — **מול מסד אמיתי.**
 *
 * ## למה זו בדיקת אינטגרציה
 *
 * הסימטריה של הקשר אינה מתקיימת בזכות הקוד אלא בזכות **שני אילוצים
 * במסד**: אינדקס ייחודי על השלישייה, ואילוץ `CHECK` שמחייב
 * `property_a_id < property_b_id`. הראשון לבדו אינו מספיק — בלי
 * הסדר, „א׳,ב׳” ו„ב׳,א׳” הן שתי שורות שונות ושתיהן חוקיות, והכרטיס
 * היה מציג את אותו נכס פעמיים ומסיר רק אחת מהן.
 *
 * מוק אינו יכול לתפוס את זה: הוא יאשר כל הכנסה שנכתוב בו. רק מסד
 * אמיתי אומר אם האילוצים באמת קיימים ובאמת אוכפים.
 *
 * ## ולמה `COLLATE "C"`
 *
 * הקוד ממיין ב-JavaScript, כלומר לפי קוד התו; `bpchar` משווה לפי
 * ה-collation של המסד. לאלפבית של ULID השתיים מסכימות, אבל האילוץ
 * מצהיר על כך במפורש כדי שגם מסד שיוקם עם collation אחר לא ידחה
 * שורה תקינה. הבדיקה האחרונה כאן מוודאת שההצהרה אכן במקומה.
 */

const TENANT = "01JWATWINTENANT00000000001";
/* שני מזהים שסדרם ידוע מראש — A לפני B בכל השוואה סבירה. */
const LOW = "01JWATWINAAAAAAAAAAAAAAAAA";
const HIGH = "01JWATWINZZZZZZZZZZZZZZZZZ";

let db: PrismaClient;

/** הכנסה ישירה, בעקיפת הקוד — הבדיקה כאן היא על המסד עצמו. */
async function insertPair(a: string, b: string): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO property_twins (id, tenant_id, property_a_id, property_b_id, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    ulid(),
    TENANT,
    a,
    b,
  );
}

async function clean(): Promise<void> {
  await db.$executeRaw`DELETE FROM property_twins WHERE tenant_id = ${TENANT}`;
}

beforeAll(async () => {
  const url = process.env["DIRECT_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DIRECT_DATABASE_URL חסר — הבדיקה דורשת מסד אמיתי");
  }
  db = new PrismaClient({ datasources: { db: { url } } });
  await clean();
});

afterAll(async () => {
  if (db !== undefined) {
    await clean();
    await db.$disconnect();
  }
});

describe("property_twins — הסדר הקנוני", () => {
  it("זוג בסדר הקנוני נכנס", async () => {
    await clean();
    await expect(insertPair(LOW, HIGH)).resolves.toBeUndefined();
  });

  it("זוג הפוך נדחה — אחרת הסימטריה נשברת", async () => {
    /*
     * זה הלב. בלי האילוץ הזה השורה ההפוכה הייתה נכנסת בשקט לצד
     * הקיימת, והנכס היה מופיע פעמיים בלשונית.
     */
    await clean();
    await insertPair(LOW, HIGH);
    await expect(insertPair(HIGH, LOW)).rejects.toThrow(
      /property_twins_canonical_order/u,
    );
  });

  it("נכס אינו תאום של עצמו — גם ברמת המסד", async () => {
    await clean();
    await expect(insertPair(LOW, LOW)).rejects.toThrow(
      /property_twins_canonical_order/u,
    );
  });

  it("אותו זוג פעמיים נדחה", async () => {
    await clean();
    await insertPair(LOW, HIGH);
    /*
     * הבדיקה על **קוד השגיאה** (23505 = הפרת ייחודיות) ולא על נוסח
     * ההודעה: הנוסח תלוי ב-locale של השרת, ובדיקה שנשענת עליו
     * נשברת ביום שהמסד עולה בהגדרה אחרת — בלי ששום דבר אמיתי
     * השתנה.
     */
    await expect(insertPair(LOW, HIGH)).rejects.toMatchObject({
      meta: { code: "23505" },
    });
  });

  it("אותו זוג אצל דייר אחר מותר — הייחודיות היא לכל משרד", async () => {
    await clean();
    await insertPair(LOW, HIGH);
    const other = "01JWATWINTENANT00000000002";
    await db.$executeRawUnsafe(
      `INSERT INTO property_twins (id, tenant_id, property_a_id, property_b_id, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      ulid(),
      other,
      LOW,
      HIGH,
    );
    const rows = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM property_twins
       WHERE property_a_id = ${LOW} AND property_b_id = ${HIGH}`;
    expect(Number(rows[0]?.n)).toBe(2);
    await db.$executeRaw`DELETE FROM property_twins WHERE tenant_id = ${other}`;
  });

  it("הסדר שהקוד מחשב הוא הסדר שהמסד מקבל", async () => {
    /*
     * שתי ההשוואות — זו של `canonicalTwinPair` ב-JavaScript וזו של
     * ה-`CHECK` ב-Postgres — חייבות להסכים. בדיקה שרק מכניסה זוג
     * שמישהו סידר ביד לא הייתה תופסת פער ביניהן.
     */
    await clean();
    const pair = canonicalTwinPair(HIGH, LOW);
    if (pair === null) throw new Error("canonicalTwinPair החזירה null לזוג תקין");
    await expect(insertPair(pair.first, pair.second)).resolves.toBeUndefined();
  });

  it("סימון חוזר של אותו זוג מעדכן את ההערה ואינו יוצר שורה שנייה", async () => {
    /*
     * המשפט שהשירות מריץ בפועל. הוא נבחר אחרי ששתי החלופות נבדקו
     * מול מסד אמיתי ונפלו: `upsert` של Prisma אינו אטומי, ו-`create`
     * בתוך `try/catch` על P2002 מבטל את הטרנזקציה כולה (`25P02`),
     * כלומר גם ה-`updateMany` שאחריו נכשל.
     */
    await clean();
    const upsert = async (note: string): Promise<void> => {
      await db.$executeRaw`
        INSERT INTO property_twins
               (id, tenant_id, property_a_id, property_b_id, note, created_at)
        VALUES (${ulid()}, ${TENANT}, ${LOW}, ${HIGH}, ${note}, now())
        ON CONFLICT (tenant_id, property_a_id, property_b_id)
        DO UPDATE SET note = EXCLUDED.note`;
    };
    await upsert("ראשונה");
    await upsert("שנייה");

    const rows = await db.$queryRaw<{ note: string | null }[]>`
      SELECT note FROM property_twins WHERE tenant_id = ${TENANT}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.note).toBe("שנייה");
  });

  it("ON CONFLICT עובד גם בתוך טרנזקציה, בלי לבטל אותה", async () => {
    /*
     * הרגרסיה על `25P02`: אחרי המשפט הזה הטרנזקציה חייבת להישאר
     * שמישה, כי בשירות באות אחריו רשומת הביקורת והקריאה החוזרת.
     */
    await clean();
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO property_twins
               (id, tenant_id, property_a_id, property_b_id, created_at)
        VALUES (${ulid()}, ${TENANT}, ${LOW}, ${HIGH}, now())
        ON CONFLICT (tenant_id, property_a_id, property_b_id)
        DO UPDATE SET note = EXCLUDED.note`;
      await tx.$executeRaw`
        INSERT INTO property_twins
               (id, tenant_id, property_a_id, property_b_id, note, created_at)
        VALUES (${ulid()}, ${TENANT}, ${LOW}, ${HIGH}, ${"שוב"}, now())
        ON CONFLICT (tenant_id, property_a_id, property_b_id)
        DO UPDATE SET note = EXCLUDED.note`;
      // הפקודה שאחרי ההתנגשות — זו שהייתה נופלת על 25P02
      const rows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM property_twins WHERE tenant_id = ${TENANT}`;
      expect(Number(rows[0]?.n)).toBe(1);
    });
  });

  it("האילוץ מוגדר עם COLLATE \"C\" ולא בהשוואת ברירת המחדל", async () => {
    const rows = await db.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'property_twins_canonical_order'`;
    expect(rows[0]?.def).toContain('COLLATE "C"');
  });
});
