import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { visibleContactIds } from "../../common/ownership";
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

  /*
   * מנהל שומע הכול — אחרת הבדיקה מאשרת שער נעול ולא שער נכון.
   *
   * דרושות **שתי** היכולות ולא אחת, וזה בכוונה: זה בדיוק התנאי שבו
   * `visibleContactIds` מוותר על הסינון ברשימה. יכולת אחת בלבד
   * הייתה נותנת מסך שמראה שיחה שאי אפשר להשמיע, או להפך.
   */
  it("מנהל עם שתי היכולות שומע גם שיחה של סוכן אחר", async () => {
    const call: FakeCall = { recordingKey: "k", contactId: null, createdBy: "01OTHER" };
    await expect(
      asAgent(["leads.view_all", "buyers.view_all"], "01ME", () =>
        serviceFor(call).recording("01CALL"),
      ),
    ).resolves.toBeDefined();

    // יכולת אחת בלבד אינה מספיקה — אחרת שני המסלולים היו נפרדים
    await expect(
      asAgent(["leads.view_all"], "01ME", () => serviceFor(call).recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * שלושת מסלולי הדחייה מחזירים את אותה הודעה. הודעה שונה על „אין
   * הקלטה” הייתה מסגירה לסוכן אילו משיחות העמיתים שלו מוקלטות —
   * ולכן גם סדר הבדיקות חשוב: הבעלות נבדקת לפני קיום ההקלטה.
   */
  /*
   * שני המסלולים על אותם נתונים.
   *
   * הרשימה מסננת בשאילתה אחת (`visibleContactIds`) והשער הבודד
   * בודק רשומה אחת (`assertContactAccess`). שני ביטויים לאותו כלל
   * הם שתי הזדמנויות שהוא ייפרד — ואז המסך מציג שיחה שאי אפשר
   * לפתוח, או גרוע מזה, מסתיר שיחה שכן מותרת.
   */
  it("הרשימה והשער הבודד מסכימים על אותו לקוח", async () => {
    /* מקור אמת אחד לשני המסלולים — זה מה שהופך את זה לבדיקת הסכמה */
    const owned = new Set(["01MINE"]);
    const tx = {
      buyer: {
        findMany: async () => [...owned].map((contactId) => ({ contactId })),
        findFirst: async ({ where }: { where: { contactId?: string } }) =>
          where.contactId !== undefined && owned.has(where.contactId) ? { id: "01BUYER" } : null,
      },
      lead: { findMany: async () => [], findFirst: async () => null },
      property: { findMany: async () => [], findFirst: async () => null },
    };
    const visible = await asAgent(["leads.view_own"], "01ME", () =>
      visibleContactIds(tx as never, "01TENANT"),
    );
    expect(visible).toEqual(["01MINE"]);

    // מה שברשימה — נפתח; מה שאינו בה — נחסם
    for (const [contactId, allowed] of [
      ["01MINE", true],
      ["01CONTACT", false],
    ] as const) {
      const call: FakeCall = { recordingKey: "k", contactId, createdBy: "01OTHER" };
      const service = new CallsService(
        {
          withTenant: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> =>
            fn({ ...tx, call: { findFirst: async () => call } }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        { getObject: async () => ({ body: null, contentType: "audio/wav" }) } as never,
        {} as never,
      );
      const attempt = asAgent(["leads.view_own"], "01ME", () => service.recording("01CALL"));
      if (allowed) await expect(attempt).resolves.toBeDefined();
      else await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    }
  });

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
