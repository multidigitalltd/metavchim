import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { AGENT_ACTIONS, type Capability } from "@metavchim/shared";
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
