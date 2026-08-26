import { describe, expect, it } from "vitest";
import {
  AGENT_RESULT_ROWS,
  agentTurnRefs,
  assistantMemoryTurn,
  historyRefs,
  matchHistoryRef,
} from "./history.js";
import { buildInterpretPrompt, type AgentHistoryRef, type AgentHistoryTurn } from "./prompt.js";

const LEAD_ID = "01J0000000000000000000LEAD";
const PROP_ID = "01J0000000000000000000PROP";

describe("assistantMemoryTurn", () => {
  it("הופך התראת שיחה שלא נענתה לתור של הסוכן עם הפניה לליד", () => {
    const turn = assistantMemoryTurn([
      { type: "call_missed", entityType: "lead", entityId: LEAD_ID },
    ]);
    expect(turn?.origin).toBe("assistant");
    expect(turn?.transcript).toBe("עדכנתי אותך על שיחה נכנסת שלא נענתה");
    expect(turn?.refs).toEqual([
      { label: "הליד מהעדכון", entityType: "lead", entityId: LEAD_ID },
    ]);
  });

  it("מאחד כמה התראות בהודעה אחת לתור אחד", () => {
    const turn = assistantMemoryTurn([
      { type: "call_missed", entityType: "lead", entityId: LEAD_ID },
      { type: "property", entityType: "property", entityId: PROP_ID },
    ]);
    expect(turn?.transcript).toBe(
      "עדכנתי אותך על שיחה נכנסת שלא נענתה, עדכנתי אותך על נכס חדש",
    );
    expect(turn?.refs?.map((ref) => ref.entityType)).toEqual(["lead", "property"]);
  });

  it("אינו חוזר על אותו משפט כששתי התראות מאותו סוג", () => {
    const turn = assistantMemoryTurn([
      { type: "call_missed", entityType: "lead", entityId: LEAD_ID },
      { type: "call_missed", entityType: "lead", entityId: `${LEAD_ID}2` },
    ]);
    expect(turn?.transcript).toBe("עדכנתי אותך על שיחה נכנסת שלא נענתה");
    // שתי רשומות שונות — שתי תוויות, ולכן ממוספרות
    expect(turn?.refs?.map((ref) => ref.label)).toEqual([
      "הליד מהעדכון 1",
      "הליד מהעדכון 2",
    ]);
  });

  it("שומר את הזיכרון בלי הפניה כשההתראה מצביעה על איש קשר", () => {
    /*
     * `contact` אינו סוג שהקוד יודע לפתור אליו ביטוי, ותווית שתוביל
     * לשם הייתה נכשלת בשקט. הזיכרון עצמו כן נשמר — הסוכן יודע שהוא
     * עדכן, ויבקש שם.
     */
    const turn = assistantMemoryTurn([
      { type: "incoming_call", entityType: "contact", entityId: LEAD_ID },
    ]);
    expect(turn?.transcript).toBe("עדכנתי אותך על שיחה נכנסת");
    expect(turn?.refs).toBeUndefined();
  });

  it("מתעלם מסוג התראה שאין לו ניסוח — ולא כותב תור ריק", () => {
    expect(assistantMemoryTurn([{ type: "weekly_summary", entityType: null, entityId: null }])).toBe(
      null,
    );
  });
});

describe("matchHistoryRef", () => {
  const refs = [{ label: "הליד מהעדכון", entityType: "lead" as const, entityId: LEAD_ID }];

  it("מזהה את התווית כמו שהיא", () => {
    expect(matchHistoryRef(refs, "הליד מהעדכון")?.entityId).toBe(LEAD_ID);
  });

  it("מזהה אותה גם בתוך הסוגריים שהפרומפט מציג", () => {
    expect(matchHistoryRef(refs, "⟪הליד מהעדכון⟫")?.entityId).toBe(LEAD_ID);
  });

  it("מזהה אותה גם כשהמודל הוסיף מילית", () => {
    expect(matchHistoryRef(refs, "אל הליד מהעדכון")?.entityId).toBe(LEAD_ID);
  });

  it("אינו מזהה שם אמיתי כהפניה", () => {
    expect(matchHistoryRef(refs, "משה כהן")).toBe(null);
  });

  it("אינו מזהה כלום כשאין הפניות", () => {
    expect(matchHistoryRef(undefined, "הליד מהעדכון")).toBe(null);
  });
});

