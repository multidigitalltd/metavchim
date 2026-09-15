import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import type { CryptoService } from "../../core/crypto.service";
import type { PrismaService } from "../../core/prisma.service";
import { ForumNotifyService } from "./forum-notify.service";
import { ForumService } from "./forum.service";

/**
 * הפורום מול מסד אמיתי — **מה שבדיקת היחידה אינה יכולה להבטיח.**
 *
 * שאילתת החיפוש היא SQL גולמי על אינדקס GIN, הדפדוף הוא `cursor`
 * של Prisma, סינון „עוקבים אחרי הכול” הוא נתיב JSON, וההפצה כותבת
 * ל-`notifications` תחת RLS של **משרד אחר**. כל אחד מהם עובר את
 * הקומפיילר גם כשהוא שגוי. כאן שני משרדים ושני משתמשים אמיתיים:
 * א' שואל בעילום שם, ב' עונה, וכל צד רואה בדיוק מה שמותר לו.
 */

vi.mock("../../config/env", () => ({ loadEnv: () => ({ PLATFORM_ADMIN_EMAILS: [] }) }));

const TENANT_A = "01FORUMTENANTAAAAAAAAAAAAA";
const TENANT_B = "01FORUMTENANTBBBBBBBBBBBBB";
const USER_A = "01FORUMUSERAAAAAAAAAAAAAAA";
const USER_B = "01FORUMUSERBBBBBBBBBBBBBBB";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

let app: PrismaClient;
let owner: PrismaClient;
let svc: ForumService;
let auditLog: { entityId?: string; metadata?: Record<string, unknown> }[] = [];

const key = (userId: string) => `k${userId}`.padEnd(64, "0");

function as<T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  return TenantContext.run(
    { tenantId, userId, capabilities: new Set(), billingOnly: false } as Parameters<typeof TenantContext.run>[0],
    fn,
  );
}

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } } });
  for (const [tenant, user, name, email, prefs] of [
    [TENANT_A, USER_A, "דנה לוי", "forum-a@test.local", "{}"],
    [TENANT_B, USER_B, "יוסי כהן", "forum-b@test.local", '{"forum":{"followAll":true}}'],
  ] as const) {
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ('${tenant}', 'משרד ${name}', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, preferences, password_changed_at, created_at, updated_at)
       VALUES ('${user}', '${tenant}', '${name}', '${email}', 'agent', true, '${prefs}'::jsonb, now(), now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
  }
  app = new PrismaClient({ datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } } });

  /*
   * ‎`PrismaService` בלי Nest: אותם שני מסלולים שהשירות משתמש בהם —
   * הלקוח הגלובלי לטבלאות הפורום, ו-`withTenant`/`withExplicitTenant`
   * לטבלאות הדייר (ההתראות, יומן הביקורת).
   */
  const withExplicitTenant = <T>(tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  const prisma = Object.assign(app, {
    withTenant: <T>(fn: (tx: unknown) => Promise<T>) => withExplicitTenant(TenantContext.current().tenantId, fn),
    withExplicitTenant,
  }) as unknown as PrismaService;
  // הצפנה הפיכה מדומה — הבדיקה בודקת את המסלול, לא את AES
  const crypto = {
    forumAuthorKey: key,
    encrypt: (plain: string) => `enc:${Buffer.from(plain, "utf8").toString("base64")}`,
    decrypt: (stored: string) => Buffer.from(stored.replace(/^enc:/u, ""), "base64").toString("utf8"),
  } as unknown as CryptoService;
  const audited: { entityId?: string; metadata?: Record<string, unknown> }[] = [];
  const audit = {
    record: async (_tx: unknown, entry: { entityId?: string; metadata?: Record<string, unknown> }) => {
      audited.push(entry);
    },
  } as unknown as AuditService;
  auditLog = audited;
  svc = new ForumService(prisma, crypto, audit, new ForumNotifyService(prisma, crypto));
});

