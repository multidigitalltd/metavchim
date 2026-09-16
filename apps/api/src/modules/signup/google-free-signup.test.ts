import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
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
  /** ‏תקרת הפתיחות — `true` = המקור מיצה אותה. */
  overQuota?: boolean;
}): {
  service: SignupService;
  create: ReturnType<typeof vi.fn>;
  charge: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({
    user: { id: "U", tenantId: "T", name: "n", email: "e", role: "owner" },
    trialEndsAt: null,
  }));
  const charge = vi.fn(async () => {
    if (options.overQuota === true) throw new HttpException("יותר מדי", 429);
  });
  const service = new SignupService(
    {
      user: { findUnique: async () => options.existingUser ?? null },
    } as never,
    { publicPlans: async () => options.plans } as never,
    {} as never,
    {} as never,
    { chargeTenantOpening: charge } as never,
  );
  (service as unknown as { create: unknown }).create = create;
  return { service, create, charge };
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
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4")).toBeNull();
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
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("מה נכתב כשכן נפתח", () => {
  it("המסלול החינמי, בלי סיסמה, ועל שם הנרשם", async () => {
    const { service, create } = serviceWith({ plans: [PAID, FREE] });
    await service.createFromVerifiedIdentity({ email: "Moshe@Example.CO", name: " משה לוי " }, "1.2.3.4");
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
    await service.createFromVerifiedIdentity({ email: "dani@example.co" }, "1.2.3.4");
    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent["ownerName"]).toBe("dani");
  });
});

/**
 * ‎**תקרה על פתיחת דיירים, לא על ההתחברות.**
 *
 * ‏הנתיב הזה ירש רק את התקרה הכללית של ‎300 בקשות לדקה, בעוד
 * ‏שהרשמה עצמית דרך הטופס מוגבלת לשלוש בשעה. מי שמחזיק אצווה של
 * ‏חשבונות Google יכול היה למלא את המסד במאות משרדי רפאים מכתובת
 * ‏אחת בדקה (ביקורת Codex).
 *
 * ‏מה שחשוב באותה מידה הוא מה **לא** נספר: התחברות רגילה של סוכן
 * ‏קיים, וגם ניסיון של מי שהמשרד שלו השבית אותו. משרד שלם יושב
 * ‏מאחורי כתובת NAT אחת, ותקרה שסופרת התחברויות הייתה נועלת אותו.
 */
describe("תקרת פתיחת החשבונות", () => {
  it("המקור מיצה את התקרה — לא נפתח דבר", async () => {
    const { service, create } = serviceWith({ plans: [FREE], overQuota: true });
    await expect(
      service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4"),
    ).rejects.toMatchObject({ status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("פתיחה אמיתית — נגבה בדיוק פעם אחת, על מקור הבקשה", async () => {
    const { service, charge, create } = serviceWith({ plans: [FREE] });
    await service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith("1.2.3.4");
    expect(create).toHaveBeenCalledTimes(1);
  });

  /*
   * ‎**המקרה שקובע שהתקרה אינה פוגעת בחפים מפשע.**
   *
   * ‏משתמש מושבת שמנסה שוב ושוב עם Google מגיע לכאן בכל פעם. אילו
   * ‏הגבייה ישבה בכניסה לפונקציה, הוא היה שורף בשלושה ניסיונות את
   * ‏מכסת הפתיחות של כל מי שיושב מאחורי אותה כתובת — כלומר של כל
   * ‏המשרד.
   */
  it("כתובת תפוסה (משתמש מושבת) — אינה נוגעת במונה כלל", async () => {
    const { service, charge } = serviceWith({
      plans: [FREE],
      existingUser: { id: "existing" },
    });
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4")).toBeNull();
    expect(charge).not.toHaveBeenCalled();
  });

  it("אין מסלול חינמי — אינה נוגעת במונה כלל", async () => {
    const { service, charge } = serviceWith({ plans: [PAID] });
    expect(await service.createFromVerifiedIdentity({ email: "a@b.co" }, "1.2.3.4")).toBeNull();
    expect(charge).not.toHaveBeenCalled();
  });
});
