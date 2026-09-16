import { describe, expect, it, vi } from "vitest";
import type { PlanDefinition } from "@metavchim/shared";
import { SignupService } from "./signup.service";

/**
 * ‎**כניסה עם Google לכתובת שאין לה חשבון פותחת משרד חינמי.**
 *
 * ‏עד כה היא נעצרה ב„החשבון לא קיים במערכת — פנו למנהל המשרד”. זה
 * ‏נכון למי שהוזמן למשרד קיים, ולא נכון בכלל למי שרק רוצה להתחיל:
 * ‏הוא הגיע עם כתובת ש-Google אימתה, ולא הייתה לו שום דרך להמשיך.
 *
 * ‏השירות נבנה כאן עם תלויות מינימליות אמיתיות — שתי ההכרעות
 * ‏שנבדקות (איזה מסלול, ומתי **לא** לפתוח) אינן נוגעות בשאר.
 */

function plan(over: Partial<PlanDefinition> & { code: string }): PlanDefinition {
  return {
    name: over.code,
    description: "",
    monthlyPriceAgorot: 0,
    yearlyPriceAgorot: 0,
    maxUsers: null,
    maxProperties: null,
    maxAutomations: null,
    whatsappSeatMonthlyAgorot: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: [],
    trialDays: 0,
    priceOnRequest: false,
    isPublic: true,
    sortOrder: 0,
    ...over,
  } as PlanDefinition;
}

/**
 * ‏שירות עם התלויות שהמסלול הזה באמת נוגע בהן: קטלוג המסלולים,
 * ‏וחיפוש המשתמש לפי כתובת. `create` מוחלף כדי לתפוס את מה שנשלח
 * ‏אליו בלי לגעת במסד.
 */
function serviceWith(options: {
  plans: PlanDefinition[];
  existingUser?: { id: string } | null;
}): { service: SignupService; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({
    user: { id: "U", tenantId: "T", name: "n", email: "e", role: "owner" },
    trialEndsAt: null,
  }));
  const service = new SignupService(
    {
      user: { findUnique: async () => options.existingUser ?? null },
    } as never,
    { publicPlans: async () => options.plans } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { create: unknown }).create = create;
  return { service, create };
}

const FREE = plan({ code: "shituf", sortOrder: 20 });
const PAID = plan({ code: "pro", monthlyPriceAgorot: 14_900, trialDays: 14, sortOrder: 10 });

describe("המסלול שנבחר אוטומטית", () => {
  it("נבחר החינמי מבין המוצעים, ולא הראשון ברשימה", async () => {
    const { service } = serviceWith({ plans: [PAID, FREE] });
    expect((await service.freeSelfServePlan())?.code).toBe("shituf");
  });

  /*
   * ‏קוד צרוב היה נשבר בשקט ביום שבעל הפלטפורמה משנה את המסלול.
   * ‏בין כמה חינמיים מכריע `sortOrder` — הסדר בדף התמחור.
   */
  it("בין כמה חינמיים — הראשון בסדר התצוגה", async () => {
    const other = plan({ code: "free2", sortOrder: 5 });
    const { service } = serviceWith({ plans: [FREE, other] });
    expect((await service.freeSelfServePlan())?.code).toBe("free2");
  });

  it("אין מסלול חינמי ציבורי — לא נבחר דבר, ולא נפתח חשבון", async () => {
    const { service, create } = serviceWith({ plans: [PAID] });
    expect(await service.freeSelfServePlan()).toBeNull();
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("מתי לא נפתח חשבון", () => {
  /*
   * ‎**המקרה שהוא שער אבטחה ולא נוחות.**
   *
   * ‏`loginWithVerifiedEmail` זורק „החשבון לא קיים” גם על משתמש
   * ‏**מושבת**. אילו הפתיחה נשענה על כך שההתחברות נכשלה, מי שהמשרד
   * ‏שלו השבית אותו היה נכנס עם Google ומקבל משרד חדש משלו — כלומר
   * ‏עוקף את ההשבתה לגמרי.
   */
  it("כתובת של משתמש קיים — גם מושבת — אינה פותחת משרד חדש", async () => {
    const { service, create } = serviceWith({
      plans: [FREE],
      existingUser: { id: "existing" },
    });
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("מה נכתב כשכן נפתח", () => {
  it("המסלול החינמי, בלי סיסמה, ועל שם הנרשם", async () => {
    const { service, create } = serviceWith({ plans: [PAID, FREE] });
    await service.createFromVerifiedIdentity({ email: "Moshe@Example.CO", name: " משה לוי " });
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent["plan"]).toBe("shituf");
    /* ‏בלי סיסמה כלל — לא סיסמה אקראית שאיש אינו מכיר. */
    expect(sent["passwordHash"]).toBeNull();
    expect(sent["email"]).toBe("moshe@example.co");
    expect(sent["ownerName"]).toBe("משה לוי");
    expect(sent["agencyName"]).toBe("משה לוי");
    expect(sent["coupon"]).toBeNull();
  });

  /* ‏Google אינה מבטיחה שם. משרד בלי שם היה נראה ריק בכל מסך. */
  it("בלי שם מ-Google — החלק שלפני ה-@ משמש כשם", async () => {
    const { service, create } = serviceWith({ plans: [FREE] });
    await service.createFromVerifiedIdentity({ email: "dani@example.co" });
    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent["ownerName"]).toBe("dani");
  });
});
