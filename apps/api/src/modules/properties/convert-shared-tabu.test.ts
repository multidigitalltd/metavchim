import { describe, expect, it, beforeAll } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { PropertiesService } from "./properties.service";
import type { PropertyFields } from "@metavchim/shared";

/**
 * ‎**הסימון על הלקוח קיים בדיוק בשביל הרגע שבו עוד אין נכס — ונמחק
 * בדיוק ברגע שהנכס נוצר** (ביקורת Codex, P1).
 *
 * ‏מוכר שהתקשר ואמר בשיחה הראשונה „החלקה שלי משותפת” מסומן על
 * ‏הכרטיס האישי, כי כרטיס הנכס עוד לא קיים. הרגע שבו הוא **כן**
 * ‏נוצר הוא ההמרה מליד — וטופס ההמרה אינו שולח את הדגל. כלומר
 * ‏הנתון שנרשם כדי לשרוד עד לכאן היה נופל ל-`false` בדיוק כאן,
 * ‏והכרטיס החדש נפתח בלי האזהרה המשפטית.
 */

const FIELDS: PropertyFields = { city: "חולון", propertyType: "apartment", dealType: "sale" };

beforeAll(() => {
  process.env["WEB_ORIGIN"] ??= "https://example.test";
  process.env["DATABASE_URL"] ??= "postgresql://u:p@localhost:5432/x";
});

/**
 * ‏בדל אחד לכל התלויות, ולא אינדקסים בבנאי: תלות שתיווסף באמצע
 * ‏הייתה מפילה את הבדיקה על משהו שאין לו קשר למה שהיא בודקת.
 */
function serviceWith(contactSharedTabu: boolean): {
  service: PropertiesService;
  persisted: () => Partial<PropertyFields> | null;
  contactWrites: () => { where: Record<string, unknown>; data: Record<string, unknown> }[];
} {
  let seen: Partial<PropertyFields> | null = null;
  const lead = {
    id: "01LEAD",
    contactId: "01CONTACT",
    status: "new",
    requiresHuman: false,
    firstResponseAt: null,
  };
  const contactWrites: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const tx = {
    lead: {
      findFirst: async () => lead,
      updateMany: async () => ({ count: 1 }),
    },
    task: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
    contact: {
      findFirst: async () => ({
        nameEncrypted: "n",
        phoneEncrypted: "p",
        sharedTabu: contactSharedTabu,
      }),
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        contactWrites.push(args);
        return { count: 1 };
      },
    },
  };
  const stub = {
    withTenant: async (fn: (t: unknown) => unknown) => fn(tx),
    decrypt: (value: string) => value,
    recomputeForProperty: async () => undefined,
  };
  const deps = Array.from({ length: 12 }, () => stub as unknown);
  const service = new PropertiesService(
    ...(deps as unknown as ConstructorParameters<typeof PropertiesService>),
  );
  const patched = service as unknown as {
    persist: (input: { fields: Partial<PropertyFields> }) => Promise<string>;
    autoPublishToNetwork: (id: string) => Promise<void>;
    getById: (id: string) => Promise<unknown>;
  };
  patched.persist = async ({ fields }) => {
    seen = fields;
    return "01PROP";
  };
  patched.autoPublishToNetwork = async () => undefined;
  patched.getById = async () => ({ id: "01PROP" });
  return { service, persisted: () => seen, contactWrites: () => contactWrites };
}

function asUser<T>(fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01USER",
      capabilities: new Set(["properties.edit"] as never),
      billingOnly: false,
    },
    fn,
  );
}

describe("המרת ליד לנכס — הדגל של הלקוח עובר", () => {
  it("לקוח שסומן „טאבו משותף” יוצר נכס שנושא את הסימון", async () => {
    const { service, persisted } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()?.sharedTabu).toBe(true);
  });

  it("לקוח בלי סימון אינו ממציא סימון על הנכס", async () => {
    const { service, persisted } = serviceWith(false);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()?.sharedTabu).toBeUndefined();
  });

  /*
   * ‏הכיוון ההפוך: מתווך שסימן בטופס ההמרה אמר משהו מפורש, ולקוח
   * ‏בלי סימון אינו אומר דבר על הנכס. לכן הדגל **מדליק ולא מכבה**.
   */
  it("סימון בטופס עומד בפני עצמו גם כשהלקוח אינו מסומן", async () => {
    const { service, persisted } = serviceWith(false);
    await asUser(() => service.convertFromLead("01LEAD", { ...FIELDS, sharedTabu: true }));
    expect(persisted()?.sharedTabu).toBe(true);
  });

  it("ושאר השדות של הטופס נשמרים כפי שהם", async () => {
    const { service, persisted } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()).toMatchObject({ city: "חולון", propertyType: "apartment" });
  });
});

/**
 * ‎**והסמן נגמר כשהוא נמסר** (ביקורת Codex, P1, סבב שני).
 *
 * ‏הגרסה הראשונה העתיקה את הדגל והשאירה אותו דלוק. מוכר עם שני
 * ‏נכסים — אחד בטאבו משותף ואחד רגיל — קיבל את שניהם מסומנים:
 * ‏ההמרה השנייה העתיקה שוב אותה עובדה היסטורית בלי שאיש אמר עליה
 * ‏דבר, וטופס ההמרה אינו יכול לתקן כי אין בו שדה. נכס רגיל שסומן
 * ‏כך מוציא מעצמו קונים שמסרבים לטאבו משותף ומייצר לו הצעות
 * ‏שותפים — שקט לגמרי על המסך.
 */
describe("הסמן על הלקוח נגמר בהעברה", () => {
  it("אחרי המרה שנשאה את הסימון — הוא כבוי על הלקוח", async () => {
    const { service, contactWrites } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(contactWrites()).toHaveLength(1);
    expect(contactWrites()[0]?.where).toMatchObject({
      id: "01CONTACT",
      tenantId: "01TENANT",
      /* ‏רק אם הוא עדיין דלוק — כתיבה על מצב שכבר השתנה אינה מכבה */
      sharedTabu: true,
    });
    expect(contactWrites()[0]?.data).toEqual({ sharedTabu: false });
  });

  /*
   * ‏זה המקרה שהממצא תיאר: הנכס השני של אותו מוכר. הדגל כבוי, ולכן
   * ‏ההמרה אינה ממציאה עליו דבר.
   */
  it("ולכן ההמרה הבאה של אותו מוכר אינה מסמנת את הנכס", async () => {
    const { service, persisted, contactWrites } = serviceWith(false);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()?.sharedTabu).toBeUndefined();
    expect(contactWrites()).toEqual([]);
  });

  /*
   * ‎**ולא כשהשמירה נכשלה.** הכיבוי אחרי ההעברה ולא לפניה: אחרת
   * ‏ההמרה שנפלה הייתה מוחקת עובדה משפטית שמעולם לא נרשמה.
   */
  it("שמירה שנכשלה אינה מכבה את הסימון", async () => {
    const { service, contactWrites } = serviceWith(true);
    (service as unknown as { persist: () => Promise<string> }).persist = () => {
      throw new Error("מכסת נכסים");
    };
    await expect(asUser(() => service.convertFromLead("01LEAD", FIELDS))).rejects.toThrow();
    expect(contactWrites()).toEqual([]);
  });
});
