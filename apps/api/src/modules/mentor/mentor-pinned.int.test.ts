import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ‎**הנעוץ חוזר אל המסך — מול מסד אמיתי.**
 *
 * ## ‏מה כאן ולא בבדיקת יחידה
 *
 * ‏שתי התקלות ש-Codex מצא הן שתיהן על **גבול של שאילתה**, ואי אפשר
 * ‏לראות אותן בלי נתונים:
 *
 * 1. ‎**חלון שאינו מכיל את העוגן.** השיחה נטענה ב-40 האחרונות, ולכן
 *    ‏נעוץ ישן יותר פשוט לא היה על המסך — הרשימה שקיימת כדי להחזיר
 *    ‏אליו לא החזירה אליו. הבדיקה זורעת שיחה **ארוכה מהחלון**, כי
 *    ‏על שיחה קצרה שתי ההתנהגויות נראות זהות.
 * 2. ‎**עמוד שהוא גבול.** בלי סמן, נעוץ שלושים ואחד הסתיר את הישן
 *    ‏ממנו לתמיד.
 *
 * ‏השאילתות משוכפלות כאן במתכוון: השירות דורש `TenantContext` ו-DI,
 * ‏וזה הדפוס של שאר בדיקות האינטגרציה בריפו. מה שנבדק הוא הסמנטיקה
 * ‏של הגבולות — שהיא מה שנשבר.
 */

const TENANT = "01PINTENANTAAAAAAAAAAAAAAA";
const USER = "01PINUSERAAAAAAAAAAAAAAAAA";
const THREAD = "01PINMSG00000000000000000A";
/** ‏ארוך מהחלון של 40 — אחרת אין מה לבדוק */
const COUNT = 60;
const WINDOW = 40;
const BEFORE = 8;
const PAGE = 30;

