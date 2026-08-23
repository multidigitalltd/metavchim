import { describe, expect, it } from "vitest";
import { helpMenu, type HelpAction } from "./assistant-help";
import { isHelpMessage } from "./assistant-lang";

const action = (id: string, title: string, example: string): HelpAction => ({
  id,
  title,
  risk: "read",
  examples: [example],
});

describe("isHelpMessage", () => {
  it("מזהה בקשת תפריט על משפט שלם", () => {
    expect(isHelpMessage("עזרה")).toBe(true);
    expect(isHelpMessage(" עזרה! ")).toBe(true);
    expect(isHelpMessage("מה אתה יודע לעשות?")).toBe(true);
    expect(isHelpMessage("help")).toBe(true);
  });

  it("אינו חוטף משפט שרק מכיל את המילה", () => {
    expect(isHelpMessage("עזרה עם הקונה של אתמול")).toBe(false);
    expect(isHelpMessage("תפריט לפגישה מחר")).toBe(false);
  });
});

describe("helpMenu", () => {
  const actions = [
    action("find_buyers", "חיפוש קונים", "מי מחפש 4 חדרים בגבעתיים"),
    action("show_schedule", "היומן שלי", "מה יש לי מחר"),
    action("create_buyer", "קונה חדש", "תוסיף קונה משה לוי"),
  ];

  it("פונה בשם ומציג רק את הפעולות שהועברו", () => {
    const menu = helpMenu(actions, "דוד");
    expect(menu.startsWith("דוד,")).toBe(true);
    expect(menu).toContain("חיפוש קונים");
    expect(menu).toContain("היומן שלי");
    expect(menu).toContain("קונה חדש");
    // קבוצה שאין בה פעולה מותרת אינה מוצגת כלל
    expect(menu).not.toContain("רשת השיתופים");
  });

  it("מציג דוגמאות אמיתיות מהקטלוג", () => {
    expect(helpMenu(actions)).toContain("מי מחפש 4 חדרים בגבעתיים");
  });

  it("אומר שאין הרשאות במקום להציג תפריט ריק", () => {
    expect(helpMenu([])).toContain("אין לך הרשאות");
  });

  it("מתעלם מפעולה שאינה בשום קבוצה — בלי לשבור את התפריט", () => {
    const menu = helpMenu([action("unknown_future_action", "משהו חדש", "דוגמה")]);
    expect(menu).toContain("אין לך הרשאות");
  });
});
