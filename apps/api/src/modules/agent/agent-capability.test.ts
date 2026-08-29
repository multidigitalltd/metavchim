import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { AGENT_ACTIONS, agentAction, type Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentExecuteService } from "./execute.service";

/**
 * השער של הסוכן — נבדק בהתנהגות, לא רק במבנה.
 *
 * ## למה זה לא מספיק ש-`@RequireCapability` יושב על הנתיב
 *
 * היכולת שהנתיב מצהיר עליה היא של **הנתיב** (`/agent/execute`), לא
 * של הפעולה שבתוכו. הפעולה נבחרת מגוף הבקשה, ולכן משתמש עם
 * `properties.view` בלבד יעבור את שומר הנתיב וינסה לבצע
 * `update_property` — אלא אם מישהו בודק את זה בפנים.
 *
 * הבדיקה רצה על **כל** פעולה בקטלוג, ולכן פעולה שתתווסף מחר בלי
 * בדיקת יכולת תפיל אותה. זה מה שהופך את הכלל לכלל ולא להערה.
 */

/** ההרצה אינה מגיעה למסד — הבדיקה נעצרת בשער, וזו כל הנקודה. */
const service = new AgentExecuteService(
  ...(Array.from({ length: 7 }, () => ({})) as unknown as ConstructorParameters<
    typeof AgentExecuteService
  >),
);

function withCapabilities<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01USER",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

describe("שער היכולות של הסוכן", () => {
  it.each(AGENT_ACTIONS.map((action) => [action.id, action.capability] as const))(
    "%s נחסמת בלי %s",
    async (actionId) => {
      await expect(
        withCapabilities([], () => service.execute(actionId, {})),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  /*
   * הצד השני של אותה בדיקה: יכולת של פעולה אחרת אינה פותחת את זו.
   * בלעדיו „נחסמת בלי היכולת” הייתה עוברת גם אם הקוד חוסם את הכול
   * תמיד — כלומר בדיקה שמאשרת שער סגור ולא שער נכון.
   */
  it("יכולת של פעולה אחרת אינה פותחת פעולה", async () => {
    await expect(
      withCapabilities(["properties.view"], () => service.execute("update_property", {})),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("עם היכולת הנכונה — עוברים את השער וממשיכים לוולידציה", async () => {
    await expect(
      withCapabilities(["properties.edit"], () => service.execute("update_property", {})),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it("פעולה שאינה בקטלוג נדחית", async () => {
    await expect(
      withCapabilities(["properties.view"], () => service.execute("delete_everything", {})),
    ).rejects.toThrow();
  });
});

/**
 * ‎**זכאות המסלול — הסוכן אינו עובר בבקרים.**
 *
 * ‎`@RequireFeature` יושב על הבקר, והסוכן קורא לשירותים ישירות.
 * לכן כל פעולה שנוגעת ביכולת מתומחרת חייבת להצהיר `feature`,
 * והאכיפה חייבת להיות **אחת** — בביצוע, לצד בדיקת היכולת.
 *
 * בלי זה: „מה כדאי לי היום” ו„דף נחיתה” נפתחו למשרד שהמסלול שלו
 * אינו כולל אותם בזמן שהמסך המקביל חסם (ביקורת Codex), ו„דוח
 * המשרד” עשה זאת עוד קודם. בדיקה שסופרת פעולות לא הייתה תופסת
 * את זה — מה שנתפס הוא **מקום** האכיפה.
 */
describe("זכאות המסלול בסוכן", () => {
  const source = readFileSync(new URL("./execute.service.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

  it("האכיפה יושבת בביצוע המרכזי, על מה שהקטלוג מצהיר", () => {
    expect(source).toContain("if (action.feature !== undefined) {");
    expect(source).toContain("this.plans.tenantHasFeature(ctx.tenantId, action.feature)");
  });

  /*
   * ‎**ואין בדיקה שנייה במתודה.** בדיקה מקומית נראית זהירה ומזיקה:
   * היא מסתירה את החסר: פעולה שלישית תתווסף, מישהו יעתיק את הדפוס
   * המקומי לחלקן, והשער המרכזי כבר לא יהיה מקור האמת.
   */
  it("אין בדיקת פיצ'ר מפוזרת במתודות", () => {
    const calls = source.match(/tenantHasFeature\(/gu) ?? [];
    expect(calls).toHaveLength(1);
  });

  /*
   * הפעולות שידוע שהבקר המקביל שלהן חוסם — הצהרה חסרה כאן היא
   * בדיוק הפער שנסגר, ולכן היא נבדקת בשם ולא רק במבנה.
   */
  it.each([
    ["show_recommendations", "ai_coach"],
    ["office_report", "analytics"],
    ["agent_report", "analytics"],
    ["create_landing_page", "landing_pages"],
    ["send_owner_update", "whatsapp"],
    ["create_recurring_task", "automations"],
    ["call_contact", "telephony"],
  ])("%s מצהירה על הפיצ'ר %s", (actionId, feature) => {
    expect(agentAction(actionId)?.feature).toBe(feature);
  });
});