let db: PrismaClient | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} חסר — הבדיקה דורשת מסד אמיתי`);
  return value;
}

/** ‏מזהה קריא באורך 26, ממוין לפי המספר */
function messageId(n: number): string {
  return `01PINMSG${String(n).padStart(18, "0")}`;
}

const BASE = new Date("2026-09-01T06:00:00.000Z");

beforeAll(async () => {
  db = new PrismaClient({
    datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } },
  });
  await db.$executeRaw`
    INSERT INTO tenants (id, name, settings, created_at, updated_at)
    VALUES (${TENANT}, 'משרד נעוצים', '{}'::jsonb, now(), now())
    ON CONFLICT (id) DO NOTHING`;
  await db.$executeRaw`
    INSERT INTO users (id, tenant_id, email, name, role, password_hash, created_at, updated_at)
    VALUES (${USER}, ${TENANT}, 'pinned@example.test', 'דנה', 'agent', 'x', now(), now())
    ON CONFLICT (id) DO NOTHING`;

  /*
   * ‏שיחה אחת בת 60 הודעות, כולן באותה שיחה (`thread_id` אחיד).
   * ‏הנעיצות יושבות על ההודעות הישנות — כלומר מחוץ לחלון — כי זו
   * ‏בדיוק הקבוצה שנעלמה מהמסך.
   */
  for (let n = 0; n < COUNT; n += 1) {
    const pinned = n < 35 ? new Date(BASE.getTime() + n * 60_000) : null;
    await db.$executeRaw`
      INSERT INTO mentor_messages (id, tenant_id, user_id, thread_id, role, text, pinned_at, created_at)
      VALUES (${messageId(n)}, ${TENANT}, ${USER}, ${THREAD},
              ${n % 2 === 0 ? "user" : "mentor"}, ${`הודעה ${n}`},
              ${pinned}, ${new Date(BASE.getTime() + n * 60_000)})
      ON CONFLICT (id) DO NOTHING`;
  }
});

afterAll(async () => {
  if (db === undefined) return;
  await db.$executeRaw`DELETE FROM mentor_messages WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM users WHERE tenant_id = ${TENANT}`;
  await db.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
  await db.$disconnect();
});

/** ‏החלון סביב הודעה — אותה סמנטיקה כמו `MentorService.turnsAround`. */
async function windowAround(anchorId: string): Promise<string[]> {
  const anchor = await db!.mentorMessage.findFirst({
    where: { id: anchorId, tenantId: TENANT, userId: USER },
    select: { threadId: true, createdAt: true },
  });
  if (anchor === null) return [];
  const [earlier, rest] = await Promise.all([
    db!.mentorMessage.findMany({
      where: {
        tenantId: TENANT,
        userId: USER,
        threadId: anchor.threadId,
        createdAt: { lt: anchor.createdAt },
      },
      orderBy: { createdAt: "desc" },
      take: BEFORE,
    }),
    db!.mentorMessage.findMany({
      where: {
        tenantId: TENANT,
        userId: USER,
        threadId: anchor.threadId,
        createdAt: { gte: anchor.createdAt },
      },
      orderBy: { createdAt: "asc" },
      take: WINDOW - BEFORE,
    }),
  ]);
  return [...earlier.reverse(), ...rest].map((m) => m.id);
}

/** ‏40 האחרונות של השיחה — מה שהיה לפני התיקון. */
async function tail(): Promise<string[]> {
  const rows = await db!.mentorMessage.findMany({
    where: { tenantId: TENANT, userId: USER, threadId: THREAD },
    orderBy: { createdAt: "desc" },
    take: WINDOW,
  });
  return rows.reverse().map((m) => m.id);
}

async function pinnedPage(before?: Date): Promise<{ ids: string[]; next: Date | null }> {
  const rows = await db!.mentorMessage.findMany({
    where: {
      tenantId: TENANT,
      userId: USER,
      pinnedAt: before === undefined ? { not: null } : { lt: before },
    },
    orderBy: { pinnedAt: "desc" },
    take: PAGE,
  });
  const last = rows.length === PAGE ? rows[rows.length - 1] : undefined;
  return { ids: rows.map((m) => m.id), next: last?.pinnedAt ?? null };
}

describe("פתיחת נעוץ בשיחה ארוכה — מול מסד אמיתי", () => {
  it("הזריעה באמת ארוכה מהחלון, אחרת אין מה לבדוק", async () => {
    expect(
      await db!.mentorMessage.count({ where: { tenantId: TENANT, userId: USER } }),
    ).toBe(COUNT);
    expect(COUNT).toBeGreaterThan(WINDOW);
  });

  /* ‏זו התקלה עצמה: הנעוץ הישן פשוט לא היה ברשימה שנטענה */
  it("40 האחרונות אינן מכילות נעוץ ישן", async () => {
    expect(await tail()).not.toContain(messageId(3));
  });

  it("החלון סביב הנעוץ מכיל אותו", async () => {
    const ids = await windowAround(messageId(45));
    expect(ids).toContain(messageId(45));
    /* ‏8 לפניו, והוא ומה שאחריו עד סוף השיחה — 45..59 הן 15 */
    expect(ids).toEqual([
      ...Array.from({ length: BEFORE }, (_, i) => messageId(45 - BEFORE + i)),
      ...Array.from({ length: COUNT - 45 }, (_, i) => messageId(45 + i)),
    ]);
  });

  it("ומכיל גם מעט ממה שנאמר לפניו — משפט בלי הקשר הוא ציטוט", async () => {
    const ids = await windowAround(messageId(45));
    expect(ids).toContain(messageId(44));
    expect(ids).toContain(messageId(45 - BEFORE));
    expect(ids).not.toContain(messageId(45 - BEFORE - 1));
  });

  it("נעוץ בתחילת השיחה נפתח גם כשאין לפניו כלום", async () => {
    const ids = await windowAround(messageId(0));
    expect(ids[0]).toBe(messageId(0));
    expect(ids).toHaveLength(WINDOW - BEFORE);
  });

  it("הודעה שאינה של המתווך הזה מחזירה ריק", async () => {
    expect(await windowAround("01PINMSG00000000000000009Z")).toEqual([]);
  });
});

describe("עמודי הנעוצים — מול מסד אמיתי", () => {
  it("העמוד הראשון מלא, והסמן מצביע הלאה", async () => {
    const first = await pinnedPage();
    expect(first.ids).toHaveLength(PAGE);
    expect(first.next).not.toBeNull();
    /* ‏החדש ביותר ראשון — הסדר הוא „מתי נעצתי” */
    expect(first.ids[0]).toBe(messageId(34));
  });

  /*
   * ‎**וזה מה שהיה חסר.** בלי הסמן, חמש הנעיצות הישנות היו מוסתרות
   * ‏לתמיד — נגישות רק למי שיבטל נעיצות חדשות יותר.
   */
  it("העמוד השני מביא את מה שהוסתר, בלי חפיפה", async () => {
    const first = await pinnedPage();
    const second = await pinnedPage(first.next!);
    expect(second.ids).toEqual([
      messageId(4),
      messageId(3),
      messageId(2),
      messageId(1),
      messageId(0),
    ]);
    expect(second.ids.some((id) => first.ids.includes(id))).toBe(false);
    /* ‏עמוד חלקי הוא הסוף, ולכן אין סמן — אחרת „עוד” לא היה מביא דבר */
    expect(second.next).toBeNull();
  });
});
