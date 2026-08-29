import { describe, expect, it } from "vitest";
import type { AuditService } from "../../core/audit.service";
import type { OutboxService } from "../../core/outbox.service";
import type { PrismaService } from "../../core/prisma.service";
import type { CallsService } from "../calls/calls.service";
import type { ExclusivityService } from "../exclusivity/exclusivity.service";
import { TenantContext } from "../../common/tenant-context";
import { CalendarService } from "./calendar.service";

/**
 * ‎**פגישה נרשמת בציר הזמן של כל כרטיס שקושר אליה — לא רק של הליד.**
 *
 * ## מה היה שבור
 *
 * ‎`create` כתב שורת `interactions` רק כש-`leadId` היה קיים, בזמן
 * ש-`buyerId` נשמר על הפגישה עצמה ושכרטיס הקונה קורא ציר זמן משלו
 * (`/buyers/:id/interactions`, ועמודה `buyer_id` עם אינדקס משלה).
 * כלומר סיור שנקבע לקונה **לא הופיע אצלו בכלל**.
 *
 * זה לא התגלה כי שום מסך לא שלח `buyerId`. ברגע שכרטיס הקונה קיבל
 * כפתור „קביעת סיור”, והמסך הבטיח „הפגישה תתועד בציר הזמן של
 * הכרטיסים שיקושרו אליה”, זו הפכה להבטחה שבורה במסך עצמו — ובלי
 * הבדיקה הזאת אין מה שיצעק (ביקורת Codex).
 *
 * מסלול הדחייה (`reschedule`) כבר כתב לשני הצירים; זו הייתה אי-
 * עקביות בין שני מסלולים באותו שירות, לא החלטה.
 *
 * ## למה הבדיקה מריצה את השירות ולא קוראת את המקור
 *
 * זו טענה על **מה נכתב**, לא על צורת הקוד. בדיקה שסורקת את הקובץ
 * הייתה עוברת גם על כתיבה לשדה הלא נכון. הכפילים כאן מינימליים:
 * טרנזקציה מדומה שאוספת את מה שנוצר, וזהו.
 */

const TENANT = "01TENANT000000000000000000";
const USER = "01USER00000000000000000000";

function service(): { svc: CalendarService; interactions: Record<string, unknown>[] } {
  const interactions: Record<string, unknown>[] = [];
  const tx = {
    lead: { findFirst: async () => ({ id: "01LEAD" }) },
    property: { findFirst: async () => ({ id: "01PROP" }) },
    buyer: { findFirst: async () => ({ id: "01BUYER" }) },
    appointment: {
      create: async () => ({}),
      // ‎`create` מסיים ב-`getById` כדי להחזיר DTO מלא
      findFirst: async () => ({
        id: "01APPT",
        kind: "viewing",
        startsAt: new Date("2026-09-10T07:30:00.000Z"),
        status: "scheduled",
      }),
    },
    interaction: {
      create: async (args: { data: Record<string, unknown> }) => {
        interactions.push(args.data);
        return args.data;
      },
    },
  };
  const prisma = {
    withTenant: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const audit = { record: async () => undefined } as unknown as AuditService;
  const outbox = { emit: async () => undefined } as unknown as OutboxService;
  const calls = {} as unknown as CallsService;
  const exclusivity = { recordMarketingAction: async () => undefined } as unknown as ExclusivityService;
  return { svc: new CalendarService(prisma, audit, outbox, calls, exclusivity), interactions };
}

async function createWith(
  link: { leadId?: string; buyerId?: string },
): Promise<Record<string, unknown>[]> {
  const { svc, interactions } = service();
  await TenantContext.run(
    {
      tenantId: TENANT,
      userId: USER,
      capabilities: new Set(),
      billingOnly: false,
    } as Parameters<typeof TenantContext.run>[0],
    async () =>
      svc.create({
        kind: "viewing",
        startsAt: new Date("2026-09-10T07:30:00.000Z"),
        durationMinutes: 30,
        ...link,
      }),
  );
  return interactions;
}

describe("פגישה חדשה נרשמת בציר הזמן", () => {
  it("קונה — השורה נכתבת עם buyerId", async () => {
    const rows = await createWith({ buyerId: "01BUYER" });
    expect(rows.length).toBe(1);
    expect(rows[0]?.["buyerId"]).toBe("01BUYER");
    expect(rows[0]?.["leadId"]).toBeUndefined();
  });

  it("ליד — כמו קודם", async () => {
    const rows = await createWith({ leadId: "01LEAD" });
    expect(rows.length).toBe(1);
    expect(rows[0]?.["leadId"]).toBe("01LEAD");
  });

  it("שניהם מקושרים ⟵ שתי שורות, אחת לכל כרטיס", async () => {
    // בדיוק המצב של „קביעת סיור” מכרטיס הקונה: קונה **וגם** נכס,
    // ובהמשך גם ליד שהומר
    const rows = await createWith({ leadId: "01LEAD", buyerId: "01BUYER" });
    expect(rows.length).toBe(2);
    expect(rows.map((row) => row["leadId"] ?? row["buyerId"]).sort()).toEqual([
      "01BUYER",
      "01LEAD",
    ]);
  });

  it("בלי קישור — אין שורת ציר זמן", async () => {
    expect(await createWith({})).toEqual([]);
  });

  it("המועד בשעון ישראל ולא חותמת UTC", async () => {
    /*
     * ‎`toISOString()` הציג „2026-09-10T07:30:00.000Z” על סיור
     * ב-10:30 — חותמת UTC בציר זמן בעברית. זה בדיוק מה שכלל
     * ה-ESLint על שעון המכשיר נלחם בו, רק שכאן זה היה בשרת.
     */
    const rows = await createWith({ buyerId: "01BUYER" });
    const content = String(rows[0]?.["content"] ?? "");
    expect(content).toContain("10:30");
    expect(content).not.toContain("Z");
    expect(content).not.toContain("T07:30");
  });
});
