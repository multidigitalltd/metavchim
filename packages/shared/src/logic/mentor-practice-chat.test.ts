import { describe, expect, it } from "vitest";
import {
  isPracticeEndMessage,
  practiceChatFeedback,
  practiceChatMenu,
  practiceChatOpening,
  practiceChatTurn,
  practiceScenario,
  practiceScenarioFromText,
  PRACTICE_SCENARIO_INFO,
  type MentorPracticeFeedback,
} from "./mentor-practice.js";

/** ‏הנרמול של הוואטסאפ, מקוצר — כמו שהקורא מספק אותו. */
const normalize = (value: string): string => value.trim().replace(/\s+/gu, " ");

describe("סיום תרגול", () => {
  it("המילים שמסיימות — כלשונן", () => {
    for (const word of ["סיום", "מספיק", "סיימתי", "  די  "]) {
      expect(isPracticeEndMessage(word, normalize), word).toBe(true);
    }
  });

  it("ומה שאינו סיום הוא תור בתרגול", () => {
    /*
     * ‏זו הבדיקה שמונעת את התקלה המסוכנת: משפט של המתווך בתרגול
     * ‏שייקרא בטעות כ„סיום” מפסיק את התרגול באמצע ומייצר משוב על
     * ‏שיחה שלא הסתיימה.
     */
    for (const said of [
      "אני מבין אותך, אבל המחיר הזה גבוה מהשוק",
      "מספיק לי לדעת מה חשוב לך",
      "די בהתחלה נבין מה המטרה",
    ]) {
      expect(isPracticeEndMessage(said, normalize), said).toBe(false);
    }
  });
});

describe("פתיחת התרגול", () => {
  const scenario = practiceScenario("seller_price")!;

  it("אומרת מי הדמות, מה המטרה, ואיך מסיימים", () => {
    const text = practiceChatOpening(scenario);
    expect(text).toContain(scenario.label);
    expect(text).toContain(scenario.counterpart.name);
    expect(text).toContain(scenario.opening);
    expect(text).toContain(scenario.goal);
    expect(text).toContain("„סיום”");
  });

  /*
   * ‎`stance` ו-`convincedBy` הם **למודל** — מה שמניע את הדמות ומה
   * ‏ישכנע אותה. מתווך שרואה אותם מתרגל מול פתרון גלוי, וזה כבר לא
   * ‏תרגול.
   */
  it("ואינה חושפת את מה שנועד למודל בלבד", () => {
    const text = practiceChatOpening(scenario);
    expect(text).not.toContain(scenario.counterpart.stance);
    expect(text).not.toContain(scenario.counterpart.convincedBy);
    expect(text).not.toContain(scenario.tip);
  });
});

describe("תור בתרגול", () => {
  it("שקט באמצע — הספירה אינה רעש", () => {
    expect(practiceChatTurn("דנה", "יקר לי", 6)).toBe('דנה: „יקר לי”');
  });

  it("ומזהיר לקראת הסוף", () => {
    expect(practiceChatTurn("דנה", "יקר לי", 1)).toContain("נשאר תור אחד");
    expect(practiceChatTurn("דנה", "יקר לי", 0)).toContain("התור האחרון");
  });
});

describe("המשוב", () => {
  const feedback: MentorPracticeFeedback = {
    worked: ["שאלת מה חשוב לו"],
    missed: ["לא הצעת צעד הבא"],
    tryNext: "לסגור מועד לסיור בסוף השיחה",
    score: 4,
    checklist: [],
    source: "checklist",
  };

  it("נושא ציון, מה עבד, מה פוספס, ומה לנסות", () => {
    const text = practiceChatFeedback("מוכר על המחיר", feedback);
    expect(text).toContain("מוכר על המחיר");
    expect(text).toContain("שאלת מה חשוב לו");
    expect(text).toContain("לא הצעת צעד הבא");
    expect(text).toContain("לסגור מועד לסיור");
  });

  it("ובלי מה שאין — אין כותרת ריקה", () => {
    const text = practiceChatFeedback("מוכר על המחיר", {
      ...feedback,
      worked: [],
      missed: [],
    });
    expect(text).not.toContain("מה עבד:");
    expect(text).not.toContain("מה פספסת:");
    expect(text).toContain("לנסות בשיחה הבאה");
  });
});

describe("תפריט התרחישים", () => {
  it("נגזר מהרשימה — תרחיש חדש נכנס בלי לגעת בניסוח", () => {
    const menu = practiceChatMenu();
    for (const info of PRACTICE_SCENARIO_INFO) {
      expect(menu, info.code).toContain(info.label);
    }
  });
});

describe("איזה תרחיש נאמר במשפט", () => {
  it("התווית המלאה — מדויק", () => {
    expect(practiceScenarioFromText("תרגל איתי מוכר על המחיר")?.code).toBe(
      "seller_price",
    );
    expect(practiceScenarioFromText("בוא נתאמן על קונה שמתלבט")?.code).toBe(
      "buyer_hesitant",
    );
  });

  /*
   * ‏„מוכר שלא רוצה בלעדיות” מכיל גם „מוכר”. בלי קדימות התווית
   * ‏המלאה על מילות המפתח, תרחיש המחיר היה נבחר במקומו.
   */
  it("והתווית קודמת למילות המפתח", () => {
    expect(
      practiceScenarioFromText("תרגל איתי מוכר שלא רוצה בלעדיות")?.code,
    ).toBe("seller_exclusive");
  });

  it("ומילות מפתח כשלא נאמרה תווית", () => {
    expect(practiceScenarioFromText("נתאמן על התנגדות מחיר")?.code).toBe(
      "seller_price",
    );
    expect(practiceScenarioFromText("תרגל איתי בקשה להנחה בעמלה")?.code).toBe(
      "commission",
    );
    expect(practiceScenarioFromText("ליד שאומר רק מתעניין")?.code).toBe(
      "lead_cold",
    );
  });

  it("ובלי תרחיש — null, ואז התפריט", () => {
    expect(practiceScenarioFromText("תרגל איתי")).toBeNull();
    expect(practiceScenarioFromText("   ")).toBeNull();
  });

  /*
   * ‎**התפריט מציע משפט שעובד.** „אפשר לומר את השם” היה מבוי סתום:
   * ‏„מוכר על המחיר” לבדו אינו מכיל מילת תרגול, ולכן אינו מזוהה
   * ‏כבקשה לתרגול כלל.
   */
  it("התפריט מדגים את המשפט המלא, ולא את התווית לבדה", () => {
    const menu = practiceChatMenu();
    expect(menu).toContain("תרגל איתי");
    expect(menu).not.toContain("אפשר לומר את השם");
  });
});
