import { readFileSync } from "node:fs";

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

  /*
   * ‎**„נסחו אחרת” מוחלף, ואינו מוקדם להסבר.**
   *
   * שום ניסוח לא יצליח עד שהספק יחזור, ולכן ההוראה הזו מיד לפני
   * ההסבר על התקלה היא בדיוק הקיר שההסבר בא לפרק. הוואטסאפ מחליף
   * מלכתחילה; המסך היה מוסיף (ביקורת Codex).
   */
  it("שני הערוצים מחליפים את „נסחו אחרת” ואינם מוסיפים לו", () => {
    const read = (relative: string): string =>
      readFileSync(new URL(relative, import.meta.url), "utf8");
    const WEB = read("../../../../apps/web/src/app/voice/page.tsx");
    const WA = read(
      "../../../../apps/api/src/modules/messaging/whatsapp-assistant.service.ts",
    );
    expect(WEB).toMatch(/proposal\.degraded\.length > 0\s*\?\s*proposal\.degraded/u);
    expect(WA).toMatch(/proposal\.degraded\.length > 0 \? \[\.\.\.proposal\.degraded\] : \[clarify\]/u);
  });

  /*
   * ‎**הרשאה אינה זכאות.** פעולה יכולה לדרוש תכונה במסלול, והביצוע
   * דוחה בלעדיה — כלומר הבטחה שלה ברשימה היא קיר שני.
   */
  it("הרשימה מסוננת גם לפי תכונות המסלול, ולא רק לפי תפקיד", () => {
    const RESOLVE = readFileSync(
      new URL("../../../../apps/api/src/modules/agent/resolve.service.ts", import.meta.url),
      "utf8",
    );
    const fn = RESOLVE.slice(
      RESOLVE.indexOf("private async allowedActionIds()"),
      RESOLVE.indexOf(".map((a) => a.id);", RESOLVE.indexOf("private async allowedActionIds()")),
    );
    expect(fn).toContain("mayUseAction");
    expect(fn).toContain("tenantHasFeature");
  });

  it("מספר הדוגמאות מוגבל — הודעת וואטסאפ אינה רשימה של עשרים", () => {
    const lines = agentDegradedNotice([...AGENT_ACTION_IDS], 3);
    expect(lines.filter((l) => l.startsWith("• ")).length).toBeLessThanOrEqual(3);
  });
});