describe("historyRefs", () => {
  it("מחזיר מהתור האחרון לראשון — „אליו” הוא העדכון האחרון", () => {
    const history: AgentHistoryTurn[] = [
      {
        transcript: "ישן",
        action: "notify",
        params: {},
        refs: [{ label: "הליד מהעדכון", entityType: "lead", entityId: "OLD" }],
      },
      {
        transcript: "חדש",
        action: "notify",
        params: {},
        refs: [{ label: "הליד מהעדכון", entityType: "lead", entityId: "NEW" }],
      },
    ];
    expect(historyRefs(history).map((ref) => ref.entityId)).toEqual(["NEW", "OLD"]);
    expect(matchHistoryRef(historyRefs(history), "הליד מהעדכון")?.entityId).toBe("NEW");
  });
});

describe("הפרומפט אינו חושף מזהים", () => {
  it("מדפיס את התווית ולא את ה-entityId", () => {
    const turn = assistantMemoryTurn([
      { type: "call_missed", entityType: "lead", entityId: LEAD_ID },
    ])!;
    const prompt = buildInterpretPrompt("תזכיר לי להתקשר אליו", {
      nowText: "יום ראשון",
      allowedActions: ["create_task"],
      history: [turn],
    });
    expect(prompt).toContain("הסוכן עדכן");
    expect(prompt).toContain("⟪הליד מהעדכון⟫");
    expect(prompt).not.toContain(LEAD_ID);
  });
});


/*
 * שתי רשומות מאותו תור שנושאות תווית מתאימה הן ריבוי אמיתי:
 * בחירת הראשונה היא פגיעה שקטה ברשומה הלא נכונה, ולכן ההכרעה
 * חוזרת לחיפוש — שיודע לומר „נמצאו כמה” ולבקש בחירה (ביקורת Codex).
 */
describe("matchHistoryRef — ריבוי אינו הכרעה", () => {
  const refs = [
    { label: "משה כהן 1", entityType: "buyer" as const, entityId: "A" },
    { label: "משה כהן 2", entityType: "buyer" as const, entityId: "B" },
  ];

  it("תווית מדויקת פותרת", () => {
    expect(matchHistoryRef(refs, "משה כהן 2")?.entityId).toBe("B");
  });

  it("ביטוי שמתאים לשתיהן אינו פותר", () => {
    expect(matchHistoryRef(refs, "משה כהן")).toBeNull();
  });

  it("ותווית יחידה ממשיכה להיפתר בסלחנות", () => {
    const one = [{ label: "הליד מהעדכון", entityType: "lead" as const, entityId: "L" }];
    expect(matchHistoryRef(one, "⟪הליד מהעדכון⟫")?.entityId).toBe("L");
  });
});

