import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { AGENT_ACTION_IDS } from "./actions.js";
import { agentNextSteps } from "./next-step.js";

/**
 * ‎**הבדיקה שהקובץ הזה נזקק לה יותר מכול: שהכלל בכלל נפלט.**
 *
 * הגרסה הראשונה של `next-step.ts` נכתבה מול צורות נתונים שהנחתי,
 * ו**שלושה מתוך חמשת הכללים קראו שדות שאינם קיימים**:
 * ‎`createBuyer` אינה מחזירה `data` כלל (רק `ref`), `showTasks`
 * אינה מחזירה `overdue`, ו-`createProperty` אינה מחזירה
 * ‎`missingFields`. כל שלושתם היו „עוברים” בשקט — כלומר קוד מת
 * שנראה כמו תכונה.
 *
 * לכן כל בדיקה כאן אוכפת **פליטה** ולא רק היעדר, ובסוף יש שער
 * שסופר: אם כלל חדש יתווסף ולא ייבדק, המונה יתריע.
 */

const ALL: readonly string[] = AGENT_ACTION_IDS;

/**
 * ‎**דגימה אחת לכל כלל — בצורת הנתונים האמיתית.**
 *
 * כל שורה כאן הועתקה מצורת ה-`data` ש-`AgentExecuteService` מחזירה
 * בפועל לאותה פעולה, ולא מצורה משוערת. זו בדיוק ההבחנה ששלושה
 * כללים מתו עליה בגרסה הראשונה, והשער שמתחת אוכף שאף כלל לא
 * יתווסף בלי שורה כזו.
 */
const FIRING_SAMPLES: Record<string, Parameters<typeof agentNextSteps>[1]> = {
  show_matches: {
    data: { matches: [{ buyerName: "א", score: 90, property: { title: "ג" } }] },
  },
  create_buyer: { ref: { label: "ב", entityType: "buyer" } },
  create_property: { ref: { label: "ג", entityType: "property" } },
  create_lead: { ref: { label: "ד", entityType: "lead" } },
  show_tasks: { data: { tasks: [{ title: "ה", dueAt: "2026-01-01T00:00:00.000Z" }] } },
  find_buyers: { data: { buyers: [{ name: "משה כהן" }] } },
  find_properties: { data: { properties: [{ title: "הדירה ברמת גן" }] } },
  send_offer: { params: { buyerPhrase: "משה כהן" } },
  show_callbacks: { data: { callbacks: [{ name: "דנה לוי", reason: "waiting_lead" }] } },
  show_leads: { data: { leads: [{ name: "יוסי מזרחי" }] } },
  show_exclusivity: {
    data: { exclusivity: [{ propertyTitle: "הדירה בהרב שך", daysLeft: 12, missing: 2 }] },
  },
  show_demands: {
    data: { demands: [{ office: "כהן נכסים", cities: ["גבעתיים"], matchCount: 3 }] },
  },
  show_network_listings: { data: [{ title: "פנטהאוז בנתניה", city: "נתניה" }] },
  show_network_inbox: { data: [{ title: "נכס שהוצע לכם", detail: "הצעת נכס" }] },
  show_emails: { data: { emails: [{ contactName: "שרה לוי", lastSubject: "שאלה" }] } },
  show_offers: { data: { offers: [{ buyerName: "משה כהן", status: "נשלחה" }] } },
  convert_lead: { ref: { label: "דני", entityType: "buyer" } },
  open_deal_room: { data: { id: "d1" } },
  schedule_appointment: { params: { buyerPhrase: "משפחת לוי" } },
};
const NOW = new Date("2026-03-10T12:00:00.000Z");

