import { describe, expect, it } from "vitest";
import {
  appendDictated,
  collectDictation,
  createDictationSessions,
  type DictationResultSegment,
} from "./dictation.js";

/** קטע סופי — כפי שהמנוע מחזיר אותו אחרי שהמשפט התקבע. */
function done(transcript: string): DictationResultSegment {
  return { isFinal: true, 0: { transcript } };
}

/** קטע זמני — הטקסט שזוחל על המסך תוך כדי הדיבור. */
function live(transcript: string): DictationResultSegment {
  return { isFinal: false, 0: { transcript } };
}

describe("collectDictation", () => {
  it("מחזיר את כל הסבב ולא רק את הקטע האחרון", () => {
    const seen = new Set<number>();
    const { final, interim } = collectDictation([done("שלום "), done("עולם")], seen);
    expect(final).toBe("שלום עולם");
    expect(interim).toBe("");
  });

  it("מפריד בין מה שהתקבע לבין מה שעדיין נאמר", () => {
    const seen = new Set<number>();
    const { final, interim } = collectDictation([done("דירה "), live("בת שלושה")], seen);
    expect(final).toBe("דירה ");
    expect(interim).toBe("בת שלושה");
  });

  it("קטע זמני שהתקבע אינו נספר פעמיים", () => {
    /*
     * זו הרצה אמיתית של כרום: אותו אינדקס מופיע קודם כזמני ואז
     * כסופי. בלי הזיכרון בין האירועים הוא היה נראה כמו „סופי שזהה
     * לקודמו”, והטקסט היה נעלם או נכפל.
     */
    const seen = new Set<number>();
    collectDictation([live("שלום")], seen);
    const second = collectDictation([done("שלום")], seen);
    expect(second.final).toBe("שלום");
    expect(second.interim).toBe("");
  });

  it("בולע את קטע הרפאים של כרום באנדרואיד", () => {
    // אותה תוצאה מופיעה פעמיים ברצף, והשנייה מעולם לא הייתה זמנית
    const seen = new Set<number>();
    collectDictation([live("שלום")], seen);
    const { final } = collectDictation([done("שלום"), done("שלום")], seen);
    expect(final).toBe("שלום");
  });

  it("חזרה מכוונת של הדובר נשמרת", () => {
    /*
     * „לא… לא” הם שני קטעים זהים עוקבים — אבל כל אחד מהם נולד
     * כזמני מול העיניים, ולכן שניהם אמיתיים.
     */
    const seen = new Set<number>();
    collectDictation([live("לא")], seen);
    collectDictation([done("לא"), live("לא")], seen);
    const { final } = collectDictation([done("לא"), done("לא")], seen);
    expect(final).toBe("לאלא");
  });

  it("מתעלם מקטעים ריקים ומרשימה ריקה", () => {
    const seen = new Set<number>();
    expect(collectDictation([], seen)).toEqual({ final: "", interim: "" });
    expect(collectDictation([done("   "), undefined, done("טקסט")], seen).final).toBe("טקסט");
  });

  it("קטע בלי transcript אינו מפיל את האיסוף", () => {
    const seen = new Set<number>();
    expect(collectDictation([{ isFinal: true }, done("א")], seen).final).toBe("א");
  });
});

describe("appendDictated", () => {
  it("שדה ריק מקבל את הטקסט כמו שהוא", () => {
    expect(appendDictated("", "שלום")).toBe("שלום");
    expect(appendDictated("   ", "שלום")).toBe("שלום");
  });

  it("טקסט קיים מקבל רווח יחיד ואז את המוכתב", () => {
    expect(appendDictated("שלום", "עולם")).toBe("שלום עולם");
    expect(appendDictated("שלום   ", "  עולם  ")).toBe("שלום עולם");
  });

  it("הכתבה ריקה אינה נוגעת בשדה", () => {
    expect(appendDictated("שלום ", "   ")).toBe("שלום ");
  });
});

describe("createDictationSessions", () => {
  it("סבב חדש הופך את הקודם ללא-רלוונטי", () => {
    const sessions = createDictationSessions();
    const first = sessions.begin();
    const second = sessions.begin();
    expect(sessions.isCurrent(first)).toBe(false);
    expect(sessions.isCurrent(second)).toBe(true);
  });

  it("סיום של סבב שכבר הוחלף אינו נענה", () => {
    /*
     * הלב של „ההכתבה מתמללת פעמיים”: `onend` של הסבב הישן מגיע
     * מאוחר, אחרי שהמשתמש כבר לחץ „מהיר” שוב. עד כה הוא ניתק את
     * המערכת מהמנוע החדש. עכשיו הוא פשוט לא נענה.
     */
    const sessions = createDictationSessions();
    const stale = sessions.begin();
    const current = sessions.begin();
    expect(sessions.end(stale)).toBe(false);
    expect(sessions.isCurrent(current)).toBe(true);
  });

  it("סיום של הסבב הפעיל נענה פעם אחת בלבד", () => {
    const sessions = createDictationSessions();
    const token = sessions.begin();
    expect(sessions.end(token)).toBe(true);
    // `onend` ואחריו שעון הביטחון — השני כבר לא מאפס דבר
    expect(sessions.end(token)).toBe(false);
    expect(sessions.isCurrent(token)).toBe(false);
  });

  it("אחרי סיום אין סבב פעיל, ומזהה 0 לעולם אינו תופס", () => {
    const sessions = createDictationSessions();
    const token = sessions.begin();
    sessions.end(token);
    expect(sessions.isCurrent(0)).toBe(false);
    expect(sessions.end(0)).toBe(false);
  });

  it("מזהי הסבבים אינם חוזרים על עצמם גם אחרי סיום", () => {
    // אחרת סבב חדש היה יורש את המזהה של ישן שעדיין יורה callbacks
    const sessions = createDictationSessions();
    const first = sessions.begin();
    sessions.end(first);
    const second = sessions.begin();
    expect(second).not.toBe(first);
  });
});
