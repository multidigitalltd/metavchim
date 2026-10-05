import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import type { PrismaService } from "../../core/prisma.service";
import { ViewingFeedbackService } from "./viewing-feedback.service";

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const USER = "01USERAAAAAAAAAAAAAAAAAAAA";
const APPT = "01APPTAAAAAAAAAAAAAAAAAAAA";

/**
 * המשוב נכתב משני מסלולים (טופס, וואטסאפ) דרך אותה כתיבה. הבדיקה
 * מחזיקה את הכלל במקום אחד: רק לסיור, רק מהרשימה, והשאלה הבאה
 * לפי מה שחסר.
 */
describe("ViewingFeedbackService.apply", () => {
  it("פגישה שאינה סיור דוחה משוב; ערך מחוץ לרשימה נדחה; שדה שלא נשלח אינו נכתב", () => {
    expect(() => ViewingFeedbackService.apply({ feedbackPrice: "high" }, { kind: "meeting" })).toThrow(BadRequestException);
    expect(() => ViewingFeedbackService.apply({ feedbackPrice: "cheap" }, { kind: "viewing" })).toThrow(BadRequestException);
    expect(ViewingFeedbackService.apply({}, { kind: "meeting" })).toEqual({});
    expect(ViewingFeedbackService.apply({ feedbackFit: "layout", feedbackPrice: null }, { kind: "viewing" })).toEqual({
      feedbackFit: "layout",
      feedbackPrice: null,
    });
  });
});

describe("ViewingFeedbackService.record — תשובה מכפתור", () => {
  function harness(row: Record<string, unknown> | null) {
    const state = { ...(row ?? {}) };
    const audit = { record: vi.fn(async () => undefined) };
    const tx = {
      appointment: {
        findFirst: vi.fn(async () => (row === null ? null : state)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state, data);
          return { feedbackPrice: state.feedbackPrice ?? null, feedbackCondition: state.feedbackCondition ?? null, feedbackFit: state.feedbackFit ?? null };
        }),
      },
      property: { findFirst: vi.fn(async () => ({ marketingTitle: null, street: "דיזנגוף", houseNumber: "10", city: "תל אביב" })) },
    };
    const prisma = { withTenant: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
    return { service: new ViewingFeedbackService(prisma, audit as unknown as AuditService), tx, audit };
  }
  const run = <T,>(fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId: TENANT, userId: USER, role: "agent", capabilities: [] } as never, fn);

  it("כותבת את התשובה, רושמת ביומן, ומחזירה את השאלה הבאה עם כתובת הנכס", async () => {
    const { service, audit } = harness({ id: APPT, kind: "viewing", title: null, propertyId: "01PROPAAAAAAAAAAAAAAAAAAAA", feedbackPrice: null, feedbackCondition: null, feedbackFit: null });
    const result = await run(() => service.record(APPT, "price", "high"));
    expect(result).toEqual({ label: "דיזנגוף 10, תל אביב", current: { price: "high", condition: null, fit: null }, next: "condition" });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
  it("אחרי התשובה השלישית — אין שאלה הבאה", async () => {
    const { service } = harness({ id: APPT, kind: "viewing", title: "סיור", propertyId: null, feedbackPrice: "high", feedbackCondition: "good", feedbackFit: null });
    const result = await run(() => service.record(APPT, "fit", "fits"));
    expect(result?.next).toBeNull();
    expect(result?.label).toBe("סיור");
  });
  it("סיור של משרד אחר (או שאינו סיור) — null, לא חריגה", async () => {
    const { service } = harness(null);
    expect(await run(() => service.record(APPT, "price", "high"))).toBeNull();
    const meeting = harness({ id: APPT, kind: "meeting", title: "פגישה", propertyId: null });
    expect(await run(() => meeting.service.record(APPT, "price", "high"))).toBeNull();
  });
});
