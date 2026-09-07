import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { PropertiesService } from "./properties.service";
import type { PropertyFields } from "@metavchim/shared";

/**
 * ‎**הרישום המשותף נשאל על הנכס — ולא נגזר מהאדם** (ביקורת Codex,
 * ‏P1, סבב רביעי).
 *
 * ‏`contacts.shared_tabu` הוא עובדה על **האדם**: מוכר שאמר בשיחה
 * ‏הראשונה שהחלקה שלו משותפת, או שותף קיים. הוא נועד לשרוד עד
 * ‏שכרטיס הנכס יקום.
 *
 * ‏שלושה סבבים ניסיתי להעביר אותו משם לנכס אוטומטית — העתקה, ואז
 * ‏העתקה שמכבה, ואז צריכה אטומית בתוך הטרנזקציה שכותבת. כל אחד
 * ‏מהם תיקן את הקודם ואף אחד לא תיקן את השורש: **לאדם אחד יכולים
 * ‏להיות כמה לידים**, ו-`convertFromLead` מקבל כל ליד שאינו
 * ‏`converted`. סמן שנצרך לפי `contactId` בלבד נוחת אצל מי שהומר
 * ‏ראשון — נכס רגיל מקבל אזהרה משפטית שאיש לא אמר עליו, והנכס
 * ‏שבאמת במושאע נוצר אחר כך בלעדיה. שקט לגמרי בשני הכיוונים.
 *
 * ‏מה שנשאר הוא ההפרדה שהייתה נכונה מלכתחילה: העובדה על האדם
 * ‏נשארת עליו ואינה נצרכת, והשאלה על **הנכס הזה** נשאלת בטופס
 * ‏ההמרה — תיבה שמסומנת מראש לפי הסימון על הלקוח. מי שיוצר את
 * ‏הנכס הוא שמאשר אותה עליו.
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
}

function serviceWith(contactSharedTabu: boolean): {
  service: PropertiesService;
  persisted: () => Partial<PropertyFields> | null;
  /** ‏האם הדגל על כרטיס הלקוח נשאר כפי שהיה. */
  contactStillFlagged: () => boolean;
} {
  let seen: PersistInput | null = null;
  let flag = contactSharedTabu;
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
      findFirst: async () => ({ nameEncrypted: "n", phoneEncrypted: "p" }),
      /* ‏אם משהו עדיין מכבה את הדגל — כאן זה ייראה */
      updateMany: async () => {
        flag = false;
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
  return {
    service,
    persisted: () => seen?.fields ?? null,
    contactStillFlagged: () => flag,
  };
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

describe("המרת ליד לנכס — הטופס מכריע על הנכס", () => {
  /*
   * ‎**המקרה שהממצא תיאר.** אותו מוכר, שני לידים על שני נכסים
   * ‏שונים. הסימון על הלקוח דלוק, והטופס של ההמרה הזו לא סימן —
   * ‏כלומר זה הנכס הרגיל. בהעברה האוטומטית הוא היה מקבל את הרישום
   * ‏המשותף רק משום שהומר ראשון.
   */
  it("לקוח מסומן, טופס שלא סימן — הנכס אינו מסומן", async () => {
    const { service, persisted } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()?.sharedTabu).toBeUndefined();
  });

  /*
   * ‏והצד השני, שבלעדיו „לעולם אל תסמן” היה עובר: הטופס **כן**
   * ‏סימן, ולכן הנכס מסומן — בין אם הלקוח מסומן ובין אם לא.
   */
  it("טופס שסימן — הנכס מסומן, גם כשהלקוח אינו מסומן", async () => {
    const { service, persisted } = serviceWith(false);
    await asUser(() => service.convertFromLead("01LEAD", { ...FIELDS, sharedTabu: true }));
    expect(persisted()?.sharedTabu).toBe(true);
  });

  it("ואותו טופס כשהלקוח כן מסומן — אותה תוצאה בדיוק", async () => {
    const { service, persisted } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", { ...FIELDS, sharedTabu: true }));
    expect(persisted()?.sharedTabu).toBe(true);
  });

  /*
   * ‎**והעובדה על האדם נשארת עליו.**
   *
   * ‏„מוכר שקשור לרישום משותף” אינו נגמר כשנוצר נכס אחד: הוא עדיין
   * ‏אותו אדם, ועדיין רלוונטי ללידים ולנכסים הבאים שלו. הצריכה
   * ‏שהייתה כאן מחקה אותה — כלומר הפכה עובדה על אדם לסמן חד-פעמי.
   */
  it("ההמרה אינה מכבה את הסימון על הלקוח", async () => {
    const { service, contactStillFlagged } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", { ...FIELDS, sharedTabu: true }));
    expect(contactStillFlagged(), "ההמרה כיבתה עובדה על האדם").toBe(true);
  });

  it("ושאר השדות של הטופס נשמרים כפי שהם", async () => {
    const { service, persisted } = serviceWith(true);
    await asUser(() => service.convertFromLead("01LEAD", FIELDS));
    expect(persisted()).toMatchObject({ city: "חולון", propertyType: "apartment" });
  });
});

/**
 * ‎**ושאין דרך שנייה** — שער על המקור.
 *
 * ‏שלוש הגרסאות שקדמו לזו נכתבו כל אחת בקוד אחר: העתקה בטופס,
 * ‏מתודה נפרדת שרצה אחרי `persist`, ו-`updateMany` בתוך הטרנזקציה.
 * ‏כולן אותה טעות, ולכן השער אינו נעוץ בביטוי אחד מהן: הוא שואל
 * ‏שהנכס אינו נגזר מהדגל של הלקוח בשום צורה.
 */
describe("‏שער: אין נתיב שגוזר את הנכס מהדגל של הלקוח", () => {
  const SOURCE = readFileSync(join(__dirname, "properties.service.ts"), "utf8");

  it("‏אין מסלול צריכה, בשום ניסוח", () => {
    for (const banned of [
      "spendContactSharedTabu",
      "consumesSharedTabuOf",
      "contactSharedTabu",
    ]) {
      expect(SOURCE, `נותר נתיב: ${banned}`).not.toContain(banned);
    }
  });

  /*
   * ‏והשורש: אם `sharedTabu` אינו נקרא כלל מכרטיס הלקוח, אין מאיפה
   * ‏לגזור. `select` של ההמרה הוא המקום היחיד שקרא אותו.
   */
  it("‏וההמרה אינה קוראת את הדגל מכרטיס הלקוח", () => {
    const claim = SOURCE.slice(
      SOURCE.indexOf("async convertFromLead("),
      SOURCE.indexOf("let propertyId: string;"),
    );
    expect(claim.length, "ההמרה נעלמה").toBeGreaterThan(0);
    expect(claim, "הדגל עדיין נקרא מהלקוח").not.toContain("sharedTabu");
  });

  /* ‏פיקוח: הדגל **כן** ממשיך לזרום מהטופס אל השורה. */
  it("‏והשדות של הטופס עדיין נכתבים כמו שהם", () => {
    expect(SOURCE).toContain("fieldsToColumns(fields)");
  });
});
