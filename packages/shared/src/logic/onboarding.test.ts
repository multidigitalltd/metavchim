import { describe, expect, it } from "vitest";
import { onboardingSteps, type OnboardingFacts } from "./onboarding.js";

const EMPTY: OnboardingFacts = {
  officeProfileComplete: false,
  activeUsers: 1,
  properties: 0,
  buyers: 0,
  leadWebhookConfigured: false,
  whatsappConfigured: false,
  emailDomainVerified: false,
  emailDomainAvailable: true,
  transcriptionAvailable: false,
};

const FULL: OnboardingFacts = {
  officeProfileComplete: true,
  activeUsers: 4,
  properties: 12,
  buyers: 30,
  leadWebhookConfigured: true,
  whatsappConfigured: true,
  emailDomainVerified: true,
  emailDomainAvailable: true,
  transcriptionAvailable: true,
};

describe("onboardingSteps", () => {
  it("משרד חדש — שום צעד לא הושלם", () => {
    const progress = onboardingSteps(EMPTY);
    expect(progress.doneCount).toBe(0);
    expect(progress.percent).toBe(0);
    expect(progress.ready).toBe(false);
  });

  it("משרד מלא — הכל הושלם והבאנר נעלם", () => {
    const progress = onboardingSteps(FULL);
    expect(progress.doneCount).toBe(progress.totalCount);
    expect(progress.percent).toBe(100);
    expect(progress.ready).toBe(true);
    expect(progress.nextStep).toBeUndefined();
  });

  it("מוכנות נקבעת לפי הצעדים החיוניים בלבד", () => {
    // פרטי משרד, נכסים וקונים — בלעדיהם המערכת לא באמת עובדת
    const progress = onboardingSteps({
      ...EMPTY,
      officeProfileComplete: true,
      properties: 1,
      buyers: 1,
    });
    expect(progress.ready).toBe(true);
    // אבל עדיין יש מה להציע
    expect(progress.doneCount).toBeLessThan(progress.totalCount);
    expect(progress.nextStep).toBeDefined();
  });

  it("הצעד הבא הוא הראשון שטרם הושלם", () => {
    expect(onboardingSteps(EMPTY).nextStep?.key).toBe("office_profile");
    expect(onboardingSteps({ ...EMPTY, officeProfileComplete: true }).nextStep?.key).toBe(
      "properties",
    );
  });

  it("הבעלים לבדו אינו נחשב צוות", () => {
    expect(onboardingSteps({ ...EMPTY, activeUsers: 1 }).steps.find((s) => s.key === "team")?.done).toBe(
      false,
    );
    expect(onboardingSteps({ ...EMPTY, activeUsers: 2 }).steps.find((s) => s.key === "team")?.done).toBe(
      true,
    );
  });

  it("לכל צעד יש הסבר וקישור — בלעדיהם הרשימה לא מניעה לפעולה", () => {
    for (const step of onboardingSteps(EMPTY).steps) {
      expect(step.why.length).toBeGreaterThan(20);
      expect(step.href.startsWith("/")).toBe(true);
    }
  });
});

describe("שליחה מהדומיין של המשרד", () => {
  /*
   * ‎**לא חיוני, ובכוונה.** משרד יכול לעבוד במלואו בלי דומיין משלו
   * — המיילים יוצאים מכתובת המערכת — ולכן החסימה של "מוכן" תישאר
   * למה שבלעדיו המערכת באמת לא עובדת. הצעד כאן דוחף, לא חוסם.
   */
  it("הצעד קיים ואינו חיוני", () => {
    const step = onboardingSteps(EMPTY).steps.find((s) => s.key === "email_domain");
    expect(step).toBeDefined();
    expect(step?.essential).toBe(false);
    expect(step?.done).toBe(false);
  });

  it("דומיין מאומת מסמן את הצעד כבוצע", () => {
    const step = onboardingSteps({ ...EMPTY, emailDomainVerified: true }).steps.find(
      (s) => s.key === "email_domain",
    );
    expect(step?.done).toBe(true);
  });

  /*
   * ההסבר עונה על "למה שווה לי", ולא על "מה לעשות" — אותו כלל
   * כמו בשאר הצעדים, והוא מה שמבדיל רשימה שמניעה לפעולה מרשימת
   * מטלות.
   */
  it("ההסבר מדבר על מה שהמשרד מרוויח", () => {
    const step = onboardingSteps(EMPTY).steps.find((s) => s.key === "email_domain");
    expect(step?.why).toContain("הכתובת של המשרד");
    // עוגן ולא ראש המסך — הקישור נוחת על הפקד עצמו
    expect(step?.href).toBe("/settings#email-domain");
  });

  /*
   * ‎**פריסה בלי טוקן חשבון אצל הספק — הצעד נעלם, לא „טרם בוצע”.**
   *
   * נתיב החיבור דוחה שם את הבקשה במפורש, ולכן הצגת הצעד הייתה
   * מפנה את המשרד למסך שאומר „הפיצ'ר אינו מופעל”, ובדרך גם מורידה
   * לו את אחוז ההתקדמות על משהו שאינו בשליטתו (ביקורת Codex).
   */
  it("ספק שאינו מחובר משמיט את הצעד לגמרי", () => {
    const progress = onboardingSteps({ ...EMPTY, emailDomainAvailable: false });
    expect(progress.steps.some((s) => s.key === "email_domain")).toBe(false);
  });

  it("ההשמטה אינה נספרת כצעד שלא בוצע", () => {
    const withStep = onboardingSteps(EMPTY);
    const without = onboardingSteps({ ...EMPTY, emailDomainAvailable: false });
    expect(without.totalCount).toBe(withStep.totalCount - 1);
    expect(without.percent).toBe(0);
  });

  /*
   * ‎**„מוכן” אינו תלוי בצעד הזה בשום כיוון.** הוא אינו חיוני, ולכן
   * גם השמטתו אינה משנה את הבאנר — מי שהשלים את החיוניים מוכן, עם
   * ספק מחובר ובלעדיו.
   */
  it("השמטת הצעד אינה משנה את „מוכן”", () => {
    const full = onboardingSteps(FULL);
    const noProvider = onboardingSteps({ ...FULL, emailDomainAvailable: false });
    expect(noProvider.ready).toBe(full.ready);
    expect(noProvider.percent).toBe(100);
  });
});