afterAll(async () => {
  await app?.$disconnect();
  await owner.$executeRawUnsafe(`DELETE FROM forum_threads WHERE author_key IN ('${key(USER_A)}', '${key(USER_B)}')`);
  await owner.$executeRawUnsafe(`DELETE FROM forum_listings WHERE created_by_user_id IN ('${USER_A}', '${USER_B}')`);
  await owner.$executeRawUnsafe(`DELETE FROM notifications WHERE tenant_id IN ('${TENANT_A}', '${TENANT_B}')`);
  await owner.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('${USER_A}', '${USER_B}')`);
  await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${TENANT_A}', '${TENANT_B}')`);
  await owner.$disconnect();
});

/** ההפצה רצה ברקע; ממתינים לה במקום להניח. */
async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ההפצה לא הושלמה בזמן");
}

describe("הפורום מול Postgres — שני משרדים, שאלה אנונימית", () => {
  it("א' שואל בעילום שם, ב' עונה, וכל צד רואה רק מה שמותר לו", async () => {
    const thread = await as(TENANT_A, USER_A, () =>
      svc.createThread({
        kind: "question",
        topic: "exclusivity",
        title: "ביטול בלעדיות לפני הזמן — מה הדין",
        body: "לקוח מבקש לבטל הסכם בלעדיות אחרי חודש. האם מגיעה עמלה על מכירה שתתבצע אחר כך?",
        anonymous: true,
      }),
    );
    expect(thread.author).toEqual({ label: "מתווך/ת אנונימי/ת", office: null, anonymous: true });
    expect(thread.mine).toBe(true);
    expect(thread.following).toBe(true);

    // שורת המסד עצמה — בלי מזהה מחבר, בלי שורת מעקב שמצביעה עליו, ובלי מזהה ביומן
    const row = await app.forumThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(row.authorUserId).toBeNull();
    expect(row.authorTenantId).toBeNull();
    expect(row.authorRef).not.toBeNull();
    expect(await app.forumFollow.count({ where: { threadId: thread.id } })).toBe(0);
    expect(JSON.stringify(auditLog)).not.toContain(thread.id);

    // ב' עוקב אחרי כל הפורום — קיבל התראה על השרשור החדש, במשרד שלו
    await eventually(async () =>
      (await owner.notification.count({ where: { tenantId: TENANT_B, userId: USER_B, type: "forum_thread", entityId: thread.id } })) === 1,
    );

    const reply = await as(TENANT_B, USER_B, () =>
      svc.reply(thread.id, { body: "לפי הנוסח המקובל — כן, בתוך תקופת הבלעדיות ועד חצי שנה אחריה.", anonymous: false }),
    );
    expect(reply.author).toEqual({ label: "יוסי כהן", office: "משרד יוסי כהן", anonymous: false });

    // א' רואה את התגובה, ומקבל התראה במשרד שלו — דרך ההפניה המוצפנת, בלי שורת מעקב
    await eventually(async () =>
      (await owner.notification.count({ where: { tenantId: TENANT_A, userId: USER_A, type: "forum_reply", entityId: thread.id } })) === 1,
    );
    const seenByA = await as(TENANT_A, USER_A, () => svc.getThread(thread.id));
    expect(seenByA.replyCount).toBe(1);
    expect(seenByA.posts[0]?.mine).toBe(false);

    // ב' רואה את השואל/ת בלי לדעת מי, ואת עצמו בשם
    const seenByB = await as(TENANT_B, USER_B, () => svc.getThread(thread.id));
    expect(seenByB.author.label).toBe("מתווך/ת אנונימי/ת");
    expect(seenByB.mine).toBe(false);
    expect(seenByB.posts[0]?.mine).toBe(true);
    expect(JSON.stringify(seenByB)).not.toContain(USER_A);

    // א' מסמן את התשובה — ב' מקבל את ההתראה
    const accepted = await as(TENANT_A, USER_A, () => svc.accept(thread.id, reply.id));
    expect(accepted.answered).toBe(true);
    expect(accepted.posts[0]?.accepted).toBe(true);
    await eventually(async () =>
      (await owner.notification.count({ where: { tenantId: TENANT_B, userId: USER_B, type: "forum_accepted" } })) === 1,
    );

    // „מועיל” — פעם אחת מעלה, פעם שנייה מורידה
    const up = await as(TENANT_B, USER_B, () => svc.vote("thread", thread.id));
    expect(up).toEqual({ score: 1, voted: true });
    const down = await as(TENANT_B, USER_B, () => svc.vote("thread", thread.id));
    expect(down).toEqual({ score: 0, voted: false });

    // חיפוש בעברית דרך האינדקס — גם עם ה' הידיעה
    const found = await as(TENANT_B, USER_B, () => svc.listThreads({ q: "הבלעדיות", sort: "active" }));
    expect(found.items.map((t) => t.id)).toContain(thread.id);
    const anonymousOnly = await as(TENANT_B, USER_B, () => svc.listThreads({ anonymous: "1", sort: "active" }));
    expect(anonymousOnly.items.map((t) => t.id)).toContain(thread.id);

    // חיפוש שמוצא רק בתגובה, ועם סינון שנכנס לשאילתה עצמה
    const inReply = await as(TENANT_A, USER_A, () => svc.listThreads({ q: "הנוסח המקובל", topic: "exclusivity", sort: "active" }));
    expect(inReply.items.map((t) => t.id)).toContain(thread.id);
    const wrongTopic = await as(TENANT_A, USER_A, () => svc.listThreads({ q: "הנוסח המקובל", topic: "marketing", sort: "active" }));
    expect(wrongTopic.items.map((t) => t.id)).not.toContain(thread.id);

    // א' מפסיק לעקוב — „במעקב” כבה בלי ששורת מעקב נוצרה או נמחקה
    expect(await as(TENANT_A, USER_A, () => svc.follow(thread.id, false))).toEqual({ following: false });
    expect((await as(TENANT_A, USER_A, () => svc.getThread(thread.id))).following).toBe(false);
    expect(await app.forumFollow.count({ where: { threadId: thread.id } })).toBe(1); // רק של ב'
    const notFollowing = await as(TENANT_A, USER_A, () => svc.listThreads({ following: "1", sort: "active" }));
    expect(notFollowing.items.map((t) => t.id)).not.toContain(thread.id);

    // ב' אינו יכול לערוך את השרשור של א' — 404
    await expect(as(TENANT_B, USER_B, () => svc.editThread(thread.id, { title: "כותרת אחרת ארוכה מספיק" }))).rejects.toThrow();
  });

  it("המדריך — דירוג אחד לכל מדרג, דירוג חוזר מחליף ומתקן את המונים", async () => {
    const { id } = await as(TENANT_A, USER_A, () =>
      svc.createListing({ kind: "pro", category: "lawyer", name: "עו\"ד בדיקה", description: "ליווי עסקאות מקרקעין באזור המרכז" }),
    );
    const first = await as(TENANT_B, USER_B, () => svc.rate(id, { score: 5, anonymous: true, comment: "מעולה" }));
    expect(first).toEqual({ ratingAverage: 5, ratingCount: 1 });
    const second = await as(TENANT_B, USER_B, () => svc.rate(id, { score: 3, anonymous: false }));
    expect(second).toEqual({ ratingAverage: 3, ratingCount: 1 });
    const third = await as(TENANT_A, USER_A, () => svc.rate(id, { score: 4, anonymous: false }));
    expect(third).toEqual({ ratingAverage: 3.5, ratingCount: 2 });

    const listed = await as(TENANT_B, USER_B, () => svc.listListings({ kind: "pro" }));
    const mine = listed.items.find((item) => item.id === id);
    expect(mine?.myRating?.score).toBe(3);
    expect(mine?.ratingCount).toBe(2);
  });
});
