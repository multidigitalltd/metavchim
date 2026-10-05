import { PrismaClient } from "@prisma/client";
import { parseFunnelIdempotencyKey } from "@metavchim/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { ActivationNudgeService } from "../../core/activation-nudge.service";
import type { EmailDomainProviderService } from "../../core/email-domain-provider.service";
import { EmailRejectedError, type EmailService } from "../../core/email.service";
import { OnboardingFactsService } from "../../core/onboarding-facts.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import { prismaAdapter } from "../../core/prisma-adapter";
import { PrismaService } from "../../core/prisma.service";
import { FunnelEnrollmentService } from "../funnel/funnel-enrollment.service";
import { FunnelStageService } from "../funnel/funnel-stage.service";
import type { SupportInboxService } from "../support/support-inbox.service";
import { FunnelReportService } from "./funnel-report.service";
import { FunnelSendService } from "./funnel-send.service";
import { FunnelTrackingController } from "./funnel-tracking.controller";

/**
 * ‎**מסלול ההמרה שולח — מול מסד אמיתי.**
 *
 * ‏מה שנבדק כאן הוא התנהגות של המסד ולא של הקוד: שהאינדקס הייחודי
 * ‏מונע שליחה שנייה, שהכתיבה ל-`funnel_messages` עוברת דרך
 * ‏`withFunnelAdmin` תחת RLS, ושהלחיצה נרשמת פעם אחת. המייל והמפסק
 * ‏הם תחליפים — כל השאר אמיתי.
 */

for (const [key, value] of Object.entries({
  WEB_ORIGIN: "https://app.example.test",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
})) {
  process.env[key] ??= value;
}

const TENANT = "01M1FNNLSENDTENANT00000001";
const OWNER = "01M1FNNLSENDOWNER000000001";
const STAGE_KEY = "d0_first_action";
/** ‏יום שני 5.10.2026, עשר בבוקר בירושלים — בתוך שעות השליחה */
const MONDAY_10 = new Date("2026-10-05T07:00:00Z");
/** ‏שבת 10.10.2026 באותה שעה — מחוץ לשעות השליחה */
const SATURDAY_10 = new Date("2026-10-10T07:00:00Z");
const HOUR = 60 * 60 * 1000;
/** ‏כתובת הקליטה של תיבת התמיכה — לשם חוזרות תשובות למיילי המסלול */
const SUPPORT_INBOX = "support-inbox@inbound.example.test";
const DAY = 24 * HOUR;

let direct: PrismaClient;
let prisma: PrismaService;
let sendSwitch = "true";
let emailConfigured = true;
const send = vi.fn((..._args: unknown[]) => Promise.resolve());

/**
 * ‎`afterSweep` — מה שקורה בין הכניסה והסגירה לבין השליחה (תשלום, למשל);
 * ‎`recipientsOf` — תחליף לשליפת הנמענים, כשהבדיקה צריכה שהיא תיכשל.
 */
function service(
  afterSweep?: () => Promise<void>,
  recipientsOf?: ActivationNudgeService,
): FunnelSendService {
  const stages = new FunnelStageService(prisma);
  const enrollment = new FunnelEnrollmentService(prisma, stages);
  if (afterSweep !== undefined) {
    const sweep = enrollment.sweep.bind(enrollment);
    enrollment.sweep = async (...args: Parameters<typeof sweep>) => {
      const result = await sweep(...args);
      await afterSweep();
      return result;
    };
  }
  return new FunnelSendService(
    prisma,
    enrollment,
    stages,
    { send, isConfigured: () => Promise.resolve(emailConfigured) } as unknown as EmailService,
    { get: () => Promise.resolve(sendSwitch) } as unknown as PlatformSettingsService,
    recipientsOf ??
      new ActivationNudgeService(
        prisma,
        {} as EmailService,
        {} as PlanCatalogService,
        {} as PlatformSettingsService,
      ),
    new OnboardingFactsService(prisma, {
      isConfigured: () => Promise.resolve(false),
    } as unknown as EmailDomainProviderService),
    {
      outgoing: () => Promise.resolve({ sender: null, replyTo: SUPPORT_INBOX }),
    } as unknown as SupportInboxService,
  );
}

async function messages(): Promise<
  { status: string; channel: string; token: string; openedAt: Date | null; clickedAt: Date | null }[]
> {
  const rows = await direct.$queryRawUnsafe<
    {
      status: string;
      channel: string;
      token: string;
      opened_at: Date | null;
      clicked_at: Date | null;
    }[]
  >(
    `SELECT status, channel, token, opened_at, clicked_at FROM funnel_messages WHERE tenant_id = $1`,
    TENANT,
  );
  return rows.map((r) => ({
    status: r.status,
    channel: r.channel,
    token: r.token,
    openedAt: r.opened_at,
    clickedAt: r.clicked_at,
  }));
}

async function lastSentAt(): Promise<Date | null> {
  const rows = await direct.$queryRawUnsafe<{ last_sent_at: Date | null }[]>(
    `SELECT last_sent_at FROM funnel_enrollments WHERE tenant_id = $1`,
    TENANT,
  );
  return rows[0]?.last_sent_at ?? null;
}

async function cleanup(): Promise<void> {
  await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE tenant_id = $1`, TENANT);
  await direct.$executeRawUnsafe(`DELETE FROM funnel_enrollments WHERE tenant_id = $1`, TENANT);
  await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE tenant_id = $1`, TENANT);
  await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, OWNER);
}