describe("agentNextSteps — התאמות", () => {
  /* „מה מתאים לדירה ברמת גן” — הנכס הוא השאלה ואינו בשורות */
  const matches = {
    data: {
      matches: [
        { buyerName: "דנה לוי", buyerId: "b1", score: 71 },
        { buyerName: "משה כהן", buyerId: "b2", score: 93 },
      ],
    },
    params: { propertyPhrase: "הדירה ברמת גן" },
  };

  it("מציע לשלוח הצעה לבעל הציון הגבוה, ולא לראשון ברשימה", () => {
    const [step] = agentNextSteps("show_matches", matches, ALL, NOW);
    expect(step?.action).toBe("send_offer");
    expect(step?.params["buyerPhrase"]).toBe("משה כהן");
    expect(step?.text).toContain("93%");
  });

  /*
   * ‎**הנכס נוסע עם הצעד, אחרת ההצעה אינה הצעה.**
   *
   * הגרסה הראשונה נשאה `buyerPhrase` בלבד. „לשלוח הצעה למשה כהן?”
   * פוענח מחדש בלי נכס, ו-`sendOffer` הצטמצם לניווט לכרטיס הקונה —
   * כלומר משפט שאומר „לשלוח” ואינו שולח (ביקורת Codex).
   */
  it("הנכס נכנס גם לפרמטרים וגם למשפט", () => {
    const [step] = agentNextSteps("show_matches", matches, ALL, NOW);
    expect(step?.params["propertyPhrase"]).toBe("הדירה ברמת גן");
    expect(step?.text).toContain("הדירה ברמת גן");
  });

  /* התאמות המשרד — לכל שורה הנכס שלה, ואין ביטוי בשאלה */
  it("בהתאמות המשרד הנכס מגיע מהשורה עצמה", () => {
    const [step] = agentNextSteps(
      "show_matches",
      {
        data: {
          matches: [
            { buyerName: "משה כהן", score: 93, property: { title: "פנטהאוז בנתניה" } },
          ],
        },
      },
      ALL,
      NOW,
    );
    expect(step?.params["propertyPhrase"]).toBe("פנטהאוז בנתניה");
  });

  it("בלי כותרת נופלים לכתובת", () => {
    const [step] = agentNextSteps(
      "show_matches",
      { data: { matches: [{ buyerName: "משה כהן", score: 93, property: { address: "הרב שך 12" } }] } },
      ALL,
      NOW,
    );
    expect(step?.params["propertyPhrase"]).toBe("הרב שך 12");
  });

  /*
   * ‎**ובלי שום נכס — אין צעד.** „לשלוח הצעה” שאינה יכולה לשלוח היא
   * הבטחה שלא תתקיים, וזה גרוע מלא להציע כלום.
   */
  it("אין נכס — אין הצעה", () => {
    expect(
      agentNextSteps(
        "show_matches",
        { data: { matches: [{ buyerName: "משה כהן", score: 93 }] } },
        ALL,
        NOW,
      ),
    ).toEqual([]);
  });

  /*
   * ‎**הכיוון ההפוך אינו סימטרי.** „התאמות לקונה” מחזירה נכסים,
   * ואת שם הקונה אי אפשר לדעת מהשורה. נפילה לשם כלשהו הייתה שולחת
   * הצעה ללקוח שגוי — הכשל היקר ביותר האפשרי כאן.
   */
  it("התאמות שהן נכסים אינן מייצרות הצעה", () => {
    const reverse = { data: { matches: [{ property: { title: "דירה ברמת גן" }, score: 88 }] } };
    expect(agentNextSteps("show_matches", reverse, ALL, NOW)).toEqual([]);
  });

  it("אין התאמות — אין צעד", () => {
    expect(agentNextSteps("show_matches", { data: { matches: [] } }, ALL, NOW)).toEqual([]);
  });

  /*
   * ‎**הסינון לפי הרשאה.** להציע פעולה שהמשתמש חסום ממנה זה לשלוח
   * אותו אל „אין לך הרשאה” על משהו שהסוכן עצמו הציע.
   */
  /*
   * הסינון הוא **פר-צעד**: מי שחסום משליחת הצעות עדיין רשאי לקבוע
   * סיור, והצעד השני של אותה התאמה נשאר. `[]` היה נכון כשהכלל פלט
   * צעד אחד; מרגע שהוא פולט שניים, „הכול נעלם” היה מעניש את הצעד
   * המותר על חסימת חברו.
   */
  it("פעולה שאין אליה הרשאה אינה מוצעת — והשאר נשארות", () => {
    const without = ALL.filter((id) => id !== "send_offer");
    const steps = agentNextSteps("show_matches", matches, without, NOW);
    expect(steps.map((s) => s.action)).toEqual(["schedule_appointment"]);
    // ובלי שתיהן — אין דבר להציע
    const none = ALL.filter((id) => id !== "send_offer" && id !== "schedule_appointment");
    expect(agentNextSteps("show_matches", matches, none, NOW)).toEqual([]);
  });
});

