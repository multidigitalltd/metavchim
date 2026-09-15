import { describe, expect, it } from "vitest";
import {
  isMentorSubjectKind,
  mentorSubjectFacts,
  mentorSubjectLines,
  mentorSubjectTitle,
  type MentorBuyerSubject,
  type MentorPropertySubject,
} from "./mentor-subject.js";
import { buildMentorPrompt, type MentorChatContext } from "./mentor-chat.js";

const buyer: MentorBuyerSubject = {
  kind: "buyer",
  id: "01BUYERAAAAAAAAAAAAAAAAAAA",
  name: "דנה",
  stage: "בסבב סיורים",
  maturity: "hot",
  viewings: 2,
  offers: 1,
  interestedOffers: 0,
  daysSinceTouch: 9,
  ageDays: 40,
  hasNextStep: false,
};

const property: MentorPropertySubject = {
  kind: "property",
  id: "01PROPAAAAAAAAAAAAAAAAAAAA",
  label: "הרצל 12, תל אביב",
  price: 2_400_000,
  rooms: 4,
  size: 95,
  ageDays: 61,
  viewings: 3,
  offers: 2,
  interestedOffers: 1,
};

describe("סיווג הכרטיס", () => {
  it("מזהה את שני הסוגים ודוחה כל השאר", () => {
    expect(isMentorSubjectKind("buyer")).toBe(true);
    expect(isMentorSubjectKind("property")).toBe(true);
    expect(isMentorSubjectKind("lead")).toBe(false);
    expect(isMentorSubjectKind("")).toBe(false);
    expect(isMentorSubjectKind(null)).toBe(false);
    expect(isMentorSubjectKind(7)).toBe(false);
  });
});

describe("העובדות שנוסעות למודל", () => {
  it("קונה — שלב, בשלות, סיורים, הצעות, מגע וצעד הבא", () => {
    const facts = mentorSubjectFacts(buyer).join("; ");
    expect(facts).toContain("שלב: בסבב סיורים");
    expect(facts).toContain("שני סיורים");
    expect(facts).toContain("בלי „מעוניין”");
    expect(facts).toContain("9 ימים מאז המגע האחרון");
    expect(facts).toContain("בלי צעד הבא קבוע");
  });

  it("„סיור אחד” ולא „1 סיורים”", () => {
    const facts = mentorSubjectFacts({ ...buyer, viewings: 1 }).join("; ");
    expect(facts).toContain("סיור אחד");
    expect(facts).not.toContain("1 סיורים");
  });

  it("אפס סיורים נאמר במפורש, ולא נשמט", () => {
    /*
     * ‏שורה חסרה נקראת כ„לא ידוע”, ו„בלי סיורים” היא בדיוק העובדה
     * ‏שהמנטור צריך כדי לשאול למה.
     */
    expect(mentorSubjectFacts({ ...buyer, viewings: 0 }).join("; ")).toContain(
      "בלי סיורים",
    );
  });

  it("מגע אחרון היום אינו „0 ימים”", () => {
    expect(
      mentorSubjectFacts({ ...buyer, daysSinceTouch: 0 }).join("; "),
    ).toContain("מגע אחרון היום");
  });

  it("בלי מגע מתועד — אין שורת מגע כלל, ולא „null ימים”", () => {
    const facts = mentorSubjectFacts({ ...buyer, daysSinceTouch: null }).join("; ");
    expect(facts).not.toContain("מגע");
    expect(facts).not.toContain("null");
  });

  it("שלב ריק אינו נכתב כשורה ריקה", () => {
    for (const stage of [null, ""] as const) {
      expect(mentorSubjectFacts({ ...buyer, stage }).join("; ")).not.toContain(
        "שלב:",
      );
    }
  });

  it("נכס — מחיר, חדרים, מ״ר, ימים בשוק והצעות", () => {
    const facts = mentorSubjectFacts(property).join("; ");
    expect(facts).toContain("2400000 ₪");
    expect(facts).toContain("4 חדרים");
    expect(facts).toContain("95 מ״ר");
    expect(facts).toContain("בכרטיס 61 ימים");
    expect(facts).toContain("מתוכן 1 „מעוניין”");
  });

  it("נכס בלי מחיר או מידות אינו ממציא אותם", () => {
    const facts = mentorSubjectFacts({
      ...property,
      price: null,
      rooms: null,
      size: null,
    }).join("; ");
    expect(facts).not.toContain("₪");
    expect(facts).not.toContain("חדרים");
    expect(facts).not.toContain("מ״ר");
    expect(facts).not.toContain("null");
  });
});

describe("הכותרת שבמסך", () => {
  it("קונה בשמו, נכס בכתובתו", () => {
    expect(mentorSubjectTitle(buyer)).toBe("דנה");
    expect(mentorSubjectTitle(property)).toBe("הרצל 12, תל אביב");
  });
});

describe("הגבול נוסע עם העובדות", () => {
  /*
   * ‎**זו הבדיקה שהמודול קיים בשבילה.** כלל 6 בפרומפט אומר שאין
   * ‏גישה ללקוחות ספציפיים; בלי משפט ההיתר, מה שנשלח סותר אותו
   * ‏והמודל מקבל שתי הוראות מנוגדות. ובלי משפט הסייג, מודל שנשאל
   * ‏„מה הטלפון שלה” ימציא אחד — וזו הדרך שבה מודל מדליף מה שלא קיבל.
   */
  it("שורת קונה נושאת גם את ההיתר וגם את הסייג", () => {
    const lines = mentorSubjectLines(buyer).join("\n");
    expect(lines).toContain("בניגוד לכלל 6");
    expect(lines).toContain("אין להמציא");
    expect(lines).toContain("טלפון");
  });

  it("שורת נכס אומרת שבעל הנכס אינו כאן", () => {
    const lines = mentorSubjectLines(property).join("\n");
    expect(lines).toContain("בניגוד לכלל 6");
    expect(lines).toContain("בעל הנכס");
    expect(lines).toContain("אין להמציא");
  });
});

function context(over: Partial<MentorChatContext> = {}): MentorChatContext {
  return {
    firstName: "דנה",
    nowText: "יום שני",
    goals: [],
    lastReview: null,
    history: [],
    question: "מה לעשות?",
    ...over,
  };
}

describe("הכרטיס בתוך הפרומפט", () => {
  it("נכנס כשצורף, ובלעדיו הפרומפט אינו מזכיר כרטיס", () => {
    expect(buildMentorPrompt(context({ subject: buyer }))).toContain(
      "הכרטיס שצורף לשיחה",
    );
    expect(buildMentorPrompt(context())).not.toContain("שצורף לשיחה");
    expect(buildMentorPrompt(context({ subject: null }))).not.toContain(
      "שצורף לשיחה",
    );
  });

  it("כלל 6 נשאר בפרומפט גם כשיש כרטיס — החריג אינו מבטל אותו", () => {
    const prompt = buildMentorPrompt(context({ subject: property }));
    expect(prompt).toContain("6. אין לכם גישה ללקוחות");
    expect(prompt).toContain("בניגוד לכלל 6");
  });

  it("הפרומפט אינו נושא את מזהה הכרטיס", () => {
    /*
     * ‏המזהה משמש את השרת כדי לאסוף את העובדות; למודל אין בו שימוש,
     * ‏והוא מזמין ציטוט של מחרוזת שנראית כמו סוד.
     */
    expect(buildMentorPrompt(context({ subject: buyer }))).not.toContain(buyer.id);
    expect(buildMentorPrompt(context({ subject: property }))).not.toContain(
      property.id,
    );
  });
});
