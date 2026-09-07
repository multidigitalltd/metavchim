import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import {
  assertContactAccess,
  canSeeContact,
  seesAllContacts,
  visibleContactIds,
} from "./ownership";
import { TenantContext } from "./tenant-context";

/**
 * ‎**נכסים: מי רואה את בעל הנכס — והחלטה של מנהל המשרד, לא שלנו.**
 *
 * ## ‏מה היה כאן קודם
 *
 * ‏ענף הנכסים ב-`visibleContactIds` היה **בלי סינון בעלות בכלל**:
 * ‏כל בעל נכס וכל דייר במשרד נראו לכל מי שמודול הנכסים פתוח אצלו.
 * ‏לקונים וללידים כבר היה `view_all`/`view_own`, ולנכסים לא הייתה
 * ‏אפילו האפשרות.
 *
 * ## ‏למה יכולת ולא כלל קשיח
 *
 * ‏יש משרדים שכל הנכסים בהם משותפים בכוונה, ויש משרדים שבהם נכס
 * ‏שייך לסוכן שגייס אותו ושיחה של עמית עם הבעלים היא בדיוק מה
 * ‏שאסור. `properties.view_all` ניתנת כברירת מחדל לכל תפקיד שיש לו
 * ‎`properties.view`, ולכן **שום משרד אינו מרגיש שינוי** עד שמנהל
 * ‏בוחר לחסום אותה.
 */

interface Fixture {
  /** ‏הנכס שהלקוח מחובר אליו — ולמי הוא משויך. */
  propertyAgentUserId: string | null;
}

/**
 * ‎**המסד המדומה מכבד את ה-`where`.**
 *
 * ‏זו כל התוחלת של הבדיקה: `ownershipFilter` מוסיף `agentUserId`
 * ‏ל-`where` רק כשחסרה `properties.view_all`. פיקסצ׳ר שמתעלם
 * ‏מה-`where` היה מחזיר אותה תשובה בשני המקרים — כלומר בודק כלום.
 */
function txFor(fx: Fixture) {
  const matches = (where: { agentUserId?: string }): boolean =>
    where.agentUserId === undefined || where.agentUserId === fx.propertyAgentUserId;

  return {
    buyer: { findFirst: async () => null, findMany: async () => [] },
    lead: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    property: {
      findFirst: async (args: { where: { agentUserId?: string } }) =>
        matches(args.where) ? { id: "01PROP" } : null,
      findMany: async (args: { where: { agentUserId?: string } }) =>
        matches(args.where)
          ? [{ ownerContactId: "01OWNER", occupantContactId: null }]
          : [],
    },
  };
}

function asUser<T>(capabilities: Capability[], userId: string, fn: () => T): T {
  return TenantContext.run(
    { tenantId: "01TENANT", userId, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/** ‏סוכן שהמנהל חסם לו את „כל הנכסים”. */
const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
/** ‏ברירת המחדל של כל תפקיד היום — כולל `view_all`. */
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all"];

const OTHERS = { propertyAgentUserId: "01OTHER" } as const;
const MINE = { propertyAgentUserId: "01ME" } as const;

describe("בעל נכס — מי רואה אותו", () => {
  it("ברירת המחדל אינה משנה דבר: עם view_all רואים כל בעל נכס", async () => {
    const ids = await asUser(DEFAULT, "01ME", () =>
      visibleContactIds(txFor(OTHERS) as never, "01TENANT"),
    );
    expect(ids).toContain("01OWNER");
  });

  it("בלי view_all — בעל נכס של סוכן אחר אינו ברשימה", async () => {
    const ids = await asUser(SCOPED, "01ME", () =>
      visibleContactIds(txFor(OTHERS) as never, "01TENANT"),
    );
    expect(ids).not.toContain("01OWNER");
  });

  it("בלי view_all — בעל הנכס שלי כן ברשימה", async () => {
    const ids = await asUser(SCOPED, "01ME", () =>
      visibleContactIds(txFor(MINE) as never, "01TENANT"),
    );
    expect(ids).toContain("01OWNER");
  });

  /*
   * ‏הרשימה והשער הבודד **חייבים להסכים** — כך כתוב בקובץ עצמו.
   * ‏הסתרה מהרשימה בלי שער על הפתיחה היא ניחוש מזהה, לא הפרדה.
   */
  it("השער הבודד מסכים עם הרשימה — פתיחה נדחית", async () => {
    await expect(
      asUser(SCOPED, "01ME", () =>
        assertContactAccess(txFor(OTHERS) as never, "01TENANT", "01OWNER"),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("השער הבודד מסכים עם הרשימה — הנכס שלי נפתח", async () => {
    await expect(
      asUser(SCOPED, "01ME", () =>
        assertContactAccess(txFor(MINE) as never, "01TENANT", "01OWNER"),
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * ‎**הקיצור אינו רשאי להחזיר יותר מהתנאי המלא.**
   *
   * ‎`seesAllContacts` מחזיר `null` מ-`visibleContactIds`, כלומר
   * ‏„אין מה לסנן”. אילו הוא היה מתעלם מ-`properties.view_all`, סוכן
   * ‏עם כל הקונים וכל הלידים אבל בלי כל הנכסים היה עוקף את הסינון
   * ‏החדש לגמרי — באג שקט בדיוק בכיוון המסוכן.
   */
  it("קיצור „רואה הכול” אינו מדלג על הנכסים", () => {
    const almost: Capability[] = [
      "buyers.view_all",
      "leads.view_all",
      "properties.view",
    ];
    expect(asUser(almost, "01ME", () => seesAllContacts())).toBe(false);
    expect(
      asUser([...almost, "properties.view_all"], "01ME", () => seesAllContacts()),
    ).toBe(true);
  });

  /**
   * ‎**המעקף שנמצא בסקירה: הכרטיס עצמו.**
   *
   * ‏רשימת הנכסים משרדית בכוונה, ולכן לכל סוכן יש את המזהה. הסתרת
   * ‏הבעלים מהדואר ומהשיחות בלי לגעת ב-`GET /properties/:id` השאירה
   * ‏את השם, הטלפון והמייל במרחק לחיצה אחת — כלומר הגנה עם מעקף בן
   * ‏צעד אחד (ביקורת Codex, P1). `canSeeContact` הוא מה שכרטיס הנכס
   * ‏שואל, והוא אותו קוד בדיוק של השער — לא מימוש שני.
   */
  it("‏‎canSeeContact הוא אותו כלל של השער, בשני הכיוונים", async () => {
    expect(
      await asUser(SCOPED, "01ME", () =>
        canSeeContact(txFor(OTHERS) as never, "01TENANT", "01OWNER"),
      ),
    ).toBe(false);
    expect(
      await asUser(SCOPED, "01ME", () =>
        canSeeContact(txFor(MINE) as never, "01TENANT", "01OWNER"),
      ),
    ).toBe(true);
    // ‏וברירת המחדל אינה משנה דבר
    expect(
      await asUser(DEFAULT, "01ME", () =>
        canSeeContact(txFor(OTHERS) as never, "01TENANT", "01OWNER"),
      ),
    ).toBe(true);
  });
});
