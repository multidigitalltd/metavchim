import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { notifyOnce } from "./notify-once";
import type { TenantTx } from "../core/prisma.service";

/**
 * התראה אחת לאירוע — **מול Postgres אמיתי.**
 *
 * ## למה זו אינה בדיקת יחידה
 *
 * אין כאן שום היגיון להריץ. כל ההגנה היא אילוץ ייחודיות במסד
 * ו-`ON CONFLICT DO NOTHING` שנשען עליו, ושניהם קיימים רק שם.
 * בדיקה עם מסד מדומה הייתה מוודאת שכתבנו את המחרוזת שאנחנו
 * חושבים שכתבנו — ולא את מה שבאמת עומד למבחן: שהאילוץ נוצר, שהוא
 * על הצמד הנכון, ושהוא **אינו** חוסם התראות בלי מפתח.
 *
 * זה בדיוק הכשל שהיה: הבדיקה הקודמת („האם כבר יש שיחה כזו”) הייתה
 * קוד תקין לחלוטין שחיפש שורה שבנקודה הזו לעולם אינה קיימת.
 *
 * ## שלוש הטענות
 *
 * 1. אירוע שמגיע פעמיים כותב התראה **אחת**.
 * 2. השנייה אינה זורקת — היא מדווחת `false`. חריגה בתוך הטרנזקציה
 *    של קליטת השיחה הייתה מבטלת גם את רישום השיחה עצמה (`25P02`).
 * 3. `NULL` אינו מתנגש: התראות בלי אירוע חיצוני (תזכורת משימה,
 *    סיום תמלול) ממשיכות להיכתב כמה פעמים שצריך.
 */

let prisma: PrismaClient;
const TENANT = "01NOTIFYONCEAAAAAAAAAAAAAA";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

/** הרצה בהקשר דייר, כתפקיד האפליקציה — כמו `withExplicitTenant` בייצור. */
async function asTenant<T>(run: (tx: TenantTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${TENANT}', true)`);
    return run(tx as unknown as TenantTx);
  });
}

beforeAll(async () => {
  const owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  // הדייר נדרש כדי שהפוליסה תראה שורה חוקית; הבעלים כותב אותו
  await owner.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, created_at, updated_at)
     VALUES ('${TENANT}', 'בדיקת התראות', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await owner.$disconnect();
  prisma = new PrismaClient({
    datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  /*
   * ניקוי כבעלים: השורות של הבדיקה הזו אינן אמורות להישאר במסד
   * שסוויטת הבידוד סורקת אחריה. הבעלים ולא תפקיד האפליקציה, כי
   * המחיקה כוללת את שורת הדייר עצמה.
   */
  const owner = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  await owner.$executeRawUnsafe(`DELETE FROM notifications WHERE tenant_id = '${TENANT}'`);
  await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);
  await owner.$disconnect();
});

const base = {
  tenantId: TENANT,
  userId: null,
  type: "incoming_call",
  title: "שיחה נכנסת",
  body: null,
  entityType: null,
  entityId: null,
};

describe("notifyOnce", () => {
  it("אירוע שמגיע פעמיים מייצר התראה אחת, והשנייה מדווחת ולא זורקת", async () => {
    const key = `incoming_call:${ulid()}`;

    const first = await asTenant((tx) => notifyOnce(tx, { ...base, dedupeKey: key }));
    const second = await asTenant((tx) => notifyOnce(tx, { ...base, dedupeKey: key }));

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await asTenant((tx) =>
      tx.notification.findMany({ where: { tenantId: TENANT, dedupeKey: key } }),
    );
    expect(rows).toHaveLength(1);
  });

  it("הטרנזקציה שורדת את הכפילות — מה שנכתב אחריה נשמר", async () => {
    /*
     * הטענה שבאמת נבדקת כאן: `ON CONFLICT` ולא `try/catch`. משפט
     * שנכשל היה מרעיל את הטרנזקציה כולה, וכל כתיבה אחריה — למשל
     * שורת השיחה עצמה — הייתה נופלת ב-25P02.
     */
    const key = `incoming_call:${ulid()}`;
    const after = `incoming_call:${ulid()}`;
    await asTenant((tx) => notifyOnce(tx, { ...base, dedupeKey: key }));

    const survived = await asTenant(async (tx) => {
      await notifyOnce(tx, { ...base, dedupeKey: key });
      return notifyOnce(tx, { ...base, dedupeKey: after });
    });

    expect(survived).toBe(true);
  });

  it("התראות בלי מפתח אינן מתנגשות זו בזו", async () => {
    /*
     * ב-Postgres שורות עם NULL אינן שוות זו לזו לצורך אילוץ
     * ייחודיות. בלי התכונה הזו כל התראה שנייה ללא אירוע חיצוני
     * — תזכורת משימה, סיום תמלול — הייתה נבלעת בשקט.
     */
    const before = await asTenant((tx) =>
      tx.notification.count({ where: { tenantId: TENANT, dedupeKey: null } }),
    );
    await asTenant(async (tx) => {
      for (const title of ["תזכורת א", "תזכורת ב"]) {
        await tx.notification.create({
          data: { id: ulid(), tenantId: TENANT, type: "task_reminder", title },
        });
      }
    });
    const after = await asTenant((tx) =>
      tx.notification.count({ where: { tenantId: TENANT, dedupeKey: null } }),
    );
    expect(after - before).toBe(2);
  });
});