beforeAll(async () => {
  const url = process.env["DIRECT_DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DIRECT_DATABASE_URL חסר — הבדיקה דורשת מסד אמיתי");
  }
  direct = new PrismaClient({ adapter: prismaAdapter(url) });
  // ‏דרך תפקיד האפליקציה — הבעלים עוקף RLS, ואז הבדיקה לא בודקת דבר
  prisma = new PrismaService(process.env["APP_DATABASE_URL"] ?? process.env["DATABASE_URL"]);
});

beforeEach(async () => {
  send.mockClear();
  sendSwitch = "true";
  emailConfigured = true;
  await cleanup();
  await direct.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, plan, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, 'תיווך השרון', 'basic', 'trial', $2, $3, now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, status = 'trial', trial_ends_at = EXCLUDED.trial_ends_at,
           created_at = EXCLUDED.created_at, paid_until = NULL, trial_concluded_at = NULL`,
    TENANT,
    new Date(MONDAY_10.getTime() + 14 * DAY),
    new Date(MONDAY_10.getTime() - HOUR),
  );
  await direct.$executeRawUnsafe(
    `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
     VALUES ($1, $2, 'דנה כהן', 'dana.funnel@example.test', 'owner', true, now(), now())`,
    OWNER,
    TENANT,
  );
  await direct.$executeRawUnsafe(
    `UPDATE funnel_stages SET enabled = (key = $1) WHERE track = 'conversion'`,
    STAGE_KEY,
  );
});

afterAll(async () => {
  if (direct !== undefined) {
    await cleanup();
    await direct.$executeRawUnsafe(`UPDATE funnel_stages SET enabled = false`);
    await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, TENANT);
    await direct.$disconnect();
  }
  if (prisma !== undefined) await prisma.$disconnect();
});

describe("מסלול ההמרה — השליחה", () => {
  it("משרד חדש נכנס ומקבל את שלב יום 0 במייל — פעם אחת", async () => {
    const first = await service().run(MONDAY_10);
    expect(first.enrolled).toBeGreaterThanOrEqual(1);
    expect(first.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject, content] = send.mock.calls[0] as [string, string, { pixel: string }];
    expect(to).toBe("dana.funnel@example.test");
    expect(subject.length).toBeGreaterThan(0);
    const [row] = await messages();
    expect(row).toMatchObject({ status: "sent", channel: "email" });
    expect(row!.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(content.pixel).toBe(`https://app.example.test/api/v1/public/funnel/o/${row!.token}`);
    // ‏„תענו למייל הזה” מגיע לתמיכה, לא לכתובת השולח הכללית
    expect(send.mock.calls[0]![3]).toMatchObject({ replyTo: SUPPORT_INBOX });

    // ‏סבב נוסף באותה שעה: השלב כבר נשלח, והמרווח המזערי עוד לא עבר
    const second = await service().run(new Date(MONDAY_10.getTime() + HOUR));
    expect(second.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await messages()).toHaveLength(1);
  });

  it("מפסק ראשי כבוי — אף משרד לא נכנס ודבר לא נשלח", async () => {
    sendSwitch = "";
    expect(await service().run(MONDAY_10)).toEqual({ enrolled: 0, closed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    const rows = await direct.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM funnel_enrollments WHERE tenant_id = $1`,
      TENANT,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("בשבת המשרד נכנס, אבל ההודעה מחכה לשעות השליחה", async () => {
    const result = await service().run(SATURDAY_10);
    expect(result.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("בעלים שביקש להפסיק את תזכורות ההפעלה אינו מקבל", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO activation_nudge_optouts (id, tenant_id, user_id, token, opted_out_at, created_at)
       VALUES ('01M1FNNLSENDOPTOUT00000001', $1, $2, $3, now(), now())`,
      TENANT,
      OWNER,
      "o".repeat(43),
    );
    expect((await service().run(MONDAY_10)).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("לחיצה נרשמת פעם אחת, גם כפתיחה, ומובילה ליעד של השלב", async () => {
    await service().run(MONDAY_10);
    const [row] = await messages();
    const stage = await direct.funnelStage.findFirstOrThrow({
      where: { track: "conversion", key: STAGE_KEY },
      select: { ctaPath: true },
    });
    const redirect = vi.fn();
    const tracking = new FunnelTrackingController(prisma);
    await tracking.click(row!.token, { redirect } as unknown as Response);
    expect(redirect).toHaveBeenCalledWith(
      302,
      stage.ctaPath ? `https://app.example.test${stage.ctaPath}` : "https://app.example.test",
    );
    const [clicked] = await messages();
    expect(clicked!.clickedAt).not.toBeNull();
    expect(clicked!.openedAt).not.toBeNull();

    // ‏לחיצה שנייה אינה מזיזה את הרגע הראשון
    await tracking.click(row!.token, { redirect } as unknown as Response);
    const [again] = await messages();
    expect(again!.clickedAt?.getTime()).toBe(clicked!.clickedAt?.getTime());
  });

  it("טוקן שאינו קיים — עדיין מוביל למערכת, ולא נרשם דבר", async () => {
    const redirect = vi.fn();
    await new FunnelTrackingController(prisma).click("z".repeat(43), {
      redirect,
    } as unknown as Response);
    expect(redirect).toHaveBeenCalledWith(302, "https://app.example.test");
  });
});

describe("מסלול ההמרה — המסירה והמדדים", () => {
  async function sentMessageId(): Promise<string> {
    await service().run(MONDAY_10);
    const rows = await direct.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    return rows[0]!.id;
  }

  it("מסירה, פתיחה ולחיצה נספרים בשלב — וגם מי שבמסלול", async () => {
    const id = await sentMessageId();
    const report = new FunnelReportService(prisma);
    await report.recordEmailEvent(id, { kind: "delivered", at: MONDAY_10 });
    const [row] = await messages();
    await new FunnelTrackingController(prisma).click(row!.token, {
      redirect: vi.fn(),
    } as unknown as Response);

    const stats = await report.stats();
    const stage = stats.stages.find((s) => s.key === STAGE_KEY)!;
    expect(stage).toMatchObject({ sent: 1, delivered: 1, opened: 1, clicked: 1, bounced: 0 });
    expect(stats.enrollments.live).toBeGreaterThanOrEqual(1);
  });

  it("מייל שחזר — נספר כחוזר, נחשב כשלב שיצא, ואינו נשלח שוב", async () => {
    const id = await sentMessageId();
    const report = new FunnelReportService(prisma);
    await report.recordEmailEvent(id, { kind: "bounced", at: MONDAY_10, detail: "HardBounce" });
    const [row] = await messages();
    expect(row!.status).toBe("bounced");
    const stage = (await report.stats()).stages.find((s) => s.key === STAGE_KEY)!;
    expect(stage).toMatchObject({ sent: 1, bounced: 1, delivered: 0 });

    // ‏יום אחרי: השלב אינו נשלח שוב לאותה כתובת
    send.mockClear();
    await service().run(new Date(MONDAY_10.getTime() + DAY));
    expect(send).not.toHaveBeenCalled();
  });

  it("חזרה שמגיעה אחרי מסירה אינה מבטלת אותה", async () => {
    const id = await sentMessageId();
    const report = new FunnelReportService(prisma);
    await report.recordEmailEvent(id, { kind: "delivered", at: MONDAY_10 });
    await report.recordEmailEvent(id, { kind: "bounced", at: MONDAY_10 });
    const [row] = await messages();
    expect(row!.status).toBe("sent");
  });
});

describe("מסלול ההמרה — תיקוני הביקורת", () => {
  const SECOND = "01M1FNNLSENDOWNER000000002";

  it("בעלים שנכשל אחרי שאחר קיבל — מקבל בניסיון חוזר, והשני אינו מקבל פעמיים", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi.funnel@example.test', 'owner', true, now(), now() + interval '1 second')`,
      SECOND,
      TENANT,
    );
    try {
      // ‏הראשון מקבל, השני נכשל
      send.mockImplementation((...args: unknown[]) =>
        args[0] === "yossi.funnel@example.test"
          ? Promise.reject(new Error("ספק לא זמין"))
          : Promise.resolve(),
      );
      await service().run(MONDAY_10);
      expect((await messages()).map((m) => m.status).sort()).toEqual(["failed", "sent"]);

      // ‏שעה אחרי: רק השני מקבל, ונשלח לו אותו שלב
      send.mockClear();
      send.mockImplementation(() => Promise.resolve());
      await service().run(new Date(MONDAY_10.getTime() + HOUR));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe("yossi.funnel@example.test");
      expect((await messages()).map((m) => m.status)).toEqual(["sent", "sent"]);
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
    }
  });

  it("בעלים שנכשל ואז הושבת — אינו עוצר את המשרד מלהתקדם", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi.funnel@example.test', 'owner', true, now(), now())`,
      SECOND,
      TENANT,
    );
    try {
      send.mockImplementation((...args: unknown[]) =>
        args[0] === "yossi.funnel@example.test"
          ? Promise.reject(new Error("ספק לא זמין"))
          : Promise.resolve(),
      );
      await service().run(MONDAY_10);
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`UPDATE users SET is_active = false WHERE id = $1`, SECOND);
      // ‏שלב יום 1 דלוק גם הוא; יומיים אחרי, הבעלים הפעיל מקבל אותו
      await direct.$executeRawUnsafe(
        `UPDATE funnel_stages SET enabled = true WHERE track = 'conversion' AND key = 'd1_empty_screen'`,
      );
      send.mockClear();
      await service().run(new Date(MONDAY_10.getTime() + DAY + HOUR));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe("dana.funnel@example.test");
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
    }
  });

  it("כל הבעלים ביקשו להפסיק — הרישום נסגר כ„ביקש להפסיק” ונספר במדד", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO activation_nudge_optouts (id, tenant_id, user_id, token, opted_out_at, created_at)
       VALUES ('01M1FNNLSENDOPTOUT00000002', $1, $2, $3, now(), now())`,
      TENANT,
      OWNER,
      "p".repeat(43),
    );
    await service().run(MONDAY_10);
    const rows = await direct.$queryRawUnsafe<{ ended_reason: string | null }[]>(
      `SELECT ended_reason FROM funnel_enrollments WHERE tenant_id = $1`,
      TENANT,
    );
    expect(rows[0]?.ended_reason).toBe("opted_out");
    expect((await new FunnelReportService(prisma).stats()).enrollments.optedOut).toBeGreaterThanOrEqual(1);
  });

  it("מסירה שמאשרת שליחה שנרשמה ככושלת — ההודעה חוזרת ל„נשלחה”", async () => {
    send.mockImplementation(() => Promise.reject(new Error("פסק זמן")));
    try {
      await service().run(MONDAY_10);
    } finally {
      send.mockImplementation(() => Promise.resolve());
    }
    const rows = await direct.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id, status FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    expect(rows[0]?.status).toBe("failed");
    await new FunnelReportService(prisma).recordEmailEvent(rows[0]!.id, {
      kind: "delivered",
      at: MONDAY_10,
    });
    const after = await direct.$queryRawUnsafe<{ status: string; sent_at: Date | null }[]>(
      `SELECT status, sent_at FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    expect(after[0]).toMatchObject({ status: "sent" });
    expect(after[0]!.sent_at).not.toBeNull();
    // ‏והמרווח עד ההודעה הבאה נמדד ממנה
    expect(await lastSentAt()).toEqual(MONDAY_10);
  });
});

