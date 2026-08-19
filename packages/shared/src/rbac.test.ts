import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLE_CAPABILITIES, rolesWithCapability } from "./rbac.js";
import { ASSIGNABLE_ROLES, ROLE_LABELS, UserRoleSchema, roleLabel } from "./schemas/user.js";

/**
 * הגבול של מנהל הסניף הוא ההגדרה שלו.
 *
 * תפקיד שמוגדר ברשימת יכולות נוטה להתרחב בשקט: יכולת חדשה נוספת
 * לקטלוג, מישהו מוסיף אותה לכמה תפקידים, ומנהל סניף מקבל גישה
 * להגדרות המשרד בלי שאיש החליט על זה. הבדיקה כאן נכשלת ברגע שזה
 * קורה, ומחייבת החלטה מפורשת.
 */
const FORBIDDEN_FOR_BRANCH_MANAGER = [
  "settings.manage",
  "users.manage",
  "billing.manage",
  "data.export",
  "audit.view",
  "contacts.delete",
] as const;

describe("תפקיד מנהל הסניף", () => {
  it("אינו נוגע בהגדרות המשרד, בחיוב, בהרשאות, בייצוא, ביומן ובמחיקת לקוח", () => {
    const caps = ROLE_CAPABILITIES.branch_manager ?? [];
    for (const forbidden of FORBIDDEN_FOR_BRANCH_MANAGER) {
      expect(caps).not.toContain(forbidden);
    }
  });

  it("רואה את כל המשרד — אחרת אין הבדל בינו לסוכן", () => {
    const caps = ROLE_CAPABILITIES.branch_manager ?? [];
    expect(caps).toContain("leads.view_all");
    expect(caps).toContain("buyers.view_all");
    expect(caps).toContain("tasks.view_all");
    expect(caps).toContain("analytics.view");
  });

  /*
   * `view_all` ו-`view_own` יחד הם סתירה: הפילטר בשרת נגזר מהראשון,
   * והשני נשאר כהבטחה שאיש אינו מממש. עדיף שלא יהיה שם בכלל.
   */
  it("אינו נושא גם view_own וגם view_all", () => {
    const caps = ROLE_CAPABILITIES.branch_manager ?? [];
    expect(caps).not.toContain("leads.view_own");
    expect(caps).not.toContain("buyers.view_own");
  });
});

describe("שלמות טבלת התפקידים", () => {
  it("לכל תפקיד בסכימה יש יכולות ושם בעברית", () => {
    for (const role of UserRoleSchema.options) {
      expect(ROLE_CAPABILITIES[role], `אין יכולות ל-${role}`).toBeDefined();
      expect(ROLE_LABELS[role], `אין שם עברי ל-${role}`).toBeTruthy();
    }
  });

  it("אין בטבלת היכולות תפקיד שאינו בסכימה", () => {
    const known = new Set<string>(UserRoleSchema.options);
    for (const role of Object.keys(ROLE_CAPABILITIES)) {
      expect(known.has(role), `${role} בטבלת היכולות ואינו בסכימה`).toBe(true);
    }
  });

  it("אין יכולת מומצאת בשום תפקיד", () => {
    const known = new Set<string>(CAPABILITIES);
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      for (const cap of caps) {
        expect(known.has(cap), `${role} מחזיק ביכולת שאינה בקטלוג: ${cap}`).toBe(true);
      }
    }
  });

  /* בעלות נקבעת בהקמת המשרד ואינה נבחרת מרשימה נפתחת */
  it("owner אינו ניתן להקצאה", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(
      UserRoleSchema.options.filter((r) => r !== "owner").sort(),
    );
  });

  it("תפקיד לא מוכר מוצג כקוד ולא נבלע", () => {
    expect(roleLabel("branch_manager")).toBe("מנהל סניף");
    expect(roleLabel("nonesuch")).toBe("nonesuch");
  });
});

describe("rolesWithCapability", () => {
  it("מחזיר את כל מי שהיכולת בברירת המחדל שלו", () => {
    const roles = rolesWithCapability("leads.view_all");
    expect(roles).toContain("owner");
    expect(roles).toContain("admin");
    expect(roles).toContain("branch_manager");
    expect(roles).not.toContain("agent");
  });

  /*
   * זו הנקודה שבשבילה הפונקציה נכתבה: הרשימה הכתובה ביד
   * `["owner","admin"]` הייתה משאירה את מנהל הסניף בלי ההתראה על
   * ליד שרק הוא ועמיתיו רואים.
   */
  it("יכולת של ההנהלה בלבד אינה מגיעה לסוכן", () => {
    expect(rolesWithCapability("settings.manage")).toEqual(["owner", "admin"]);
  });
});
