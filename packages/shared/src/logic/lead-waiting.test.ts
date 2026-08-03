import { describe, expect, it } from "vitest";
import { compareLeadsByUrgency, leadWaiting } from "./lead-waiting.js";

const NOW = new Date("2026-03-10T12:00:00Z");

function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe("leadWaiting", () => {
  it("לא ממהר כשהכדור לא אצל המתווך", () => {
    expect(leadWaiting(ago(100), "waiting_customer", NOW)).toBeNull();
    expect(leadWaiting(ago(100), "converted", NOW)).toBeNull();
    expect(leadWaiting(ago(100), "closed", NOW)).toBeNull();
  });

  it("מסמן חריגה מה-KPI של 24 שעות", () => {
    expect(leadWaiting(ago(23), "new", NOW)?.level).toBe("warn");
    expect(leadWaiting(ago(24), "new", NOW)?.level).toBe("late");
    expect(leadWaiting(ago(72), "in_progress", NOW)?.level).toBe("late");
  });

  it("ליד טרי אינו מסומן כדחוף", () => {
    expect(leadWaiting(ago(0.5), "new", NOW)?.level).toBe("ok");
    expect(leadWaiting(ago(4), "new", NOW)?.level).toBe("warn");
  });

  it("מנסח בעברית תקנית, כולל צורת זוגי", () => {
    expect(leadWaiting(ago(1), "new", NOW)?.label).toBe("ממתין שעה");
    expect(leadWaiting(ago(2), "new", NOW)?.label).toBe("ממתין שעתיים");
    expect(leadWaiting(ago(5), "new", NOW)?.label).toBe("ממתין 5 שעות");
    expect(leadWaiting(ago(24), "new", NOW)?.label).toBe("ממתין יום");
    expect(leadWaiting(ago(48), "new", NOW)?.label).toBe("ממתין יומיים");
    expect(leadWaiting(ago(72), "new", NOW)?.label).toBe("ממתין 3 ימים");
  });

  it("מתחת לשעה מנסח בדקות, ולא מציג אפס", () => {
    expect(leadWaiting(ago(0.5), "new", NOW)?.label).toBe("ממתין 30 דקות");
    expect(leadWaiting(ago(1 / 60), "new", NOW)?.label).toBe("ממתין דקה");
    expect(leadWaiting(NOW, "new", NOW)?.label).toBe("ממתין דקה");
  });

  it("שעון לא מסונכרן לא מייצר זמן שלילי", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000);
    const result = leadWaiting(future, "new", NOW);
    expect(result?.hours).toBe(0);
    expect(result?.level).toBe("ok");
  });

  it("מקבל גם מחרוזת ISO מה-API", () => {
    expect(leadWaiting(ago(48).toISOString(), "new", NOW)?.label).toBe("ממתין יומיים");
  });
});

describe("compareLeadsByUrgency", () => {
  it("דורש טיפול אנושי תמיד ראשון", () => {
    const urgent = { requiresHuman: true, createdAt: ago(1) };
    const old = { requiresHuman: false, createdAt: ago(200) };
    expect([old, urgent].sort(compareLeadsByUrgency)[0]).toBe(urgent);
  });

  it("בתוך אותה קבוצה — הוותיק ביותר קודם", () => {
    const older = { requiresHuman: false, createdAt: ago(50) };
    const newer = { requiresHuman: false, createdAt: ago(2) };
    expect([newer, older].sort(compareLeadsByUrgency)[0]).toBe(older);
  });
});
