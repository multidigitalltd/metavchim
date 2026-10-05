import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import type { EmailService } from "../../core/email.service";
import type { PlatformSettingsService } from "../../core/platform-settings.service";
import type { PrismaService } from "../../core/prisma.service";
import type { FunnelStageCopy, FunnelStageService } from "../funnel/funnel-stage.service";
import type { FunnelReportService } from "../funnel-send/funnel-report.service";
import { FunnelCopyController } from "./funnel-copy.controller";

/**
 * ‎**„שלח אליי לבדיקה” — רק לתיבה של מי שלחץ.**
 *
 * ‏הנמען אינו פרמטר של הבקשה: הכתובת נשלפת מהמשתמש המחובר. כך גם
 * ‏טעות במסך לא יכולה לשלוח שלב למשרד, וגם אין שורה ב-`funnel_messages`.
 */

for (const [key, value] of Object.entries({
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
})) {
  process.env[key] = value;
}

const STAGE: FunnelStageCopy = {
  id: "01STAGEAAAAAAAAAAAAAAAAAAA",
  track: "conversion",
  key: "first_property",
  title: "נכס ראשון",
  enabled: false,
  emailSubject: "{{שם_פרטי}}, הנכס הראשון",
  emailHeading: "",
  emailBody: "שלום {{שם_פרטי}} מ{{שם_המשרד}}",
  ctaLabel: "להוספה",
  ctaPath: "/properties/new",
  whatsappTemplate: "",
  unknownPlaceholders: [],
  enableBlock: null,
};

function setup(stage: FunnelStageCopy | null = STAGE) {
  const send = vi.fn(() => Promise.resolve());
  const findUnique = vi.fn(() =>
    Promise.resolve({ email: "owner@example.test", name: "דנה כהן", tenant: { name: "תיווך השרון" } }),
  );
  const controller = new FunnelCopyController(
    { copy: vi.fn(() => Promise.resolve(stage)) } as unknown as FunnelStageService,
    { user: { findUnique } } as unknown as PrismaService,
    { send, isConfigured: vi.fn(() => Promise.resolve(true)) } as unknown as EmailService,
    {} as PlatformSettingsService,
    {} as FunnelReportService,
  );
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run(
      { tenantId: "01TENANTAAAAAAAAAAAAAAAAAA", userId: "01USERAAAAAAAAAAAAAAAAAAAA" } as never,
      fn,
    );
  return { controller, send, findUnique, run };
}

describe("שליחת בדיקה של שלב", () => {
  it("נשלח לכתובת של המשתמש המחובר, עם השם והמשרד שלו ותג בדיקה", async () => {
    const { controller, send, findUnique, run } = setup();
    expect(await run(() => controller.test(STAGE.id))).toEqual({ sentTo: "owner@example.test" });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "01USERAAAAAAAAAAAAAAAAAAAA" } }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject, content] = send.mock.calls[0] as unknown as [
      string,
      string,
      { paragraphs: string[]; button: { url: string }; footnote: string },
    ];
    expect(to).toBe("owner@example.test");
    expect(subject).toBe("[בדיקה] דנה, הנכס הראשון");
    expect(content.paragraphs).toEqual(["שלום דנה מתיווך השרון"]);
    expect(content.button.url).toBe("https://app.example.test/properties/new");
    expect(content.footnote).toContain("נשלחה רק אליך");
  });

  it("שלב שאינו קיים — 404, בלי שליחה", async () => {
    const { controller, send, run } = setup(null);
    await expect(run(() => controller.test(STAGE.id))).rejects.toBeInstanceOf(NotFoundException);
    expect(send).not.toHaveBeenCalled();
  });

  it("בלי נוסח מייל, או עם מציין מקום שלא יוחלף — נדחה, בלי שליחה", async () => {
    for (const stage of [
      { ...STAGE, emailBody: "" },
      { ...STAGE, unknownPlaceholders: ["שם_הסוכן"] },
    ]) {
      const { controller, send, run } = setup(stage);
      await expect(run(() => controller.test(STAGE.id))).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    }
  });
});
