import { describe, expect, it } from "vitest";
import { AGENT_ACTION_IDS, agentAction } from "./actions";
import {
  AGENT_DEGRADED_REASON,
  AGENT_RULE_ACTION_IDS,
  RULE_ACTION_MAP,
  agentDegradedNotice,
} from "./rules-fallback";

/**
 * ‎**מה נאמר למתווך כשמנוע ההבנה נפל.**
 *
 * הכישלון עצמו תקין — יש רצפה דטרמיניסטית, וזו הכוונה. מה שלא היה
 * תקין הוא מה שנאמר עליו: „נסו לנסח אחרת” על בקשה שאף ניסוח לא
 * יצליח בה עד שהספק יחזור, ובוואטסאפ אפילו זה לא נאמר.
 */
describe("הרצפה הדטרמיניסטית", () => {
  it("כל פעולה שהמפה מצביעה עליה קיימת בקטלוג", () => {
    for (const id of Object.values(RULE_ACTION_MAP)) {
      if (id === null) continue;
      expect(agentAction(id), `פעולה שאינה בקטלוג: ${id}`).toBeDefined();
    }
  });

  /*
   * ‎**הרשימה נגזרת ואינה נכתבת.** הבטחה לפעולה שאינה במפה מחזירה
   * את המתווך בדיוק לקיר שממנו ניסינו להוציא אותו.
   */
  it("„מה שכן עובד” הוא בדיוק מה שהמפה מכירה", () => {
    const fromMap = new Set(Object.values(RULE_ACTION_MAP).filter((id) => id !== null));
    expect(new Set(AGENT_RULE_ACTION_IDS)).toEqual(fromMap);
  });

  it("הרצפה מכסה חלק מהקטלוג בלבד — ולכן ההסבר נחוץ", () => {
    expect(AGENT_RULE_ACTION_IDS.length).toBeGreaterThan(0);
    expect(AGENT_RULE_ACTION_IDS.length).toBeLessThan(AGENT_ACTION_IDS.length);
  });

  it("ההודעה פותחת בסיבה ומונה דוגמאות אמיתיות", () => {
    const lines = agentDegradedNotice([...AGENT_ACTION_IDS]);
    expect(lines[0]).toBe(AGENT_DEGRADED_REASON);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(2)) expect(line.startsWith("• ")).toBe(true);
  });

  /*
   * הצעה לפעולה שהמסלול או התפקיד חוסמים היא קיר שני מיד אחרי
   * הראשון — ולכן ההצעות מצטמצמות למה שמותר בפועל.
   */
  it("מוצעות רק פעולות שמותרות למתווך הזה", () => {
    const only = AGENT_RULE_ACTION_IDS[0]!;
    const lines = agentDegradedNotice([only]);
    const title = agentAction(only)!.title;
    expect(lines.filter((l) => l.startsWith("• "))).toHaveLength(1);
    expect(lines.some((l) => l.includes(title))).toBe(true);
  });

  /*
   * ‎**„מה שכן עובד עכשיו:” מעל רשימה ריקה גרוע מכלום.** קורה
   * כשכל מה שהרצפה מכירה חסום למתווך הזה.
   */
  it("בלי פעולות מותרות נאמרת הסיבה בלבד, בלי כותרת ריקה", () => {
    expect(agentDegradedNotice([])).toEqual([AGENT_DEGRADED_REASON]);
  });

  it("מספר הדוגמאות מוגבל — הודעת וואטסאפ אינה רשימה של עשרים", () => {
    const lines = agentDegradedNotice([...AGENT_ACTION_IDS], 3);
    expect(lines.filter((l) => l.startsWith("• ")).length).toBeLessThanOrEqual(3);
  });
});
