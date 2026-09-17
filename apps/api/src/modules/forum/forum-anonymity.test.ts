import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import type { CryptoService } from "../../core/crypto.service";
import type { PrismaService } from "../../core/prisma.service";
import type { ForumNotifyService } from "./forum-notify.service";
import { ForumService } from "./forum.service";

// הסביבה אינה נטענת בבדיקת יחידה — רשימת מנהלי הפלטפורמה ריקה
vi.mock("../../config/env", () => ({ loadEnv: () => ({ PLATFORM_ADMIN_EMAILS: [] }) }));

/**
 * **האנונימיות נבדקת בקצה ה-DTO, לא בכוונה.**
 *
 * הבטחת הפורום היא שאיש אינו יכול לדעת מי שאל בעילום שם. שורה
 * אנונימית אינה נושאת מזהה משתמש, אבל ה-DTO עדיין עובר דרך קוד
 * שיודע להציג שם ומשרד — ו„הצגת שם רק כשלא אנונימי” הוא תנאי אחד
 * שמישהו יכול להסיר בתיקון תמים. הבדיקה כאן קוראת שרשור עם תגובות
 * מעורבות ומוודאת, שדה-שדה, שהמזוהה מזוהה והאנונימי אינו.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01USERAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01USERBBBBBBBBBBBBBBBBBBBB";
const THREAD = "01THREADAAAAAAAAAAAAAAAAAA";

const key = (userId: string) => `key-${userId}`.padEnd(64, "0");

function harness() {
  const thread = {
    id: THREAD,
    kind: "question",
    topic: "legal",
    title: "שאלה מביכה על סעיף בהסכם",
    body: "גוף השאלה שנכתב בעילום שם",
    anonymous: true,
    authorKey: key(OTHER),
    authorRef: "enc:REF-OF-OTHER",
    authorNotify: true,
    authorUserId: null,
    authorTenantId: null,
    replyCount: 2,
    score: 0,
    acceptedPostId: null,
    pinned: false,
    locked: false,
    hiddenAt: null,
    lastActivityAt: new Date(),
    editedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    author: null,
    authorTenant: null,
  };
  const posts = [
    {
      id: "01POSTAAAAAAAAAAAAAAAAAAAA",
      threadId: THREAD,
      body: "תגובה מזוהה",
      anonymous: false,
      authorKey: key(ME),
      authorUserId: ME,
      authorTenantId: TENANT,
      score: 3,
      hiddenAt: null,
      editedAt: null,
      createdAt: new Date(1),
      author: { name: "דנה לוי" },
      authorTenant: { name: "לוי נדל\"ן" },
    },
    {
      id: "01POSTBBBBBBBBBBBBBBBBBBBB",
      threadId: THREAD,
      body: "תגובת השואל/ת בעילום שם",
      anonymous: true,
      authorKey: key(OTHER),
      authorUserId: null,
      authorTenantId: null,
      score: 0,
      hiddenAt: null,
      editedAt: null,
      createdAt: new Date(2),
      author: null,
      authorTenant: null,
    },
  ];
  const prisma = {
    user: { findUnique: async () => ({ email: "agent@office.example", preferences: {} }) },
    forumThread: {
      findUnique: async (args: { select?: Record<string, boolean> }) =>
        args.select === undefined ? thread : { authorKey: thread.authorKey, replyCount: 2, hiddenAt: null, locked: false },
    },
    forumPost: { findMany: async () => posts },
    forumVote: { findMany: async () => [{ targetType: "post", targetId: posts[0]!.id }] },
    forumFollow: { findMany: async () => [] },
  } as unknown as PrismaService;
  const crypto = { forumAuthorKey: key } as unknown as CryptoService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  const notify = {} as unknown as ForumNotifyService;
  const svc = new ForumService(prisma, crypto, audit, notify);
  const run = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      { tenantId: TENANT, userId: ME, capabilities: new Set(), billingOnly: false } as Parameters<typeof TenantContext.run>[0],
      fn,
    );
  return { svc, run };
}

describe("הפורום — מה נחשף על מחבר", () => {
  it("שרשור אנונימי: כינוי בלי שם ובלי משרד; המשיב המזוהה — בשם ובמשרד", async () => {
    const { svc, run } = harness();
    const dto = await run(() => svc.getThread(THREAD));

    expect(dto.author).toEqual({ label: "מתווך/ת אנונימי/ת", office: null, anonymous: true });
    expect(dto.mine).toBe(false);
    expect(dto.canModerate).toBe(false);

    const [named, anon] = dto.posts;
    expect(named?.author).toEqual({ label: "דנה לוי", office: "לוי נדל\"ן", anonymous: false });
    expect(named?.mine).toBe(true);
    expect(named?.voted).toBe(true);
    // תגובת השואל/ת בשרשור שלו מסומנת ככזו — בלי לגלות מי
    expect(anon?.author).toEqual({ label: "השואל/ת", office: null, anonymous: true });
    expect(anon?.mine).toBe(false);
    // אף שדה ב-DTO אינו נושא מזהה משתמש או חתם
    expect(JSON.stringify(dto)).not.toContain(OTHER);
    expect(JSON.stringify(dto)).not.toContain(key(OTHER));
    // וגם לא ההפניה המוצפנת — היא של ההתראות, לא של המסך
    expect(JSON.stringify(dto)).not.toContain("REF-OF-OTHER");
  });

  it("עריכה או מחיקה של מה שאינו שלי — 404, לא 403: קיום השורה אינו מידע", async () => {
    const { svc, run } = harness();
    await expect(run(() => svc.editThread(THREAD, { title: "כותרת חדשה שהיא ארוכה מספיק" }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(run(() => svc.deleteThread(THREAD))).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * ‎**והיוצא מן הכלל: דירוג במדריך** (docs/16 §2א).
 *
 * שאלה בעילום שם פוגעת לכל היותר בשואל. חוות דעת בעילום שם היא
 * אמירה על **העסק של מישהו אחר**, שאין מולה עם מי לדבר — ולכן דירוג
 * נושא תמיד שם וגם משרד. הבדיקה מכסה את שני הקצוות: מה נכתב למסד,
 * ומה יוצא ב-DTO.
 */
