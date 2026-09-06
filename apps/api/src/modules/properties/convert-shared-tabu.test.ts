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
} {
  let seen: Partial<PropertyFields> | null = null;
  const lead = {
    id: "01LEAD",
    contactId: "01CONTACT",
    status: "new",
    requiresHuman: false,
    firstResponseAt: null,
  };
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
  return { service, persisted: () => seen };
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
