import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { EmailInboxService } from "../email-inbox/email-inbox.service";
import type { FunnelReportService } from "../funnel-send/funnel-report.service";
import type { SupportInboxService } from "../support/support-inbox.service";
import { InboundMailController } from "./inbound-mail.controller";
import type { InboundMailService } from "./inbound-mail.service";

/**
 * ‎**אירועי המסירה של Postmark — רק בסוד הנכון, ורק להודעות המסלול.**
 */

const SECRET = "s".repeat(24);
const MESSAGE = "01M1FNNLSENDMESSAGE0000001";

function setup() {
  const recordEmailEvent = vi.fn(() => Promise.resolve());
  const controller = new InboundMailController(
    {} as InboundMailService,
    {} as SupportInboxService,
    {
      inboundConfig: () => Promise.resolve({ address: "in@example.test", secret: SECRET }),
    } as unknown as EmailInboxService,
    { recordEmailEvent } as unknown as FunnelReportService,
  );
  return { controller, recordEmailEvent };
}

describe("Webhook המסירה", () => {
  it("Delivery של הודעת מסלול — נרשם עם הרגע שהספק דיווח", async () => {
    const { controller, recordEmailEvent } = setup();
    await controller.events(SECRET, {
      RecordType: "Delivery",
      DeliveredAt: "2026-10-05T07:01:00Z",
      Metadata: { idem: `funnel:${MESSAGE}` },
    });
    expect(recordEmailEvent).toHaveBeenCalledWith(MESSAGE, {
      kind: "delivered",
      at: new Date("2026-10-05T07:01:00Z"),
    });
  });

  it("Bounce — נרשם עם הסוג והתיאור", async () => {
    const { controller, recordEmailEvent } = setup();
    await controller.events(SECRET, {
      RecordType: "Bounce",
      Type: "HardBounce",
      Description: "The server was unable to deliver your message",
      Metadata: { idem: `funnel:${MESSAGE}` },
    });
    expect(recordEmailEvent).toHaveBeenCalledWith(
      MESSAGE,
      expect.objectContaining({ kind: "bounced", detail: expect.stringContaining("HardBounce") }),
    );
  });

  it("אירוע של מייל אחר, או צורה לא מוכרת — 200 ובלי רישום", async () => {
    const { controller, recordEmailEvent } = setup();
    expect(
      await controller.events(SECRET, { RecordType: "Delivery", Metadata: { idem: "offer:1" } }),
    ).toEqual({ ok: true });
    expect(await controller.events(SECRET, "junk")).toEqual({ ok: true });
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("סוד שגוי — 404, כאילו הנתיב אינו קיים", async () => {
    const { controller, recordEmailEvent } = setup();
    await expect(
      controller.events("x".repeat(24), { RecordType: "Delivery", Metadata: { idem: `funnel:${MESSAGE}` } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });
});