describe("סגירת רישום כש„מוצה” — רק אחרי שהנמען שנכשל קיבל הזדמנות", () => {
  const SECOND = "01M1FNNLSENDOWNER000000003";
  const ENROLLMENT = "01M1FNNLSENDENROLL00000001";

  /*
   * ‏כל השלבים פגו מלבד „שבוע אחרי” (שעון הניסיון): המשפך התחיל לפני
   * ‏חודש, והניסיון נגמר לפני שבוע ושעה.
   */
  /** ‏`pending` — סטטוס השורה של הבעלים השני, שעוד ממתין לניסיון חוזר. */
  async function seed(pending: "queued" | "failed" | "rejected" | "bounced" | null): Promise<void> {
    const now = Date.now();
    await direct.$executeRawUnsafe(
      `UPDATE tenants SET trial_ends_at = $2, created_at = $3 WHERE id = $1`,
      TENANT,
      new Date(now - 7 * DAY - HOUR),
      new Date(now - 40 * DAY),
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi3.funnel@example.test', 'owner', true, now(), now())`,
      SECOND,
      TENANT,
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO funnel_enrollments (id, tenant_id, track, started_at, created_at, updated_at)
       VALUES ($1, $2, 'conversion', $3, now(), now())`,
      ENROLLMENT,
      TENANT,
      new Date(now - 30 * DAY),
    );
    const message = (id: string, user: string, status: string, token: string): Promise<number> =>
      direct.$executeRawUnsafe(
        `INSERT INTO funnel_messages
           (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel, status, token, sent_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'conversion', 'trial_last_call', $4, 'x@example.test', 'email', $5, $6, $7, now(), now())`,
        id,
        TENANT,
        ENROLLMENT,
        user,
        status,
        token,
        status === "sent" || status === "bounced" ? new Date(now - HOUR) : null,
      );
    await message("01M1FNNLSENDMSGSENT0000001", OWNER, "sent", "a".repeat(43));
    if (pending !== null) await message("01M1FNNLSENDMSGFAIL0000001", SECOND, pending, "b".repeat(43));
  }

  async function reason(): Promise<string | null> {
    const rows = await direct.$queryRawUnsafe<{ ended_reason: string | null }[]>(
      `SELECT ended_reason FROM funnel_enrollments WHERE id = $1`,
      ENROLLMENT,
    );
    return rows[0]?.ended_reason ?? null;
  }

  async function sweep(): Promise<void> {
    const stages = new FunnelStageService(prisma);
    await new FunnelEnrollmentService(prisma, stages).sweep(new Date());
  }

  afterEach(async () => {
    await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE enrollment_id = $1`, ENROLLMENT);
    await direct.$executeRawUnsafe(`DELETE FROM funnel_enrollments WHERE id = $1`, ENROLLMENT);
    await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
  });

  it("נמען שנכשל בשלב האחרון — הרישום נשאר פתוח לניסיון החוזר", async () => {
    await seed("failed");
    await sweep();
    expect(await reason()).toBeNull();
  });

  it("נמען שנדחה לצמיתות בשלב האחרון — גם הוא ממתין לניסיון החוזר", async () => {
    await seed("rejected");
    await sweep();
    expect(await reason()).toBeNull();
  });

  it("נמען שנתפס ועוד לא הוכרע בשלב האחרון — הרישום אינו נסגר", async () => {
    await seed("queued");
    await sweep();
    expect(await reason()).toBeNull();
  });

  it("נמען שהמייל שלו חזר בשלב האחרון — ממתין עד שחלון השלב נסגר", async () => {
    await seed("bounced");
    await sweep();
    expect(await reason()).toBeNull();
  });

  it("בלי נמען שנכשל — אותו מצב נסגר כ„סיים את הרצף”", async () => {
    await seed(null);
    await sweep();
    expect(await reason()).toBe("completed");
  });

  it("כל הבעלים הסירו את עצמם אחרי השלב האחרון — „ביקש להפסיק”, ולא „סיים את הרצף”", async () => {
    await seed(null);
    try {
      await direct.$executeRawUnsafe(
        `INSERT INTO activation_nudge_optouts (id, tenant_id, user_id, token, opted_out_at, created_at)
         VALUES ('01M1FNNLSENDOPTOUT00000003', $1, $2, $3, now(), now()),
                ('01M1FNNLSENDOPTOUT00000004', $1, $4, $5, now(), now())`,
        TENANT,
        OWNER,
        "q".repeat(43),
        SECOND,
        "r".repeat(43),
      );
      await service().run(new Date());
      expect(await reason()).toBe("opted_out");
    } finally {
      await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE tenant_id = $1`, TENANT);
    }
  });
});

describe("מסלול ההמרה — שליחה שנקטעה, הסרה בין שלבים ו-Webhook שהקדים", () => {
  async function messageRow(): Promise<{ id: string; status: string }> {
    const rows = await direct.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id, status FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    return rows[0]!;
  }

  it("תפיסה שננטשה באמצע — נשלחת בסבב הבא, עם אותו מפתח אידמפוטנטיות", async () => {
    await service().run(MONDAY_10);
    const { id } = await messageRow();
    // ‏התהליך נפל אחרי התפיסה: השורה בתור, ושום דבר לא הוכרע
    await direct.$executeRawUnsafe(
      `UPDATE funnel_messages SET status = 'queued', sent_at = NULL, updated_at = $2 WHERE id = $1`,
      id,
      MONDAY_10,
    );
    await direct.$executeRawUnsafe(
      `UPDATE funnel_enrollments SET last_sent_at = NULL WHERE tenant_id = $1`,
      TENANT,
    );
    send.mockClear();
    await service().run(new Date(MONDAY_10.getTime() + HOUR));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![3]).toMatchObject({
      idempotency: { key: expect.stringMatching(new RegExp(`^funnel:${id}:[0-9a-f]+$`, "u")) },
    });
    expect((await messageRow()).status).toBe("sent");
  });

  it("הבעלים הסיר את עצמו אחרי שלב, והבא עוד רחוק — הרישום נסגר כ„ביקש להפסיק”", async () => {
    await direct.$executeRawUnsafe(
      `UPDATE funnel_stages SET enabled = true WHERE track = 'conversion' AND key = 'd1_empty_screen'`,
    );
    await service().run(MONDAY_10);
    await direct.$executeRawUnsafe(
      `UPDATE activation_nudge_optouts SET opted_out_at = now() WHERE user_id = $1`,
      OWNER,
    );
    await service().run(new Date(MONDAY_10.getTime() + 2 * HOUR));
    const rows = await direct.$queryRawUnsafe<{ ended_reason: string | null }[]>(
      `SELECT ended_reason FROM funnel_enrollments WHERE tenant_id = $1`,
      TENANT,
    );
    expect(rows[0]?.ended_reason).toBe("opted_out");
  });

  /** ‏הספק מדווח דרך ה-Webhook עוד לפני שהשליחה חזרה אלינו. */
  function webhookFirst(
    kind: "delivered" | "bounced",
    then: () => Promise<void>,
  ): (...args: unknown[]) => Promise<void> {
    return async (...args: unknown[]) => {
      const { key } = (args[3] as { idempotency: { key: string } }).idempotency;
      const parsed = parseFunnelIdempotencyKey(key)!;
      await new FunnelReportService(prisma).recordEmailEvent(parsed.messageId, {
        kind,
        at: MONDAY_10,
        detail: "HardBounce",
        destinationTag: parsed.destinationTag,
      });
      await then();
    };
  }

  it("חזרה מהירה ואז „התקבל” מהספק — נשארת חוזרת", async () => {
    send.mockImplementation(webhookFirst("bounced", () => Promise.resolve()));
    try {
      await service().run(MONDAY_10);
    } finally {
      send.mockImplementation(() => Promise.resolve());
    }
    expect((await messageRow()).status).toBe("bounced");
  });

  it("מסירה מאושרת ואז פסק זמן — נשארת נשלחה, נספרת, ואינה נשלחת שוב", async () => {
    send.mockImplementation(webhookFirst("delivered", () => Promise.reject(new Error("פסק זמן"))));
    let result: { sent: number };
    try {
      result = await service().run(MONDAY_10);
    } finally {
      send.mockImplementation(() => Promise.resolve());
    }
    expect((await messageRow()).status).toBe("sent");
    // ‏נספרה בתקרה, והמרווח עד ההודעה הבאה נמדד ממנה
    expect(result.sent).toBe(1);
    expect(await lastSentAt()).toEqual(MONDAY_10);
    send.mockClear();
    await service().run(new Date(MONDAY_10.getTime() + DAY));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("הדלקת שלב ועריכת נוסח שרצות יחד", () => {
  it("העריכה שמרוקנת את הגוף מחזיקה את השורה — ההדלקה ממתינה, רואה גוף ריק ונדחית", async () => {
    const stage = await direct.funnelStage.findFirstOrThrow({
      where: { track: "conversion", key: "d1_empty_screen" },
      select: { id: true, emailBody: true },
    });
    const holder = new PrismaClient({ adapter: prismaAdapter(process.env["DIRECT_DATABASE_URL"]) });
    try {
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      // ‏„העריכה” — נועלת, ממתינה, מרוקנת את הגוף ומתחייבת
      const editing = holder.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM funnel_stages WHERE id = $1 FOR UPDATE`, stage.id);
        await held;
        await tx.$executeRawUnsafe(`UPDATE funnel_stages SET email_body = NULL WHERE id = $1`, stage.id);
      });
      await new Promise((r) => setTimeout(r, 100));

      const enabling = new FunnelStageService(prisma).setEnabled(stage.id, true);
      const outcome = enabling.then(
        () => "enabled",
        (error: unknown) => (error instanceof Error ? error.constructor.name : "error"),
      );
      await new Promise((r) => setTimeout(r, 100));
      release!();
      await editing;

      expect(await outcome).toBe("BadRequestException");
      const after = await direct.funnelStage.findUniqueOrThrow({
        where: { id: stage.id },
        select: { enabled: true },
      });
      expect(after.enabled).toBe(false);
    } finally {
      await holder.$disconnect();
      await direct.funnelStage.update({
        where: { id: stage.id },
        data: { emailBody: stage.emailBody, enabled: false },
      });
    }
  });
});