describe("agentTurnRefs — הרשומות שהפעולות נגעו בהן", () => {
  const shown: AgentHistoryRef[] = [
    { label: "משה כהן", entityType: "buyer", entityId: "01J0000000000000000000000A" },
  ];
  const dana: AgentHistoryRef = {
    label: "דנה לוי",
    entityType: "buyer",
    entityId: "01J0000000000000000000000B",
  };

  it("נכנסות בראש, לפני שורות שהוצגו", () => {
    expect(agentTurnRefs([dana], shown)).toEqual([dana, ...shown]);
  });

  it("ובלעדיהן נשארות רק השורות שהוצגו", () => {
    expect(agentTurnRefs([undefined], shown)).toEqual(shown);
    expect(agentTurnRefs([], shown)).toEqual(shown);
  });

  /*
   * **שרשרת שומרת את כל חוליותיה, מהמאוחרת לקדומה.**
   *
   * „תוסיף קונה דנה ותזכיר לי להתקשר אליה” הוא אישור אחד ושתי
   * פעולות. שמירת הראשית בלבד איבדה את המשימה, ו„תסגור אותה”
   * בתור הבא חזר לחיפוש כותרת (ביקורת Codex).
   */
  it("ושרשרת נשמרת כולה, המאוחרת ראשונה", () => {
    const task: AgentHistoryRef = {
      label: "להתקשר לדנה",
      entityType: "task",
      entityId: "01J0000000000000000000000D",
    };
    expect(agentTurnRefs([task, dana], shown)).toEqual([task, dana, ...shown]);
  });

  /*
   * אותה רשומה בדיוק שהוצגה גם ברשימה אינה שתי הפניות. הכפילות
   * הייתה נראית למודל כשתי אפשרויות לאותו שם.
   */
  it("אותה רשומה אינה נכנסת פעמיים", () => {
    expect(agentTurnRefs([{ ...shown[0]! }], shown)).toEqual(shown);
  });

  /** וגם כששתי חוליות בשרשרת נגעו בה. */
  it("וגם לא כששתי פעולות בשרשרת נגעו בה", () => {
    expect(agentTurnRefs([dana, { ...dana }], shown)).toEqual([dana, ...shown]);
  });

  /*
   * **תווית שמתנגשת מוחקת את שני הצדדים, ולא אחד מהם.**
   *
   * חיפוש הציג את הקונה „משה כהן”, וצעד המשך יצר ליד באותו שם.
   * מחיקת ההפניה החדשה בלבד השאירה את השורה שהוצגה כתשובה שנראית
   * ודאית, ולכן „תוסיף לו הערה” היה נכתב בשקט על הקונה — כתיבה על
   * הכרטיס הלא נכון (ביקורת Codex). תווית שמצביעה על שתי רשומות
   * אינה מזהה אף אחת מהן, וההכרעה חוזרת לחיפוש.
   */
  it("ותווית שמתנגשת מוחקת את שני הצדדים", () => {
    const other: AgentHistoryRef = {
      label: "משה כהן",
      entityType: "lead",
      entityId: "01J0000000000000000000000C",
    };
    expect(agentTurnRefs([other], shown)).toEqual([]);
  });

  /** וגם כשההתנגשות היא בין שתי חוליות של אותה שרשרת. */
  it("וגם כשההתנגשות היא בתוך השרשרת עצמה", () => {
    const twin: AgentHistoryRef = {
      label: "דנה לוי",
      entityType: "lead",
      entityId: "01J0000000000000000000000E",
    };
    expect(agentTurnRefs([dana, twin], shown)).toEqual(shown);
  });

  /*
   * אבל **אותה רשומה** שנגעו בה וגם הוצגה אינה התנגשות: הצמצום
   * לפי מזהה קורה קודם, אחרת הפניה תקינה לגמרי הייתה נמחקת.
   */
  it("ורשומה שנגעו בה וגם הוצגה נשארת", () => {
    expect(agentTurnRefs([{ ...shown[0]! }], shown)).toEqual(shown);
  });
});

/*
 * **מה שיוצא מ-`agentTurnRefs` נוסע בבקשה הבאה, ולכן חייב לעבור
 * את `InterpretSchema`.**
 *
 * שאילתה שהחזירה שמונה שורות ועוד צעד המשך אחד ייצרו תשע הפניות,
 * ו-`.max(AGENT_RESULT_ROWS)` דחה את הבקשה הבאה ב-400 — כלומר תור
 * שלם נעלם, ולא „ערך חורג” (ביקורת Codex).
 */
describe("agentTurnRefs — תקרת הסכימה", () => {
  const shown: AgentHistoryRef[] = Array.from({ length: AGENT_RESULT_ROWS }, (_, i) => ({
    label: `שורה ${i + 1}`,
    entityType: "buyer" as const,
    entityId: `01J000000000000000000000${String.fromCharCode(65 + i)}`,
  }));

  it("אינה חורגת מהתקרה גם כשהרשימה מלאה ויש שרשרת", () => {
    const acted: AgentHistoryRef[] = [
      { label: "המשימה", entityType: "task", entityId: "01J0000000000000000000000Z" },
      { label: "דנה לוי", entityType: "buyer", entityId: "01J0000000000000000000000Y" },
    ];
    const out = agentTurnRefs(acted, shown);
    expect(out.length).toBe(AGENT_RESULT_ROWS);
    // מה שנגעו בו שורד; הקיצוץ הוא מזנב השורות
    expect(out.slice(0, 2)).toEqual(acted);
    expect(out[2]).toEqual(shown[0]);
  });
});
