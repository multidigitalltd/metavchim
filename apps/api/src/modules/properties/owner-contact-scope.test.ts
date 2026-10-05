import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PropertiesService } from "./properties.service";

/**
 * ‎**המעקף: כרטיס הנכס.**
 *
 * ‏רשימת הנכסים משרדית בכוונה, ולכן לכל סוכן יש את מזהה כל נכס.
 * ‏כשההפרדה החדשה הסתירה את בעל הנכס מהדואר, מהשיחות, מההסכמים
 * ‏ומהחיפוש — `GET /properties/:id` המשיך להחזיר את השם, הטלפון
 * ‏והמייל שלו, כי הוא דורש רק `properties.view` (ביקורת Codex, P1).
 * ‏הגנה שיש לה מעקף בן צעד אחד אינה הגנה.
 *
 * ‏מה שיורד הוא **האדם**, לא הכרטיס: הכתובת, המחיר והמצב נשארים
 * ‏גלויים, כי הנכס עצמו אכן משותף.
 */

const OWNER_CONTACT = "01OWNERCONTACT00000000001";

function serviceFor(
  propertyAgentUserId: string | null,
  overrides: {
    ownerContactId?: string | null;
    occupantContactId?: string | null;
    /*
     * ‏אותו לקוח מחזיק גם כרטיס קונה שלי — כלומר `canSeeContact`
     * ‏נפתח דרך מקור שאין לו שום קשר לנכס שנערך.
     */
    contactIsMyBuyer?: boolean;
  } = {},
): PropertiesService {
  const tx = {
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) => {
        // ‏הבדיקה של `canSeeContact` מגיעה עם `agentUserId` כשאין view_all
        if (args.where.agentUserId !== undefined) {
          return args.where.agentUserId === propertyAgentUserId ? { id: "01PROP" } : null;
        }
        return {
          id: "01PROP",
          tenantId: "01TENANT",
          status: "active",
          city: "רעננה",
          street: "אחוזה",
          propertyType: "apartment",
          dealType: "sale",
          ownerContactId:
            overrides.ownerContactId === undefined ? OWNER_CONTACT : overrides.ownerContactId,
          occupantContactId: overrides.occupantContactId ?? null,
          agentUserId: propertyAgentUserId,
          marketingTitle: null,
          marketingDescription: null,
          internalNotes: null,
          features: {},
          leaseEndsAt: null,
          noticePeriodDays: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    propertyMedia: { findFirst: async () => null },
    buyer: {
      findFirst: async () => (overrides.contactIsMyBuyer === true ? { id: "01BUYER" } : null),
      findMany: async () => [],
    },
    lead: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    user: { findMany: async () => [] },
    /*
     * ‏מה שמסלול העריכה נוגע בו לפני שער הגישה: הנעילה הייעודית
     * ‏שהוא לוקח על שורת הנכס. אין כאן חיקוי של העריכה כולה — היא
     * ‏נבדקת במקומות אחרים; רק מה שנדרש כדי להגיע לשורה שנבדקת.
     */
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    // ‏מה ש-`prepareOwnerUpdate` שואל אחרי שהוא מצא את הבעלים
    match: { findMany: async () => [] },
    offer: { findMany: async () => [] },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const contacts = {
    findOrCreateByPhone: async () => ({ id: "01NEWCONTACT0000000000001" }),
    /*
     * ‏שער מיחזור הכרטיס נבדק במקום שבו הוא יושב
     * ‏(`link-person-scope.test.ts`), ולא כאן: הנושא כאן הוא היקף
     * ‏הנכס, ופיקסצ׳ר שמחקה גם את השני היה בודק בעיקר את עצמו.
     */
    findOrCreateByPhoneScoped: async () => ({ id: "01NEWCONTACT0000000000001" }),
    findOrCreateByPhoneTyped: async () => ({ id: "01NEWCONTACT0000000000001" }),
    getById: async () => ({
      id: OWNER_CONTACT,
      name: "בעל הנכס",
      phone: "+972501234567",
      email: "owner@example.com",
    }),
  };
  const audit = { record: async () => undefined };
  const messaging = { recordOutbound: async () => undefined };
  return new PropertiesService(
    prisma as never,
    audit as never,
    {} as never,
    {} as never,
    contacts as never,
    messaging as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01ME",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

describe("כרטיס נכס — פרטי הבעלים", () => {
  it("ברירת המחדל אינה משנה דבר: הבעלים מוצג", async () => {
    const dto = await asUser(DEFAULT, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerContact?.phone).toBe("+972501234567");
  });

  it("נכס של סוכן אחר — הבעלים יורד מהכרטיס", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerContact).toBeUndefined();
  });

  /*
   * ‏הצד השני: השמטה ולא חסימה. הכרטיס עצמו נשאר — הנכס אכן משותף,
   * ‏ומה שאינו משותף הוא האדם.
   */
  it("הכרטיס עצמו נשאר גלוי — רק האדם יורד", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.id).toBe("01PROP");
    expect(dto.city).toBe("רעננה");
  });

  it("הנכס שלי — הבעלים מוצג כרגיל", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01ME").getById("01PROP"));
    expect(dto.ownerContact?.phone).toBe("+972501234567");
  });

  /*
   * ‎**„מוסתר” אינו „חסר”, וההבדל אינו ניסוח.**
   *
   * ‏השמטה לבדה גרמה למסך להציג „חסר” ולפתוח טופס הוספה על בעלים
   * ‏קיים — כלומר ההגנה על הקריאה הזמינה דריסה בכתיבה (ביקורת
   * ‏Codex, P1). הדגל הוא מה שמאפשר למסך לומר „יש, ולא לך”.
   */
  it("הכרטיס אומר „מוסתר” ולא שותק", async () => {
    const dto = await asUser(SCOPED, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerContact).toBeUndefined();
    expect(dto.ownerRedacted).toBe(true);
  });

  /*
   * ‏והצד השני, שבלעדיו „תמיד מוסתר” היה עובר: נכס שבאמת אין לו
   * ‏בעלים אינו „מוסתר”, והמסך **כן** צריך להציע להוסיף.
   */
  it("נכס בלי בעלים כלל אינו „מוסתר”", async () => {
    const dto = await asUser(SCOPED, () =>
      serviceFor("01OTHER", { ownerContactId: null }).getById("01PROP"),
    );
    expect(dto.ownerContact).toBeUndefined();
    expect(dto.ownerRedacted).toBeUndefined();
  });

  /*
   * ‎**המקור השני של ההיתר אינו קשור לנכס** (ביקורת Codex, P1).
   *
   * ‏`canSeeContact` הוא **איחוד**: אותו אדם הוא גם הקונה שלי, ולכן
   * ‏הוא עובר — דרך כרטיס הקונה. בלי שאלת הנכס, הכרטיס היה מחזיר
   * ‏את שמו, הטלפון והמייל שלו **בהקשר של הנכס של העמית**, כלומר
   * ‏מגלה בדיוק את מה שהחסימה נועדה להסתיר: שהאדם הזה הוא הבעלים
   * ‏של אותו נכס.
   *
   * ‏זו אותה מלכודת שכבר נחסמה בכתיבה (`החלפת בעלים שאינו מוצג`),
   * ‏והיא נשארה פתוחה בקריאה.
   */
  it("בעל נכס של עמית שהוא גם הקונה שלי — עדיין מוסתר", async () => {
    const dto = await asUser(SCOPED, () =>
      serviceFor("01OTHER", { contactIsMyBuyer: true }).getById("01PROP"),
    );
    expect(dto.ownerContact, "הוצג דרך כרטיס שאינו קשור לנכס").toBeUndefined();
    expect(dto.ownerRedacted).toBe(true);
  });

  /*
   * ‏והצד השני, שבלעדיו „תמיד להסתיר” היה עובר: אותו לקוח בדיוק,
   * ‏על הנכס **שלי** — מוצג.
   */
  it("ואותו לקוח על הנכס שלי — מוצג", async () => {
    const dto = await asUser(SCOPED, () =>
      serviceFor("01ME", { contactIsMyBuyer: true }).getById("01PROP"),
    );
    expect(dto.ownerContact?.phone).toBe("+972501234567");
  });

  /* ‏ואותו מבנה על הדייר, שהוא הענף השני של אותה החלטה. */
  it("דייר בנכס של עמית שהוא גם הקונה שלי — מוסתר", async () => {
    const dto = await asUser(SCOPED, () =>
      serviceFor("01OTHER", {
        ownerContactId: null,
        occupantContactId: OWNER_CONTACT,
        contactIsMyBuyer: true,
      }).getById("01PROP"),
    );
    expect(dto.occupantContact).toBeUndefined();
    expect(dto.occupantRedacted).toBe(true);
  });

  it("ובברירת המחדל — לא מוסתר ולא חסר", async () => {
    const dto = await asUser(DEFAULT, () => serviceFor("01OTHER").getById("01PROP"));
    expect(dto.ownerRedacted).toBeUndefined();
  });
});

