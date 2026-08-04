import { describe, expect, it } from "vitest";
import { onboardingSteps, type OnboardingFacts } from "./onboarding.js";

const EMPTY: OnboardingFacts = {
  officeProfileComplete: false,
  activeUsers: 1,
  properties: 0,
  buyers: 0,
  leadWebhookConfigured: false,
  whatsappConfigured: false,
  transcriptionAvailable: false,
};

const FULL: OnboardingFacts = {
  officeProfileComplete: true,
  activeUsers: 4,
  properties: 12,
  buyers: 30,
  leadWebhookConfigured: true,
  whatsappConfigured: true,
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
