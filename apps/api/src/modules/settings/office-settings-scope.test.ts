import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentAction } from "@metavchim/shared";

/**
 * ‎**הגדרות המשרד מהשיחה — מה עובר, ומה נשאר במסך.**
 *
 * ## ‏מסלול כתיבה אחד
 *
 * ‎`settings` הוא מסמך JSON אחד, ולכן עדכון של שדה בודד הוא קריאה
 * ‏של הכול וכתיבה של הכול בחזרה. ארבעה כללים תלויים בכך שזה קורה
 * ‏במקום אחד: הנעילה על שורת המשרד, מחיקת המפתח במקום שמירת ריק,
 * ‏וחותמת ההפעלה של ההצעות האוטומטיות יחד עם הסמן שלה. מסלול שני
 * ‏היה מדלג על ארבעתם **בלי שגיאה** — ובמקרה של ההצעות, מפציץ את
 * ‏כל ההיסטוריה של המשרד.
 *
 * ## ‏ומה במכוון אינו בקטלוג
 *
 * ‏דמי התיווך, מועד התשלום ומספר הרישיון הם טקסט חופשי ש**נכנס
 * ‏להסכם חתום**. הכתבה של „שני אחוז פלוס מע״מ” לשדה שמודפס במסמך
 * ‏משפטי, בלי לראות את המסמך, אינה דבר שצריך לקרות מטלפון.
 */

const DIR = import.meta.dirname;
const SERVICE = readFileSync(join(DIR, "office-settings.service.ts"), "utf8");
const CONTROLLER = readFileSync(join(DIR, "settings.controller.ts"), "utf8");
const EXECUTOR = readFileSync(join(DIR, "..", "agent", "execute.service.ts"), "utf8");

describe("הכתיבה במקום אחד", () => {
  /*
   * ‏ארבעת הכללים, כל אחד בשמו: שער על „הקובץ מכיל משהו” היה עובר
   * ‏גם על גרסה שאיבדה שלושה מהם.
   */
  it.each([
    ["נעילת שורת המשרד", "lockTenantRow"],
    ["מחיקה במקום שמירת ריק", 'delete settings[field]'],
    ["חותמת ההפעלה של ההצעות", 'settings["autoEmailOffersSince"]'],
    ["הסמן שנמחק איתה", 'delete settings["autoEmailOffersCursor"]'],
  ])("%s יושב בשירות", (_label, needle) => {
    expect(SERVICE).toContain(needle);
  });

  /* ‏והבקר מאציל — אין בו עותק שני של הלולאה */
  it("הבקר אינו כותב ל-settings בעצמו", () => {
    const at = CONTROLLER.indexOf("async updateTenant(");
    expect(at).toBeGreaterThan(-1);
    const body = CONTROLLER.slice(at, CONTROLLER.indexOf("\n  }\n", at));
    expect(body).toContain("this.officeSettings.update(");
    expect(body).not.toContain("lockTenantRow");
    expect(body).not.toContain("tx.tenant.update");
  });

  /* ‏וגם הסוכן — אותו שירות, ולא כתיבה ישירה */
  it("הסוכן כותב דרך אותו שירות", () => {
    const at = EXECUTOR.indexOf("private async updateOfficePolicy(");
    expect(at).toBeGreaterThan(-1);
    const body = EXECUTOR.slice(at, EXECUTOR.indexOf("\n  }\n", at));
    expect(body).toContain("this.officeSettings.update(");
    expect(body).not.toContain("tenant.update");
  });
});

describe("מה הסוכן רשאי לשנות", () => {
  const policy = agentAction("update_office_policy");

  it("הפעולה קיימת ודורשת את היכולת של המסך", () => {
    expect(policy).toBeDefined();
    expect(policy?.capability).toBe("settings.manage");
    expect(policy?.risk).toBe("update");
  });

  /*
   * ‎**שלושת המתגים, ולא יותר.** שדה טקסט חופשי שיתווסף כאן יגיע
   * ‏להסכם חתום דרך הכתבה קולית, ולכן הוא צריך להיתקל בבדיקה הזו
   * ‏ולהסביר את עצמו.
   */
  it("שלושה מתגים בוליאניים בלבד", () => {
    const keys = policy?.fields.map((f) => f.key) ?? [];
    expect(keys).toEqual(["policyKey", "policyState"]);
    const values = policy?.fields.find((f) => f.key === "policyKey")?.values ?? [];
    expect([...values]).toEqual([
      "autoShareProperties",
      "autoShareBuyers",
      "autoEmailOffers",
    ]);
  });

  /*
   * ‎**והשמות הם השדות האמיתיים.** ערך בקטלוג שאינו מפתח בסכימה
   * ‏היה נשמר תחת שם שאיש אינו קורא — מתג שנראה כאילו נדלק ואינו
   * ‏משנה דבר.
   */
  it("כל ערך בקטלוג הוא שדה אמיתי בסכימה", () => {
    const values = agentAction("update_office_policy")?.fields[0]?.values ?? [];
    for (const key of values) {
      expect(SERVICE, `${key} אינו בסכימה`).toContain(`${key}: z.boolean().optional()`);
    }
  });

  /* ‏הקריאה — אותה יכולת, כי דמי התיווך הם מידע מסחרי של המשרד */
  it("גם הקריאה דורשת את יכולת ההגדרות", () => {
    expect(agentAction("show_office_settings")?.capability).toBe("settings.manage");
    expect(agentAction("show_office_settings")?.risk).toBe("read");
  });

  /*
   * ‎**מה שאינו בקטלוג.** הטקסט החופשי שנכנס להסכמים נקרא מהשיחה
   * ‏ונערך במסך בלבד.
   */
  it.each(["defaultCommission", "defaultPaymentTerms", "licenseNumber", "officeAddress"])(
    "%s אינו ניתן לשינוי מהשיחה",
    (field) => {
      const at = EXECUTOR.indexOf("private async updateOfficePolicy(");
      const body = EXECUTOR.slice(at, EXECUTOR.indexOf("\n  }\n", at));
      expect(body, `${field} הגיע למסלול הכתיבה של הסוכן`).not.toContain(field);
    },
  );
});