/**
 * ‎**ההשמטה יצרה בעצמה נתיב לאובדן נתונים.**
 *
 * ‏הסוכן רואה „חסר”, המסך מציע להוסיף, והעריכה דרסה את כרטיס
 * ‏הבעלים של העמית בלי שום בדיקה — דרך הממשק הרגיל ובלי שאיש
 * ‏התכוון (ביקורת Codex, P1). המסך כבר אינו מציע; השרת דוחה בכל
 * ‏מקרה, כי מסך אינו הרשאה.
 */
describe("החלפת בעלים שאינו מוצג", () => {
  const NEW_OWNER = { name: "בעלים חדש", phone: "0501112222" };
  /*
   * ‏שני שערים, שתי שאלות שונות: „הנכס הזה בהיקף שלי?” ו„מותר לי
   * ‏לגעת באדם הזה?”. הטענה „ההחלפה נעצרה” היא איחוד שלהן, וכתובה
   * ‏פעם אחת — כך שאף בדיקה אינה נצמדת בשוגג לנוסח של שער אחד.
   */
  const BY_PROPERTY = /משויך לסוכן אחר/u;
  const BY_CONTACT = /אינו נגיש/u;
  const BLOCKED = new RegExp(`${BY_PROPERTY.source}|${BY_CONTACT.source}`, "u");

  /**
   * ‎**„לא נחסם” ולא „הצליח”, ואומר זאת.**
   *
   * ‏מסלול העריכה המלא נוגע בנעילה, במדיה, בהתאמות ובאירועים —
   * ‏פיקסצ׳ר שלם עבורו היה בודק הכול חוץ מהשורה שנבדקת כאן. לכן
   * ‏הטענה החיובית היא בדיוק ההפך של השלילית: **שער הגישה לא
   * ‏עצר**. מה שקורה אחריו נבדק במקומות אחרים.
   */
  async function notBlocked(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(BLOCKED);
    }
  }

  it("נכס של סוכן אחר — ההחלפה נדחית", async () => {
    await expect(
      asUser(SCOPED, () =>
        serviceFor("01OTHER").update("01PROP", { owner: NEW_OWNER } as never),
      ),
    ).rejects.toThrow(BLOCKED);
  });

  it("הנכס שלי — השער אינו עוצר", async () => {
    await notBlocked(() =>
      asUser(SCOPED, () => serviceFor("01ME").update("01PROP", { owner: NEW_OWNER } as never)),
    );
  });

  /*
   * ‏נכס בלי בעלים אינו „החלפה”: אין את מי לדרוס, וזו בדיוק
   * ‏ההוספה שהמסך אמור להציע.
   */
  it("נכס בלי בעלים — השער אינו עוצר", async () => {
    await notBlocked(() =>
      asUser(SCOPED, () =>
        serviceFor("01OTHER", { ownerContactId: null }).update("01PROP", {
          owner: NEW_OWNER,
        } as never),
      ),
    );
  });

  /*
   * ‏ועריכה שאינה נוגעת באדם — מחיר, כתובת — עוברת גם על נכס של
   * ‏עמית. השער הוא על ההחלפה, לא על העריכה.
   */
  it("עריכה שאינה נוגעת בבעלים — השער אינו עוצר", async () => {
    await notBlocked(() =>
      asUser(SCOPED, () => serviceFor("01OTHER").update("01PROP", { city: "חיפה" } as never)),
    );
  });

  /*
   * ‎**ומחיקת דייר מוסתר היא אותה פגיעה.** בלי הזכר הזה השער היה
   * ‏נכון לחצי מהפעולות: החלפה נחסמת, מחיקה עוברת.
   */
  it("ניקוי דייר שאינו מוצג — נדחה", async () => {
    await expect(
      asUser(SCOPED, () =>
        serviceFor("01OTHER", { occupantContactId: "01OCCUPANT0000000000000001" }).update(
          "01PROP",
          { occupantCleared: true } as never,
        ),
      ),
    ).rejects.toThrow(BLOCKED);
  });

  /*
   * ‎**והשאלה היא על הנכס, לא על האדם** (ביקורת Codex, P1, סבב
   * ‏שני).
   *
   * ‏`canSeeContact` הוא איחוד מקורות. בעל הנכס של עמית שהוא **גם
   * ‏הקונה שלי** עובר אותו דרך הקונה, ולכן השער שמעל אישר, `getById`
   * ‏הציג את הקשר כניתן לעריכה (אותו איחוד), וההחלפה בנכס של העמית
   * ‏עברה דרך הממשק הרגיל. השער הנוסף שואל על **היקף הנכס**.
   */
  it("בעל נכס של עמית שהוא גם הקונה שלי — ההחלפה עדיין נדחית", async () => {
    await expect(
      asUser(SCOPED, () =>
        serviceFor("01OTHER", { contactIsMyBuyer: true }).update("01PROP", {
          owner: NEW_OWNER,
        } as never),
      ),
    ).rejects.toThrow(BY_PROPERTY);
  });

  /*
   * ‏והצד השני, שבלעדיו „חסום הכול” היה עובר: אותו לקוח בדיוק, על
   * ‏**הנכס שלי** — עובר.
   */
  it("ואותו לקוח על הנכס שלי — השער אינו עוצר", async () => {
    await notBlocked(() =>
      asUser(SCOPED, () =>
        serviceFor("01ME", { contactIsMyBuyer: true }).update("01PROP", {
          owner: NEW_OWNER,
        } as never),
      ),
    );
  });
});