function ratingHarness() {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    user: { findUnique: async () => ({ email: "agent@office.example", preferences: {} }) },
    forumListing: { findFirst: async () => ({ id: "01LISTINGAAAAAAAAAAAAAAAAA" }) },
    forumRating: {
      findMany: async () => [
        {
          id: "01RATINGAAAAAAAAAAAAAAAAAA",
          anonymous: false,
          score: 5,
          comment: "ליווה עסקה מורכבת, זמין בכל שעה",
          createdAt: new Date(1),
          user: { name: "דנה לוי" },
          raterTenant: { name: 'לוי נדל"ן' },
        },
        {
          /* משתמש שנמחק — המשרד נשאר, כי הוא בעמודה משלו */
          id: "01RATINGBBBBBBBBBBBBBBBBBB",
          anonymous: false,
          score: 2,
          comment: "לא חזר אליי",
          createdAt: new Date(2),
          user: null,
          raterTenant: { name: "כהן נכסים" },
        },
      ],
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        forumRating: {
          findUnique: async () => null,
          create: async (args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return args.data;
          },
          update: async (args: { data: Record<string, unknown> }) => args.data,
        },
        forumListing: { update: async () => ({ ratingSum: 5, ratingCount: 1 }) },
      }),
  } as unknown as PrismaService;
  const crypto = {
    forumAuthorKey: key,
    /* ‏`rater_ref` בדירוג אנונימי — אותו מסלול כמו `author_ref` בשרשור */
    encrypt: (value: string) => `enc(${value})`,
  } as unknown as CryptoService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  const notify = {} as unknown as ForumNotifyService;
  const svc = new ForumService(prisma, crypto, audit, notify);
  const run = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      { tenantId: TENANT, userId: ME, capabilities: new Set(), billingOnly: false } as Parameters<typeof TenantContext.run>[0],
      fn,
    );
  return { svc, run, created };
}

/**
 * ‎**דירוג במדריך — בשם או בעילום שם** (docs/16 §2א).
 *
 * הכלל „תמיד בשם” היה כאן, והתהפך: מתווך שעבד עם ספק שמופיע גם אצל
 * הקולגה ממול פשוט אינו כותב את חוות הדעת השלילית, ומדריך שיש בו רק
 * חמישה כוכבים אינו מדריך.
 *
 * מה שנבדק כאן הוא ש„אנונימי” פירושו **שאין מה לחשוף** — לא הסתרה
 * בתצוגה מעל שורה שעדיין נושאת זהות.
 */
describe("דירוג במדריך — בשם או בעילום שם", () => {
  it("בשם: השורה נושאת את המשתמש ואת המשרד, ובלי `raterRef`", async () => {
    const { svc, run, created } = ratingHarness();
    await run(() => svc.rate("01LISTINGAAAAAAAAAAAAAAAAA", { score: 5, anonymous: false }));

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: ME,
      raterTenantId: TENANT,
      score: 5,
      anonymous: false,
      raterRef: null,
    });
  });

  /*
   * ‎**הלב.** שורה אנונימית שעדיין נושאת `userId` היא „אנונימית”
   * במסך בלבד — כלומר הבטחה שאינה נכונה ברגע שמישהו קורא את הטבלה.
   */
  it("בעילום שם: אין משתמש ואין משרד, ויש `raterRef` מוצפן", async () => {
    const { svc, run, created } = ratingHarness();
    await run(() => svc.rate("01LISTINGAAAAAAAAAAAAAAAAA", { score: 2, anonymous: true }));

    expect(created[0]).toMatchObject({
      userId: null,
      raterTenantId: null,
      anonymous: true,
      raterRef: `enc(${TENANT}:${ME})`,
    });
  });

  it("ה-DTO נושא שם ומשרד; משתמש שנמחק — המשרד נשאר", async () => {
    const { svc, run } = ratingHarness();
    const { items } = await run(() => svc.listRatings("01LISTINGAAAAAAAAAAAAAAAAA"));

    expect(items[0]?.author).toEqual({ label: "דנה לוי", office: 'לוי נדל"ן', anonymous: false });
    expect(items[1]?.author).toEqual({ label: "משתמש שנמחק", office: "כהן נכסים", anonymous: false });
  });
});
