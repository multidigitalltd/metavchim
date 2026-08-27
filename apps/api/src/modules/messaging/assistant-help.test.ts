import { describe, expect, it } from "vitest";
import { AGENT_ACTION_IDS } from "@metavchim/shared";
import { HELP_GROUP_IDS, helpMenu, welcomeExamples, type HelpAction } from "./assistant-help";
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

describe("welcomeExamples", () => {
  it("מלמד רק פקודות שמותרות למשתמש", () => {
    // צפייה בלבד: אסור שההכרות תלמד „תוסיף קונה” שייחסם לו
    const viewer = [action("find_buyers", "חיפוש קונים", "מי מחפש בגבעתיים")];
    expect(welcomeExamples(viewer)).toEqual(["מי מחפש בגבעתיים"]);
  });

  it("מגוון בין שאלה, הוספה ומבט על היום — עד שלוש", () => {
    const examples = welcomeExamples([
      action("show_tasks", "משימות", "מה המשימות שלי"),
      action("create_buyer", "קונה חדש", "תוסיף קונה משה"),
      action("find_buyers", "חיפוש קונים", "מי מחפש בגבעתיים"),
      action("show_schedule", "יומן", "מה יש לי מחר"),
    ]);
    expect(examples).toEqual(["מי מחפש בגבעתיים", "תוסיף קונה משה", "מה יש לי מחר"]);
  });

  it("משתמש גם בפעולה שאינה ברשימת ההעדפה כשאין אחרת", () => {
    expect(welcomeExamples([action("share_buyer", "שיתוף", "תשתף את משה לרשת")])).toEqual([
      "תשתף את משה לרשת",
    ]);
  });

  it("מחזיר ריק כשאין פעולות — ההכרות מסתדרת בלי דוגמאות", () => {
    expect(welcomeExamples([])).toEqual([]);
  });
});

/**
 * ‎**התפריט הוא רשימה מקבילה לקטלוג, ולכן הוא נטה ממנו.**
 *
 * שש פעולות קיימות לא הופיעו בו כלל — „מי צריך שיחה חוזרת”, „הכרטיס
 * של”, „תשמיע לי”, קישור החתימה, הבלעדיות ותיעוד פעולת השיווק. הן
 * עבדו בפועל, אבל מי ששאל את הסוכן „מה אתה יודע לעשות” קיבל תשובה
 * שאינה כוללת אותן — בתפריט שכל תכליתו לענות בדיוק על זה.
 *
 * הבדיקה הקודמת אכפה את ההתנהגות ההפוכה („פעולה שאינה בשום קבוצה
 * לא תשבור את התפריט”), וזה נכון — היא לא אמורה לקרוס. אבל שקט
 * בזמן ריצה אינו אותו דבר כמו שקט בבנייה.
 */
describe("כיסוי התפריט", () => {
  it("כל פעולה בקטלוג משובצת לקבוצה", () => {
    const missing = AGENT_ACTION_IDS.filter((id) => !HELP_GROUP_IDS.includes(id));
    expect(missing).toEqual([]);
  });

  /*
   * הכיוון ההפוך: מזהה שנשאר בקבוצה אחרי שהפעולה הוסרה מהקטלוג הוא
   * שורה מתה שנראית כמו כיסוי.
   */
  it("אין בקבוצות מזהה שאינו בקטלוג", () => {
    const unknown = HELP_GROUP_IDS.filter((id) => !AGENT_ACTION_IDS.includes(id as never));
    expect(unknown).toEqual([]);
  });

  it("אין פעולה שמופיעה בשתי קבוצות", () => {
    expect(HELP_GROUP_IDS).toEqual([...new Set(HELP_GROUP_IDS)]);
  });
});
