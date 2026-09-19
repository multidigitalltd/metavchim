import { describe, expect, it, vi } from "vitest";
import { AuthService, type ValidatedUser } from "./auth.service";
import { PERSISTENT_SESSION_TTL_MS, SESSION_TTL_MS } from "../../common/session-lifetime";

/**
 * ‏**מכשיר נייד אחד לחשבון — נאכף ב-`issueSession`.**
 *
 * ‏שער „חיבור אחד לחשבון” ב-web אינו סופר Sessions של האפליקציה, ו-`client`
 * ‏הוא הצהרה של הלקוח. מה שהופך את ההצהרה למשבצת ולא לפטור הוא המחיקה
 * ‏כאן: Session נייד חדש מוחק את הקודם, ודפדפן שמתחזה ל-mobile תופס
 * ‏את אותה משבצת. נבדק מול כפיל של Prisma — מה נמחק, ומה נוצר.
 */

const USER = {
  id: "01USER00000000000000000000",
  passwordChangedAt: new Date("2026-01-01T00:00:00Z"),
} as unknown as ValidatedUser;

function serviceWith() {
  const prisma = {
    session: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => undefined),
    },
    user: { update: vi.fn(async () => undefined) },
  };
  const service = new AuthService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe("משבצת הנייד", () => {
  it("Session נייד חדש מוחק את הנייד הקודם של אותו משתמש — ורק אותו", async () => {
    const { service, prisma } = serviceWith();
    await service.issueSession(USER, { client: "mobile", persistent: true });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER.id, client: "mobile" },
    });
    const created = prisma.session.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(created.data).toMatchObject({ userId: USER.id, client: "mobile", persistent: true });
  });

  it("דפדפן אינו נוגע במשבצת הנייד, ובקשה ל-Session מתמשך ממנו מתעלמת", async () => {
    const { service, prisma } = serviceWith();
    const before = Date.now();
    const { expiresAt } = await service.issueSession(USER, { client: "web", persistent: true });
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    const created = prisma.session.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(created.data).toMatchObject({ client: "web", persistent: false });
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(SESSION_TTL_MS + 1000);
  });

  it("נייד במכשיר נעול — 30 יום; נייד בלי נעילה — 12 שעות", async () => {
    const { service } = serviceWith();
    const before = Date.now();
    const locked = await service.issueSession(USER, { client: "mobile", persistent: true });
    const open = await service.issueSession(USER, { client: "mobile", persistent: false });
    expect(locked.expiresAt.getTime() - before).toBeGreaterThan(PERSISTENT_SESSION_TTL_MS - 1000);
    expect(open.expiresAt.getTime() - before).toBeLessThanOrEqual(SESSION_TTL_MS + 1000);
  });
});