describe("agentNextSteps — יצירה", () => {
  /*
   * ‎**השם מגיע מ-`ref` ולא מ-`data`.** זה בדיוק המקום שבו הגרסה
   * הראשונה קראה `data.buyer.name` — שדה שאינו קיים — והכלל לא
   * נפלט מעולם.
   */
  it("קונה חדש — מציע לראות מה מתאים לו", () => {
    const [step] = agentNextSteps(
      "create_buyer",
      { ref: { label: "רות ישראלי", entityType: "buyer" } },
      ALL,
      NOW,
    );
    expect(step?.action).toBe("show_matches");
    expect(step?.params["buyerPhrase"]).toBe("רות ישראלי");
  });

  it("בלי ref אין שם, ולכן אין צעד", () => {
    expect(agentNextSteps("create_buyer", {}, ALL, NOW)).toEqual([]);
  });

  it("נכס חדש — מציע לפרסם לרשת", () => {
    const [step] = agentNextSteps(
      "create_property",
      { ref: { label: "דירה בהרב שך 12", entityType: "property" } },
      ALL,
      NOW,
    );
    expect(step?.action).toBe("share_property");
    expect(step?.params["propertyPhrase"]).toBe("דירה בהרב שך 12");
  });

  /*
   * ‎`ref` של סוג אחר אינו הנכס שנוצר. `create_property` שהחזירה
   * הפניה למשימה (מסלול שקיים בקוד) לא תיצור הצעת פרסום על שם
   * של משימה.
   */
  it("ref מסוג אחר אינו נחשב", () => {
    const step = agentNextSteps(
      "create_property",
      { ref: { label: "להתקשר לדוד", entityType: "task" } },
      ALL,
      NOW,
    );
    expect(step).toEqual([]);
  });

  /*
   * ‎**הסוג כאן הוא `lead`, ונקרא מהמקור.** הגרסה הראשונה של הבדיקה
   * הזו כתבה `entityType: "buyer"` — צורה ש-`createLead` אינה מחזירה
   * לעולם — והיא „עברה” רק מפני שהכלל לא בדק סוג כלל. שער השלמות
   * למטה לא תפס זאת, כי הוא ניזון מאותה המצאה.
   */
  it("ליד חדש — מציע לקבוע פגישה", () => {
    const [step] = agentNextSteps(
      "create_lead",
      { ref: { label: "שרה מזרחי", entityType: "lead" } },
      ALL,
      NOW,
    );
    expect(step?.action).toBe("schedule_appointment");
    expect(step?.params["buyerPhrase"]).toBe("שרה מזרחי");
  });

  /*
   * ‎**ליד שמוזג לליד של סוכן אחר אינו מחזיר `ref`.** הפגישה שהייתה
   * נקבעת מולו הייתה מצביעה על כרטיס שהשירותים דוחים ב-403.
   */
  it("ליד שאינו גלוי לקולט אינו מייצר צעד", () => {
    expect(agentNextSteps("create_lead", {}, ALL, NOW)).toEqual([]);
  });
});

describe("agentNextSteps — משימות", () => {
  const task = (dueAt: string | undefined, title: string) => ({
    data: { tasks: [{ id: "t1", title, ...(dueAt === undefined ? {} : { dueAt }) }] },
  });

  /*
   * ‎**„באיחור” מחושב מ-`dueAt`, כי אין דגל.** הניסוח הראשון חיפש
   * ‎`overdue: true` שאינו קיים בשום שורה שהשרת מחזיר.
   */
  it("משימה שהמועד שלה עבר — מציע לסגור", () => {
    const [step] = agentNextSteps("show_tasks", task("2026-03-09T08:00:00.000Z", "להתקשר לדוד"), ALL, NOW);
    expect(step?.action).toBe("complete_task");
    expect(step?.params["taskPhrase"]).toBe("להתקשר לדוד");
  });

  it("משימה עתידית אינה עילה לשום דבר", () => {
    expect(agentNextSteps("show_tasks", task("2026-03-11T08:00:00.000Z", "מחר"), ALL, NOW)).toEqual(
      [],
    );
  });

  /*
   * ‎**משימה בלי מועד אינה „באיחור”.** היעדר מועד הוא היעדר מידע,
   * ולא מועד שעבר — אותה הבחנה שחוזרת בכל המערכת הזו.
   */
  it("משימה בלי מועד אינה באיחור", () => {
    expect(agentNextSteps("show_tasks", task(undefined, "מתישהו"), ALL, NOW)).toEqual([]);
  });

  it("מועד פגום אינו נחשב לעבר", () => {
    expect(agentNextSteps("show_tasks", task("לא-תאריך", "פגום"), ALL, NOW)).toEqual([]);
  });
});