/**
 * ‎**ולא רק לראות — גם לפנות.**
 *
 * ‏הכרטיס משמיט את הבעלים, ואז „עדכון שיווק לבעל הנכס” החזיר אותו:
 * ‎`waUrl` נושא את הטלפון וההודעה נושאת את השם, וכל סוכן יכול
 * ‏לקרוא לפעולה כי מזהה הנכס משרדי (ביקורת Codex, P1).
 *
 * ‏זו הצורה החמורה של הדליפה: ההודעה נרשמת ב-Messages Hub ויוצאת
 * ‏בשם המשרד, כלומר היא **יוצרת** מגע ולא חושפת מידע. ולכן כאן זה
 * ‏זורק ולא משמיט — אין מה להשמיט, יש מה לעצור.
 */
describe("עדכון שיווק לבעל הנכס", () => {
  it("נכס של סוכן אחר — הפעולה נדחית", async () => {
    await expect(
      asUser(SCOPED, () => serviceFor("01OTHER").prepareOwnerUpdate("01PROP")),
    ).rejects.toThrow();
  });

  it("הנכס שלי — הקישור נבנה כרגיל", async () => {
    const result = await asUser(SCOPED, () =>
      serviceFor("01ME").prepareOwnerUpdate("01PROP"),
    );
    expect(result.waUrl).toContain("972501234567");
    expect(result.message).toContain("בעל הנכס");
  });

  it("ברירת המחדל אינה משנה דבר", async () => {
    const result = await asUser(DEFAULT, () =>
      serviceFor("01OTHER").prepareOwnerUpdate("01PROP"),
    );
    expect(result.waUrl).toContain("972501234567");
  });
});
