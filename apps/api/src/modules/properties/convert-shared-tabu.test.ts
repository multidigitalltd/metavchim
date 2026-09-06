import { readFileSync } from "node:fs";
import { join } from "node:path";
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
interface PersistInput {
  fields: Partial<PropertyFields>;
  consumesSharedTabuOf?: string;
}

function serviceWith(contactSharedTabu: boolean): {
  service: PropertiesService;
  persisted: () => Partial<PropertyFields> | null;
  persistInput: () => PersistInput | null;
} {
  let seen: PersistInput | null = null;
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
    persist: (input: PersistInput) => Promise<string>;
    autoPublishToNetwork: (id: string) => Promise<void>;
    getById: (id: string) => Promise<unknown>;
  };
  patched.persist = async (input) => {
    seen = input;
    return "01PROP";
  };
  patched.autoPublishToNetwork = async () => undefined;
  patched.getById = async () => ({ id: "01PROP" });
  return { service, persisted: () => seen?.fields ?? null, persistInput: () => seen };
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
  it("ההמרה מוסרת את הסימון ואת צריכתו יחד", async () => {
    const { service, persistInput } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persistInput()?.fields.sharedTabu).toBe(true);
    expect(persistInput()?.consumesSharedTabuOf).toBe("01CONTACT");
  });

  /*
   * ‏זה המקרה שהממצא תיאר: הנכס השני של אותו מוכר. הדגל כבוי, ולכן
   * ‏ההמרה אינה ממציאה עליו דבר ואין מה לצרוך.
   */
  it("ולכן ההמרה הבאה של אותו מוכר אינה מסמנת את הנכס", async () => {
    const { service, persisted, persistInput } = serviceWith(false);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()?.sharedTabu).toBeUndefined();
    expect(persistInput()?.consumesSharedTabuOf).toBeUndefined();
  });
});

/**
 * ‎**„באותה טרנזקציה” נבדק על הקוד, לא מוצהר** (ביקורת Codex, P2).
 *
 * ‏הבדיקות למעלה מחליפות את `persist` בבדל, ולכן הן מוכיחות
 * ‏ש**נמסר** לו הסמן — ולא שהוא כותב אותו יחד עם הנכס. הטענה
 * ‏השנייה היא כל התיקון: כיבוי בטרנזקציה נפרדת שכשלונה נבלע
 * ‏מחזיר את ההורשה, רק נדיר ולכן שקט.
 *
 * ‏פיקסצ׳ר לטרנזקציה האמיתית היה מדמה מכסות, גיאוקוד, אודיט
 * ‏ו-outbox — כלומר בודק בעיקר את עצמו. לכן הטענה נבדקת על המקור:
 * ‏הכיבוי יושב **בתוך** ה-`withTenant` שיוצר את הנכס.
 */
describe("‏צריכת הסמן יושבת בתוך הטרנזקציה שכותבת את הנכס", () => {
  const SOURCE = readFileSync(
    join(__dirname, "properties.service.ts"),
    "utf8",
  );

  it("‏אין כיבוי מחוץ ל-`persist`", () => {
    /* ‏העותק הישן היה מתודה נפרדת שרצה אחרי `persist` */
    expect(SOURCE).not.toContain("spendContactSharedTabu");
  });

  it("‏והכיבוי בין `tx.property.create` לסוף אותה טרנזקציה", () => {
    const create = SOURCE.indexOf("await tx.property.create({");
    expect(create, "יצירת הנכס נעלמה").toBeGreaterThan(0);
    const consume = SOURCE.indexOf("consumesSharedTabuOf,", create);
    expect(consume, "הכיבוי אינו אחרי יצירת הנכס").toBeGreaterThan(create);
    /* ‏ובאותו בלוק: עד סוף ה-`withTenant` שנפתח לפני היצירה */
    const blockEnd = SOURCE.indexOf("\n    });\n\n    return id;", create);
    expect(blockEnd, "סוף הטרנזקציה לא נמצא").toBeGreaterThan(0);
    expect(consume, "הכיבוי נפל מחוץ לטרנזקציה").toBeLessThan(blockEnd);
  });
});