describe("שלמות", () => {
  /*
   * ‎**שער על הבדיקה עצמה.** כל כלל בקובץ חייב להיות מיוצג בבדיקה
   * שמאשרת **פליטה**. אם יתווסף כלל שישי ולא תתווסף לו בדיקה,
   * המונה כאן ייפול — במקום שהכלל יישב שם כקוד מת, כפי ששלושה
   * מהם ישבו בגרסה הראשונה.
   */
  it("כל פעולה שיש לה כלל באמת פולטת צעד", () => {
    for (const [action, source] of Object.entries(FIRING_SAMPLES)) {
      expect(agentNextSteps(action, source, ALL, NOW).length, action).toBeGreaterThan(0);
    }
  });

  /*
   * ‎**והשער על השער.** הרשימה שמעליה נכתבת ביד, ולכן כלל חדש היה
   * יכול להתווסף בלי דגימה — בדיוק המצב שהקובץ הזה נולד ממנו.
   * הרשימה נגזרת עכשיו מהמקור עצמו: כל `case` ב-`next-step.ts`
   * חייב דגימה שמוכיחה פליטה.
   */
  it("לכל כלל במקור יש דגימה שמוכיחה שהוא נפלט", () => {
    const source = readFileSync(new URL("./next-step.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");
    const cases = [...source.matchAll(/^\s*case "([a-z_]+)":/gmu)].map((m) => m[1]!);
    expect(cases.length).toBeGreaterThan(10);
    for (const action of cases) {
      expect(Object.keys(FIRING_SAMPLES), `כלל בלי דגימה: ${action}`).toContain(action);
    }
  });

  it("כל צעד מפנה לפעולה שקיימת בקטלוג", () => {
    const [step] = agentNextSteps(
      "show_matches",
      { data: { matches: [{ buyerName: "א", score: 90, property: { title: "ג" } }] } },
      ALL,
      NOW,
    );
    expect(AGENT_ACTION_IDS).toContain(step!.action);
  });

  it("פעולה בלי כלל אינה מייצרת דבר", () => {
    expect(agentNextSteps("office_report", { data: {} }, ALL, NOW)).toEqual([]);
  });
});

describe("agentNextSteps — כפתורים קשורים לתוכן", () => {
  const matches = {
    data: { matches: [{ buyerName: "משה כהן", buyerId: "b2", score: 93 }] },
    params: { propertyPhrase: "הדירה ברמת גן" },
  };

  /*
   * ‎**כל צעד נושא כותרת כפתור.** הצעד נוסע לוואטסאפ ככפתור ולמסך
   * כצ'יפ; צעד בלי `label` הוא משפט בלי כפתור — בדיוק מה שהשדרוג
   * הזה בא להחליף.
   */
  it("לכל צעד יש כותרת כפתור לא-ריקה", () => {
    const sources: [string, Parameters<typeof agentNextSteps>[1]][] = [
      ["show_matches", matches],
      ["create_buyer", { ref: { label: "רות", entityType: "buyer" } }],
      ["create_property", { ref: { label: "דירה בגבעתיים", entityType: "property" } }],
      ["create_lead", { ref: { label: "דנה", entityType: "lead" } }],
      ["find_buyers", { data: { buyers: [{ name: "משה כהן" }] } }],
      ["find_properties", { data: { properties: [{ title: "דופלקס ברעננה" }] } }],
      ["send_offer", { params: { buyerPhrase: "משה כהן" } }],
    ];
    for (const [action, source] of sources) {
      const steps = agentNextSteps(action, source, ALL, NOW);
      expect(steps.length, `${action}: לא נפלט צעד`).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.label.trim(), `${action}: כותרת ריקה`).not.toBe("");
      }
    }
  });

  /*
   * חיפוש שמצא — הצעד על **הראשון שנמצא**, בשם שמוכח מהשורה. רשימה
   * ריקה אינה עילה לדבר.
   */
  it("חיפוש קונים מציע התאמות לראשון, וריק אינו מציע", () => {
    const [step] = agentNextSteps(
      "find_buyers",
      { data: { buyers: [{ name: "משה כהן" }, { name: "דנה לוי" }] } },
      ALL,
      NOW,
    );
    expect(step?.action).toBe("show_matches");
    expect(step?.text).toContain("משה כהן");
    expect(agentNextSteps("find_buyers", { data: { buyers: [] } }, ALL, NOW)).toEqual([]);
  });

  it("חיפוש נכסים נופל לכתובת כשאין כותרת", () => {
    const [step] = agentNextSteps(
      "find_properties",
      { data: { properties: [{ address: "הרצל 12, גבעתיים" }] } },
      ALL,
      NOW,
    );
    expect(step?.action).toBe("show_matches");
    expect(step?.text).toContain("הרצל 12");
  });

  /*
   * הצעה שנשלחה — סיור. הקונה מוכח מהפרמטרים שהפעולה רצה איתם,
   * אותו מקור כמו הנכס ב-`show_matches`.
   */
  it("אחרי שליחת הצעה מוצע סיור עם אותו קונה", () => {
    const [step] = agentNextSteps("send_offer", { params: { buyerPhrase: "משה כהן" } }, ALL, NOW);
    expect(step?.action).toBe("schedule_appointment");
    expect(step?.text).toContain("משה כהן");
    // בלי buyerPhrase אין הוכחה למי — ואין צעד
    expect(agentNextSteps("send_offer", { params: {} }, ALL, NOW)).toEqual([]);
  });

  /* התאמה מוכחת מקבלת שני צעדים — הצעה וסיור — על אותו קונה. */
  it("התאמות מציעות גם הצעה וגם סיור", () => {
    const steps = agentNextSteps("show_matches", matches, ALL, NOW);
    expect(steps.map((s) => s.action)).toEqual(["send_offer", "schedule_appointment"]);
  });
});
