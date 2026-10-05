import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { ActivationNudgeService } from "../../core/activation-nudge.service";
import type { EmailDomainProviderService } from "../../core/email-domain-provider.service";
import type { EmailService } from "../../core/email.service";
import { OnboardingFactsService } from "../../core/onboarding-facts.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import { prismaAdapter } from "../../core/prisma-adapter";
import { PrismaService } from "../../core/prisma.service";
import { FunnelEnrollmentService } from "../funnel/funnel-enrollment.service";
import { FunnelStageService } from "../funnel/funnel-stage.service";
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
const DAY = 24 * HOUR;

let direct: PrismaClient;
let prisma: PrismaService;
let sendSwitch = "true";
const send = vi.fn((..._args: unknown[]) => Promise.resolve());

function service(): FunnelSendService {
  const stages = new FunnelStageService(prisma);
  return new FunnelSendService(
    prisma,
    new FunnelEnrollmentService(prisma, stages),
    stages,
    { send } as unknown as EmailService,
    { get: () => Promise.resolve(sendSwitch) } as unknown as PlatformSettingsService,
    new ActivationNudgeService(
      prisma,
      {} as EmailService,
      {} as PlanCatalogService,
      {} as PlatformSettingsService,
    ),
    new OnboardingFactsService(prisma, {
      isConfigured: () => Promise.resolve(false),
    } as unknown as EmailDomainProviderService),
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
