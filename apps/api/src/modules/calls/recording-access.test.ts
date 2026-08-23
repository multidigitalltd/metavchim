import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { assertContactAccess, visibleContactIds } from "../../common/ownership";
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
  /*
   * אף ישות אינה קושרת את הלקוח למשתמש — כלומר „הלקוח הזה אינו
   * שלי”, ומבחינת `orphanContactIds` הוא גם יתום.
   */
  const tx = {
    call: { findFirst: async () => call },
    buyer: { findFirst: async () => null, findMany: async () => [] },
    lead: { findFirst: async () => null, findMany: async () => [] },
    property: { findFirst: async () => null, findMany: async () => [] },
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
   * דרושות **שלוש** היכולות, וזה בדיוק התנאי של `seesAllContacts`:
   * כל הקונים, כל הלידים, ומודול הנכסים פתוח. צירוף חלקי מוותר על
   * הסינון עבור מקור שחסום — וזה בדיוק מה שנפתח כשהתנאי הזה היה
   * כתוב בשלושה עותקים ורק שניים מהם עודכנו (ביקורת Codex).
   */
  it("מנהל עם שלוש היכולות שומע גם שיחה של סוכן אחר", async () => {
    const call: FakeCall = { recordingKey: "k", contactId: null, createdBy: "01OTHER" };
    await expect(
      asAgent(["leads.view_all", "buyers.view_all", "properties.view"], "01ME", () =>
        serviceFor(call).recording("01CALL"),
      ),
    ).resolves.toBeDefined();

    // צירוף חלקי אינו מספיק — לא אחת, וגם לא שתיים מתוך השלוש
    for (const partial of [
      ["leads.view_all"],
      ["leads.view_all", "buyers.view_all"],
    ] as const) {
      await expect(
        asAgent([...partial], "01ME", () => serviceFor(call).recording("01CALL")),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
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
    /*
     * היכולת תואמת את המקור שבו הלקוח יושב. הבדיקה נכתבה כשהמקורות
     * היו עיוורים ליכולות, ולכן היא נתנה `leads.view_own` על לקוח
     * שיושב בטבלת הקונים — צירוף שכבר אינו מחזיר דבר, ובצדק.
     */
    const visible = await asAgent(["buyers.view_own"], "01ME", () =>
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
      const attempt = asAgent(["buyers.view_own"], "01ME", () => service.recording("01CALL"));
      if (allowed) await expect(attempt).resolves.toBeDefined();
      else await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  /*
   * מודול חסום אינו תורם לקוחות — בשני המסלולים.
   *
   * זה מה שנשבר ברגע שנתיב השיחות קיבל שתי יכולות חלופיות: מי
   * שמודול הלידים סגור אצלו נכנס בזכות הקונים, והכלל הישן — שתיאר
   * בעלות בלבד — נתן לו גם את הלידים ואת בעלי הנכסים, כלומר טלפונים,
   * תקצירים, תמלולים והקלטות ממודול שנחסם לו (ביקורת Codex).
   */
  it("לקוח ממודול חסום אינו נגיש — לא ברשימה ולא בשער הבודד", async () => {
    const tx = {
      buyer: { findMany: async () => [], findFirst: async () => null },
      lead: {
        findMany: async () => [{ contactId: "01LEADONLY" }],
        findFirst: async () => ({ id: "01LEAD" }),
      },
      property: { findMany: async () => [], findFirst: async () => null },
    };

    // עם מודול הלידים — הלקוח נגיש בשני המסלולים
    expect(
      await asAgent(["leads.view_own"], "01ME", () => visibleContactIds(tx as never, "01TENANT")),
    ).toEqual(["01LEADONLY"]);
    await expect(
      asAgent(["leads.view_own"], "01ME", () =>
        assertContactAccess(tx as never, "01TENANT", "01LEADONLY"),
      ),
    ).resolves.toBeUndefined();

    // בלעדיו — אינו נגיש בשניהם, למרות שהבעלות לא השתנתה
    expect(
      await asAgent(["buyers.view_own"], "01ME", () => visibleContactIds(tx as never, "01TENANT")),
    ).toEqual([]);
    await expect(
      asAgent(["buyers.view_own"], "01ME", () =>
        assertContactAccess(tx as never, "01TENANT", "01LEADONLY"),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * מחיקת ליד משאירה את איש הקשר בחיים כל עוד יש שיחות שמצביעות
   * עליו, אבל הוא כבר אינו כרטיס קונה, ליד או בעל נכס — כלומר אינו
   * שייך לאיש. בלי ענף „אני רשמתי” ההיסטוריה של הסוכן הייתה נעלמת
   * דווקא מהשיחות ששרדו את המחיקה (ביקורת Codex).
   */
  it("שיחה של לקוח שנמחק נשארת אצל מי שרשם אותה", async () => {
    const orphan: FakeCall = { recordingKey: "k", contactId: "01ORPHAN", createdBy: "01ME" };
    await expect(
      asAgent(["leads.view_own"], "01ME", () => serviceFor(orphan).recording("01CALL")),
    ).resolves.toBeDefined();

    // ולא נפתחת לעמית רק מפני שהלקוח התייתם
    await expect(
      asAgent(["leads.view_own"], "01OTHER", () => serviceFor(orphan).recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * „אני רשמתי” אינו עוקף מודול חסום.
   *
   * הענף נועד לשיחה **בלי בעלים** — בלי איש קשר, או עם לקוח
   * שהתייתם. הוא היה עיוור ליכולות, ולכן שיחה שנרשמה כשמודול
   * הלידים היה פתוח המשיכה לחשוף את הטלפון, התמלול וההקלטה של
   * אותו ליד גם אחרי שהמודול נחסם (ביקורת Codex).
   */
  it("שיחה שרשמתי על ליד חי אינה נפתחת כשמודול הלידים חסום", async () => {
    const call: FakeCall = { recordingKey: "k", contactId: "01LEAD", createdBy: "01ME" };
    /* הלקוח חי — הוא ליד של מישהו, ולכן אינו יתום */
    const live = {
      call: { findFirst: async () => call },
      buyer: { findFirst: async () => null, findMany: async () => [] },
      lead: {
        findFirst: async () => ({ id: "01L" }),
        findMany: async () => [{ contactId: "01LEAD" }],
      },
      property: { findFirst: async () => null, findMany: async () => [] },
    };
    const service = new CallsService(
      {
        withTenant: async <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(live),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { getObject: async () => ({ body: null, contentType: "audio/wav" }) } as never,
      {} as never,
    );

    // עם מודול הלידים — נפתחת
    await expect(
      asAgent(["leads.view_own"], "01ME", () => service.recording("01CALL")),
    ).resolves.toBeDefined();

    // בלעדיו — נחסמת, למרות שאני רשמתי אותה
    await expect(
      asAgent(["buyers.view_own"], "01ME", () => service.recording("01CALL")),
    ).rejects.toBeInstanceOf(NotFoundException);
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
