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
