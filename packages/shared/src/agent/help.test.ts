import { describe, expect, it } from "vitest";
import { AGENT_ACTION_IDS } from "./actions";
import { AGENT_HELP_GROUP_IDS, agentHelpGroups, agentWelcomeExamples } from "./help";

/**
 * ‎**התפריט הוא רשימה מקבילה לקטלוג, ולכן הוא נטה ממנו.**
 *
 * שש פעולות קיימות לא הופיעו בו כלל — „מי צריך שיחה חוזרת”, „הכרטיס
 * של”, „תשמיע לי”, קישור החתימה, הבלעדיות ותיעוד פעולת השיווק. הן
 * עבדו בפועל, אבל מי ששאל את הסוכן „מה את יודעת לעשות” קיבל תשובה
 * שאינה כוללת אותן — בתפריט שכל תכליתו לענות בדיוק על זה.
 *
 * ‎**והבדיקה יושבת כאן ולא במודול הוואטסאפ**, כי החלוקה כבר אינה
 * שלו: אותן קבוצות מרונדרות גם במסך. כשהן ישבו בתוך `messaging`,
 * הצ'אט במסך הציג שש דוגמאות קבועות מתוך שבעים ושתיים פעולות ולא
 * הייתה שום דרך לגלות ממנו את השאר.
 */
describe("כיסוי התפריט", () => {
  it("כל פעולה בקטלוג משובצת לקבוצה", () => {
    const missing = AGENT_ACTION_IDS.filter((id) => !AGENT_HELP_GROUP_IDS.includes(id));
    expect(missing).toEqual([]);
  });

  /*
   * הכיוון ההפוך: מזהה שנשאר בקבוצה אחרי שהפעולה הוסרה מהקטלוג הוא
   * שורה מתה שנראית כמו כיסוי.
   */
  it("אין בקבוצות מזהה שאינו בקטלוג", () => {
    const unknown = AGENT_HELP_GROUP_IDS.filter((id) => !AGENT_ACTION_IDS.includes(id as never));
    expect(unknown).toEqual([]);
  });

  it("אין פעולה שמופיעה בשתי קבוצות", () => {
    expect(AGENT_HELP_GROUP_IDS).toEqual([...new Set(AGENT_HELP_GROUP_IDS)]);
  });
});

describe("agentHelpGroups", () => {
  it("מציג רק את מה שמותר, ומשמיט קבוצה שנשארה ריקה", () => {
    const groups = agentHelpGroups(["find_buyers"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("לשאול על המאגר");
    expect(groups[0]?.actions.map((a) => a.id)).toEqual(["find_buyers"]);
  });

  /* הכותרת והדוגמה נגזרות מהקטלוג — לא מועברות פנימה ולא ניתנות לזיוף */
  it("הכותרת והדוגמה מגיעות מהקטלוג", () => {
    const [group] = agentHelpGroups(["create_task"]);
    const action = group?.actions[0];
    expect(action?.title).not.toBe("");
    expect(action?.example).toBeTypeOf("string");
  });

  it("מזהה שאינו בקטלוג אינו מייצר שורה", () => {
    expect(agentHelpGroups(["אין_כזו"])).toEqual([]);
  });

  it("בלי הרשאות — אין קבוצות", () => {
    expect(agentHelpGroups([])).toEqual([]);
  });

  /* הרשימה המלאה עדיין נשלטת: כל 72 מותרות ⟵ כל הקבוצות מוצגות */
  it("עם כל ההרשאות — כל הקבוצות מוצגות וכל פעולה מופיעה פעם אחת", () => {
    const groups = agentHelpGroups([...AGENT_ACTION_IDS]);
    const shown = groups.flatMap((group) => group.actions.map((action) => action.id));
    expect(shown).toHaveLength(AGENT_ACTION_IDS.length);
    expect(new Set(shown).size).toBe(AGENT_ACTION_IDS.length);
  });
});

describe("agentWelcomeExamples", () => {
  it("מלמד רק פקודות שמותרות למשתמש", () => {
    // צפייה בלבד: אסור שההכרות תלמד „תוסיף קונה” שייחסם לו
    const examples = agentWelcomeExamples(["find_buyers"], 3);
    expect(examples).toHaveLength(1);
  });

  it("מגוון בין שאלה, הוספה ומבט על היום — לפי סדר ההעדפה", () => {
    const ids = ["show_tasks", "create_buyer", "find_buyers", "show_schedule"];
    const examples = agentWelcomeExamples(ids, 3);
    const preferredOrder = ["find_buyers", "create_buyer", "show_schedule"].map(
      (id) => agentHelpGroups([id])[0]?.actions[0]?.example,
    );
    expect(examples).toEqual(preferredOrder);
  });

  it("משתמש גם בפעולה שאינה ברשימת ההעדפה כשאין אחרת", () => {
    expect(agentWelcomeExamples(["share_buyer"], 3)).toHaveLength(1);
  });

  it("מחזיר ריק כשאין פעולות — ההכרות מסתדרת בלי דוגמאות", () => {
    expect(agentWelcomeExamples([], 3)).toEqual([]);
  });

  /*
   * ‎**הכמות היא של הקורא, לא של הפונקציה.** הוואטסאפ מציג שלוש
   * והמסך שש; קודם היו שתי רשימות העדפה נפרדות שנטו זו מזו בשקט.
   */
  it("מכבד את הכמות שהקורא ביקש", () => {
    expect(agentWelcomeExamples([...AGENT_ACTION_IDS], 3)).toHaveLength(3);
    expect(agentWelcomeExamples([...AGENT_ACTION_IDS], 6)).toHaveLength(6);
  });
});
