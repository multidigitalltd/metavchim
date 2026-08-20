import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { CallsService } from "./calls.service";

/**
 * מי רשאי להשמיע הקלטה של שיחה.
 *
 * ## למה הבדיקה הזו קיימת
 *
 * ‎`FORCE ROW LEVEL SECURITY`‎ מבודד משרד ממשרד — ולא סוכן מסוכן.
 * הגרסה הראשונה של הנתיב שלפה לפי `{ id, tenantId }` בלבד, ולכן
 * סוכן עם `leads.view_own` יכול היה להשמיע את שיחת הלקוח של סוכן
 * אחר בכך שיבקש את המזהה שלה ישירות (ביקורת Codex).
 *
 * הבדיקה נעצרת בשער ואינה מגיעה לאחסון: היא בודקת שהשליפה מוגבלת
 * לבעלות ושהתשובה זהה בכל מסלולי הדחייה. אודיו של לקוח הוא הפריט
 * הרגיש ביותר במודול, ולכן הכלל נבדק בהתנהגות ולא רק נכתב בהערה.
 */

interface FakeCall {
  recordingKey: string | null;
  contactId: string | null;
  createdBy: string | null;
}

/**
 * מסד מדומה שמחזיר שיחה אחת, ואינו מוצא אף ישות שקושרת את הלקוח
 * למשתמש — כלומר "הלקוח הזה אינו שלי".
 */
function serviceFor(call: FakeCall | null): CallsService {
  const tx = {
    call: { findFirst: async () => call },
    buyer: { findFirst: async () => null },
    lead: { findFirst: async () => null },
    property: { findFirst: async () => null },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  // האחסון מדומה: הבדיקה עוסקת בשער, ולא במה שיוצא ממנו
  const storage = { getObject: async () => ({ body: null, contentType: "audio/wav" }) };
  return new CallsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    storage as never,
    {} as never,
  );
}

function asAgent<T>(capabilities: Capability[], userId: string, fn: () => T): T {
  return TenantContext.run(
    { tenantId: "01TENANT", userId, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

const OTHERS_CALL: FakeCall = {
  recordingKey: "calls/01TENANT/01CALL/01OBJ",
  contactId: "01CONTACT",
  createdBy: "01OTHER",
};

describe("גישה להקלטת שיחה", () => {
  it("סוכן עם view_own בלבד אינו מקבל הקלטה של לקוח שאינו שלו", async () => {
    await expect(
      asAgent(["leads.view_own"], "01ME", () => serviceFor(OTHERS_CALL).recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * שיחה שנרשמה ידנית בלי איש קשר — הבעלות היא מי שרשם אותה.
   * בלי הענף הזה כל שיחה בלי `contactId` הייתה פתוחה לכל המשרד.
   */
  it("שיחה בלי איש קשר שייכת למי שרשם אותה", async () => {
    const call: FakeCall = { recordingKey: "k", contactId: null, createdBy: "01OTHER" };
    await expect(
      asAgent(["leads.view_own"], "01ME", () => serviceFor(call).recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      asAgent(["leads.view_own"], "01OTHER", () => serviceFor(call).recording("01CALL")),
    ).resolves.toBeDefined();
  });

  /* מנהל עם view_all שומע הכול — אחרת הבדיקה מאשרת שער נעול, לא נכון */
  it("view_all פותח גם שיחה של סוכן אחר", async () => {
    const call: FakeCall = { recordingKey: "k", contactId: null, createdBy: "01OTHER" };
    await expect(
      asAgent(["leads.view_all"], "01ME", () => serviceFor(call).recording("01CALL")),
    ).resolves.toBeDefined();
  });

  /*
   * שלושת מסלולי הדחייה מחזירים את אותה הודעה. הודעה שונה על „אין
   * הקלטה” הייתה מסגירה לסוכן אילו משיחות העמיתים שלו מוקלטות —
   * ולכן גם סדר הבדיקות חשוב: הבעלות נבדקת לפני קיום ההקלטה.
   */
  it("שיחה שאינה שלי ושיחה שאינה קיימת נראות זהה", async () => {
    const messages: string[] = [];
    for (const call of [null, OTHERS_CALL, { ...OTHERS_CALL, recordingKey: null }]) {
      await asAgent(["leads.view_own"], "01ME", () =>
        serviceFor(call)
          .recording("01CALL")
          .catch((error: unknown) => {
            messages.push((error as Error).message);
          }),
      );
    }
    expect(messages).toEqual(["שיחה לא נמצאה", "שיחה לא נמצאה", "שיחה לא נמצאה"]);
  });
});
