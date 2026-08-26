import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, agentAction } from "@metavchim/shared";
import { requiresExplicitChoice } from "./resolve.service";

/**
 * ‎**הכלל של הפעולות היוצאות, כבדיקה ולא כהערה.**
 *
 * קטלוג הפעולות מצהיר: „`outbound` דורש גם בחירה מפורשת של הנמען
 * שזוהה. פעולה שיוצאת ללקוח אינה יכולה לקרות מדיבור בטעות.”
 *
 * ההצהרה חיה עד כה בהערה, והאכיפה בטבלה נפרדת (`ENTITY_LOOKUP`)
 * שאיש אינו מחויב לעדכן. פעולה יוצאת חדשה — למשל קישור חתימה על
 * מסמך משפטי — שנוספה בלי `alwaysChoose` הייתה בוחרת נמען
 * אוטומטית כשיש התאמה יחידה, ושום דבר לא היה אומר זאת.
 *
 * הבדיקה עוברת על **כל** הקטלוג, ולכן אינה יכולה להתיישן.
 */
describe("פעולות שיוצאות אל מחוץ למשרד", () => {
  const outbound = AGENT_ACTIONS.filter((action) => action.risk === "outbound");

  it("יש כאלה בקטלוג — אחרת הבדיקה ריקה", () => {
    expect(outbound.length).toBeGreaterThan(0);
  });

  it.each(outbound.map((action) => [action.id] as const))(
    "%s דורשת בחירה מפורשת של הנמען",
    (actionId) => {
      expect(requiresExplicitChoice(actionId)).toBe(true);
    },
  );

  /*
   * הצד השני: הדגל אינו „דלוק לכולם”. בלעדיו הבדיקה שמעליו הייתה
   * עוברת גם אילו כל פעולה במערכת דרשה בחירה — כלומר מאשרת נוהג
   * ולא כלל.
   */
  it("פעולה שאינה יוצאת אינה נגררת לכלל", () => {
    expect(requiresExplicitChoice("update_buyer")).toBe(false);
    expect(requiresExplicitChoice("create_task")).toBe(false);
  });

  /*
   * ‎`send_agreement` מייצרת קישור חתימה על מסמך משפטי, ולכן היא
   * חייבת להיות `outbound` ולא `create`: ההבדל אינו סמנטי אלא
   * ההבדל בין „נבחר אוטומטית כי יש רק שרה אחת” לבין בורר.
   */
  it("קישור החתימה מסווג כפעולה יוצאת", () => {
    expect(agentAction("send_agreement")?.risk).toBe("outbound");
    expect(agentAction("send_agreement")?.capability).toBe("offers.send");
  });
});