describe("מסלול ההמרה — תקרה, תשלום באמצע הסבב ולחיצה בתקלה", () => {
  const OTHER = "01M1FNNLSENDTENANT00000002";
  const OTHER_OWNER = "01M1FNNLSENDOWNER000000004";

  it("שליחות שנגמרו בפסק זמן נספרות בתקרה — הסבב נעצר גם כשאף אחת לא „נמסרה”", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, plan, status, trial_ends_at, created_at, updated_at)
       VALUES ($1, 'תיווך הגליל', 'basic', 'trial', $2, $3, now())`,
      OTHER,
      new Date(MONDAY_10.getTime() + 14 * DAY),
      new Date(MONDAY_10.getTime() - HOUR),
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'רון אבי', 'ron.funnel@example.test', 'owner', true, now(), now())`,
      OTHER_OWNER,
      OTHER,
    );
    send.mockImplementation(() => Promise.reject(new Error("פסק זמן")));
    try {
      await service().run(MONDAY_10, { maxTenants: 1 });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE tenant_id = $1`, OTHER);
      await direct.$executeRawUnsafe(`DELETE FROM funnel_enrollments WHERE tenant_id = $1`, OTHER);
      await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE tenant_id = $1`, OTHER);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, OTHER_OWNER);
      await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, OTHER);
    }
  });

  it("משרד שהטיפול בו נזרק — נספר בתקרה, כי ייתכן שהמייל כבר יצא", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, plan, status, trial_ends_at, created_at, updated_at)
       VALUES ($1, 'תיווך הגליל', 'basic', 'trial', $2, $3, now())`,
      OTHER,
      new Date(MONDAY_10.getTime() + 14 * DAY),
      new Date(MONDAY_10.getTime() - HOUR),
    );
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'רון אבי', 'ron.funnel@example.test', 'owner', true, now(), now())`,
      OTHER_OWNER,
      OTHER,
    );
    const recipients = vi.fn(() => Promise.reject(new Error("המסד לא זמין")));
    try {
      await service(undefined, {
        recipients,
        allOptedOut: () => Promise.resolve(false),
      } as unknown as ActivationNudgeService).run(MONDAY_10, { maxTenants: 1 });
      expect(recipients).toHaveBeenCalledTimes(1);
    } finally {
      await direct.$executeRawUnsafe(`DELETE FROM funnel_enrollments WHERE tenant_id = $1`, OTHER);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, OTHER_OWNER);
      await direct.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, OTHER);
    }
  });

  it("משרד ששילם אחרי שהדף נשלף ולפני תורו — אינו מקבל את ההודעה", async () => {
    const real = new ActivationNudgeService(
      prisma,
      {} as EmailService,
      {} as PlanCatalogService,
      {} as PlatformSettingsService,
    );
    // ‏התשלום נכנס ברגע שהסבב כבר מטפל במשרד — אחרי שהדף נשלף
    const paying = {
      recipients: async (tenantId: string) => {
        await direct.$executeRawUnsafe(
          `UPDATE tenants SET status = 'active', paid_until = $2 WHERE id = $1`,
          TENANT,
          new Date(MONDAY_10.getTime() + 30 * DAY),
        );
        return real.recipients(tenantId);
      },
      allOptedOut: (tenantId: string) => real.allOptedOut(tenantId),
    } as unknown as ActivationNudgeService;
    await service(undefined, paying).run(MONDAY_10);
    expect(send).not.toHaveBeenCalled();
  });

  it("משרד שהושהה אחרי שהדף נשלף ולפני תורו — אינו מקבל את ההודעה", async () => {
    const real = new ActivationNudgeService(
      prisma,
      {} as EmailService,
      {} as PlanCatalogService,
      {} as PlatformSettingsService,
    );
    const suspending = {
      recipients: async (tenantId: string) => {
        await direct.$executeRawUnsafe(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, TENANT);
        return real.recipients(tenantId);
      },
      allOptedOut: (tenantId: string) => real.allOptedOut(tenantId),
    } as unknown as ActivationNudgeService;
    await service(undefined, suspending).run(MONDAY_10);
    expect(send).not.toHaveBeenCalled();
  });

  it("דחייה קבועה — לא בסבב הבא; אחרי יממה או כשהכתובת השתנתה — כן; חריגה מקצב — בסבב הבא", async () => {
    send.mockImplementation(() => Promise.reject(new EmailRejectedError("נמען פסול", false)));
    try {
      await service().run(MONDAY_10);
      expect((await messages())[0]!.status).toBe("rejected");
      send.mockClear();
      await service().run(new Date(MONDAY_10.getTime() + HOUR));
      expect(send).not.toHaveBeenCalled();

      // ‏הכתובת תוקנה — נשלח מיד, לכתובת החדשה
      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'dana.fixed@example.test' WHERE id = $1`,
        OWNER,
      );
      send.mockImplementation(() => Promise.resolve());
      await service().run(new Date(MONDAY_10.getTime() + 2 * HOUR));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe("dana.fixed@example.test");

      // ‏ושוב נדחה, והכתובת לא השתנתה — רק אחרי יממה (למשל: הגדרת הספק תוקנה)
      await direct.$executeRawUnsafe(
        `UPDATE funnel_messages SET status = 'rejected', sent_at = NULL, updated_at = $2 WHERE tenant_id = $1`,
        TENANT,
        MONDAY_10,
      );
      await direct.$executeRawUnsafe(
        `UPDATE funnel_enrollments SET last_sent_at = NULL WHERE tenant_id = $1`,
        TENANT,
      );
      send.mockClear();
      await service().run(new Date(MONDAY_10.getTime() + DAY + HOUR));
      expect(send).toHaveBeenCalledTimes(1);

      // ‏חריגה מקצב — נשארת „נכשלה” ונשלחת שוב בסבב הבא
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE tenant_id = $1`, TENANT);
      await direct.$executeRawUnsafe(
        `UPDATE funnel_enrollments SET last_sent_at = NULL WHERE tenant_id = $1`,
        TENANT,
      );
      send.mockImplementation(() => Promise.reject(new EmailRejectedError("האטו", true)));
      await service().run(new Date(MONDAY_10.getTime() + 2 * HOUR));
      expect((await messages())[0]!.status).toBe("failed");
      send.mockClear();
      send.mockImplementation(() => Promise.resolve());
      await service().run(new Date(MONDAY_10.getTime() + 3 * HOUR));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'dana.funnel@example.test' WHERE id = $1`,
        OWNER,
      );
    }
  });

  it("בעלים שנדחה אחרי שאחר קיבל, וכתובתו תוקנה — מקבל את אותו שלב מיד", async () => {
    const SECOND = "01M1FNNLSENDOWNER000000006";
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi6.bad@example.test', 'owner', true, now(), now() + interval '1 second')`,
      SECOND,
      TENANT,
    );
    try {
      send.mockImplementation((...args: unknown[]) =>
        args[0] === "yossi6.bad@example.test"
          ? Promise.reject(new EmailRejectedError("נמען פסול", false))
          : Promise.resolve(),
      );
      await service().run(MONDAY_10);
      expect((await messages()).map((m) => m.status).sort()).toEqual(["rejected", "sent"]);

      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'yossi6.fixed@example.test' WHERE id = $1`,
        SECOND,
      );
      send.mockClear();
      send.mockImplementation(() => Promise.resolve());
      await service().run(new Date(MONDAY_10.getTime() + HOUR));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe("yossi6.fixed@example.test");
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
    }
  });

  it("דיווח מאוחר על הכתובת הישנה — אינו נוגע בשליחה לכתובת שתוקנה", async () => {
    await service().run(MONDAY_10);
    const oldKey = (send.mock.calls[0]![3] as { idempotency: { key: string } }).idempotency.key;
    const rows = await direct.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    const report = new FunnelReportService(prisma);
    await report.recordEmailEvent(rows[0]!.id, { kind: "bounced", at: MONDAY_10 });
    await direct.$executeRawUnsafe(
      `UPDATE users SET email = 'dana.fixed4@example.test' WHERE id = $1`,
      OWNER,
    );
    try {
      send.mockClear();
      await service().run(new Date(MONDAY_10.getTime() + HOUR));
      expect((await messages())[0]!.status).toBe("sent");
      // ‏חזרה מאוחרת נוספת של הכתובת הישנה — השליחה החדשה נשארת „נשלחה”
      const old = parseFunnelIdempotencyKey(oldKey)!;
      await report.recordEmailEvent(old.messageId, {
        kind: "bounced",
        at: new Date(MONDAY_10.getTime() + HOUR),
        destinationTag: old.destinationTag,
      });
      expect((await messages())[0]!.status).toBe("sent");
    } finally {
      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'dana.funnel@example.test' WHERE id = $1`,
        OWNER,
      );
    }
  });

  it("כמה שלבים ממתינים לאותו בעלים — רק המוקדם נשלח בסבב", async () => {
    const SECOND = "01M1FNNLSENDOWNER000000007";
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi7.funnel@example.test', 'owner', true, now(), now() + interval '1 second')`,
      SECOND,
      TENANT,
    );
    await direct.$executeRawUnsafe(
      `UPDATE funnel_stages SET enabled = true WHERE track = 'conversion' AND key = 'd1_empty_screen'`,
    );
    try {
      // ‏הראשון קיבל את שני השלבים; אצל השני שניהם נכשלו
      send.mockImplementation((...args: unknown[]) =>
        args[0] === "yossi7.funnel@example.test"
          ? Promise.reject(new Error("ספק לא זמין"))
          : Promise.resolve(),
      );
      await service().run(MONDAY_10);
      // ‏גם שלב יום 1 יצא לראשון ונכשל אצל השני (כל שלב פתוח שבוע — שניהם פתוחים)
      const [enrollment] = await direct.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM funnel_enrollments WHERE tenant_id = $1`,
        TENANT,
      );
      const d1 = (id: string, user: string, status: string, token: string): Promise<number> =>
        direct.$executeRawUnsafe(
          `INSERT INTO funnel_messages
             (id, tenant_id, enrollment_id, track, stage_key, user_id, destination, channel, status, token, sent_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'conversion', 'd1_empty_screen', $4, 'x@example.test', 'email', $5, $6, $7, now(), now())`,
          id,
          TENANT,
          enrollment!.id,
          user,
          status,
          token,
          status === "sent" ? new Date(MONDAY_10.getTime() + DAY) : null,
        );
      await d1("01M1FNNLSENDMSGD1SENT00001", OWNER, "sent", "c".repeat(43));
      await d1("01M1FNNLSENDMSGD1FAIL00001", SECOND, "failed", "d".repeat(43));

      send.mockClear();
      send.mockImplementation(() => Promise.resolve());
      await service().run(new Date(MONDAY_10.getTime() + DAY + 2 * HOUR));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
    }
  });

  it("ניסיון חדש אחרי חזרה מתחיל נקי — בלי רגע השליחה של הניסיון שחזר", async () => {
    await service().run(MONDAY_10);
    const rows = await direct.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    await new FunnelReportService(prisma).recordEmailEvent(rows[0]!.id, {
      kind: "bounced",
      at: MONDAY_10,
    });
    await direct.$executeRawUnsafe(
      `UPDATE users SET email = 'dana.fixed3@example.test' WHERE id = $1`,
      OWNER,
    );
    send.mockImplementation(() => Promise.reject(new Error("פסק זמן")));
    try {
      await service().run(new Date(MONDAY_10.getTime() + HOUR));
      const after = await direct.$queryRawUnsafe<{ status: string; sent_at: Date | null }[]>(
        `SELECT status, sent_at FROM funnel_messages WHERE tenant_id = $1`,
        TENANT,
      );
      expect(after[0]).toMatchObject({ status: "failed", sent_at: null });
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'dana.funnel@example.test' WHERE id = $1`,
        OWNER,
      );
    }
  });

  it("בלי ספק אימייל מחובר — הסבב אינו רץ: אין שליחה, אין שורות ואין כניסה", async () => {
    emailConfigured = false;
    expect(await service().run(MONDAY_10)).toEqual({ enrolled: 0, closed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await messages()).toHaveLength(0);
    const rows = await direct.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM funnel_enrollments WHERE tenant_id = $1`,
      TENANT,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("מייל שחזר, והכתובת תוקנה — אותו שלב נשלח לכתובת החדשה, במפתח חדש", async () => {
    await service().run(MONDAY_10);
    const firstKey = (send.mock.calls[0]![3] as { idempotency: { key: string } }).idempotency.key;
    const oldToken = (await messages())[0]!.token;
    const rows = await direct.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM funnel_messages WHERE tenant_id = $1`,
      TENANT,
    );
    await new FunnelReportService(prisma).recordEmailEvent(rows[0]!.id, {
      kind: "bounced",
      at: MONDAY_10,
      detail: "HardBounce",
    });
    // ‏אותה כתובת — אינו נשלח שוב
    send.mockClear();
    await service().run(new Date(MONDAY_10.getTime() + HOUR));
    expect(send).not.toHaveBeenCalled();

    await direct.$executeRawUnsafe(
      `UPDATE users SET email = 'dana.fixed2@example.test' WHERE id = $1`,
      OWNER,
    );
    try {
      await service().run(new Date(MONDAY_10.getTime() + 2 * HOUR));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe("dana.fixed2@example.test");
      const key = (send.mock.calls[0]![3] as { idempotency: { key: string } }).idempotency.key;
      expect(key).not.toBe(firstKey);
      // ‏וטוקן מעקב חדש — הקישורים במייל הישן אינם מאשרים את השליחה החדשה
      const [after] = await messages();
      expect(after!.token).not.toBe(oldToken);
      expect((await messages())[0]!.status).toBe("sent");
    } finally {
      await direct.$executeRawUnsafe(
        `UPDATE users SET email = 'dana.funnel@example.test' WHERE id = $1`,
        OWNER,
      );
    }
  });

  it("משרד ששילם אחרי הסגירה של הסבב — אינו מקבל את ההודעה", async () => {
    await service(async () => {
      await direct.$executeRawUnsafe(
        `UPDATE tenants SET status = 'active', paid_until = $2 WHERE id = $1`,
        TENANT,
        new Date(MONDAY_10.getTime() + 30 * DAY),
      );
    }).run(MONDAY_10);
    expect(send).not.toHaveBeenCalled();
  });

  it("תקלה במסד — הלחיצה עדיין מובילה למערכת, והפיקסל עדיין נטען", async () => {
    const broken = new FunnelTrackingController({
      withFunnelAdmin: () => Promise.reject(new Error("המסד לא זמין")),
    } as unknown as PrismaService);
    const redirect = vi.fn();
    await broken.click("a".repeat(43), { redirect } as unknown as Response);
    expect(redirect).toHaveBeenCalledWith(302, "https://app.example.test");
    const end = vi.fn();
    await broken.open("a".repeat(43), { setHeader: vi.fn(), end } as unknown as Response);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("מסלול ההמרה — הוכחה מהנמען, ותפיסה לפני שליחה", () => {
  const SECOND = "01M1FNNLSENDOWNER000000005";

  it("לחיצה על הודעה שנרשמה ככושלת — היא נשלחה, והשלב אינו נשלח שוב", async () => {
    send.mockImplementation(() => Promise.reject(new Error("פסק זמן")));
    try {
      await service().run(MONDAY_10);
    } finally {
      send.mockImplementation(() => Promise.resolve());
    }
    const [row] = await messages();
    expect(row!.status).toBe("failed");
    await new FunnelTrackingController(prisma).click(row!.token, {
      redirect: vi.fn(),
    } as unknown as Response);
    const [after] = await messages();
    expect(after!.status).toBe("sent");
    expect(await lastSentAt()).not.toBeNull();
    send.mockClear();
    await service().run(new Date(MONDAY_10.getTime() + HOUR));
    expect(send).not.toHaveBeenCalled();
  });

  it("פתיחה (הפיקסל) — אותה הוכחה", async () => {
    send.mockImplementation(() => Promise.reject(new Error("פסק זמן")));
    try {
      await service().run(MONDAY_10);
    } finally {
      send.mockImplementation(() => Promise.resolve());
    }
    const [row] = await messages();
    await new FunnelTrackingController(prisma).open(row!.token, {
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as Response);
    expect((await messages())[0]!.status).toBe("sent");
  });

  it("כל הנמענים נתפסים לפני שהראשון מקבל — נפילה באמצע אינה משאירה נמען בלי שורה", async () => {
    await direct.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, name, email, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'יוסי לוי', 'yossi5.funnel@example.test', 'owner', true, now(), now() + interval '1 second')`,
      SECOND,
      TENANT,
    );
    const rowsAtFirstSend: number[] = [];
    send.mockImplementation(async () => {
      const rows = await direct.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM funnel_messages WHERE tenant_id = $1`,
        TENANT,
      );
      rowsAtFirstSend.push(Number(rows[0]!.n));
    });
    try {
      await service().run(MONDAY_10);
      expect(send).toHaveBeenCalledTimes(2);
      expect(rowsAtFirstSend[0]).toBe(2);
    } finally {
      send.mockImplementation(() => Promise.resolve());
      await direct.$executeRawUnsafe(`DELETE FROM funnel_messages WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM activation_nudge_optouts WHERE user_id = $1`, SECOND);
      await direct.$executeRawUnsafe(`DELETE FROM users WHERE id = $1`, SECOND);
    }
  });
});
