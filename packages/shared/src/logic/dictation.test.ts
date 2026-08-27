import { describe, expect, it } from "vitest";
import {
  appendDictated,
  collectDictation,
  createDictationSessions,
  dictationErrorMessage,
  dictationMode,
  dictationShouldFallBack,
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

describe("dictationErrorMessage", () => {
  /** כל הקודים שהדפדפן פולט, ועוד אחד שאיננו מכירים. */
  const CODES = [
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "language-not-supported",
    "network",
    "no-speech",
    undefined,
    "something-new-from-a-future-browser",
  ];

  /*
   * ‎**הכלל, ולא שלושה מופעים שלו.**
   *
   * בחלון הסוכן שבדשבורד מוצג „מהיר” בלבד. הודעה שמפנה שם ל„מדויק”
   * שולחת את המתווך ללחוץ על כפתור שאינו קיים — אותה מחלה שרודפת
   * את הקוד הזה: המסך מבטיח דבר שאין מאחוריו. הבדיקה עוברת על כל
   * הקודים ולא על אלה שזכרתי, ולכן קוד חדש שיתווסף עם ניסוח שגוי
   * ייתפס.
   */
  it("במצב „מהיר בלבד” אף הודעה אינה מפנה ל„מדויק”", () => {
    for (const code of CODES) {
      const message = dictationErrorMessage(code, true);
      expect(message, `${code}`).not.toContain("מדויק");
      expect(message.length, `${code}`).toBeGreaterThan(0);
    }
  });

  it("במצב הרגיל ההודעה אומרת מה יקרה — ולא מפנה לכפתור שאינו קיים", () => {
    /*
     * ‏„מדויק” היה כפתור, ואז ההפניה אליו הייתה עצה טובה. עכשיו יש
     * כפתור אחד שבוחר את המצב בעצמו, והפניה לכפתור שאינו על המסך
     * היא הוראה שאי אפשר לבצע. ההודעה אומרת במקומה מה תעשה הלחיצה
     * הבאה — וזה מה שבאמת קורה, ראו `dictationMode`.
     */
    for (const code of ["language-not-supported", "network", undefined]) {
      const message = dictationErrorMessage(code, false);
      expect(message, String(code)).not.toContain("מדויק");
      expect(message, String(code)).toContain("יעבור לשרת");
    }
  });

  /* קודים שאינם תלויים במצב — אותה הודעה בשניהם, ובלי הפניה לכפתור. */
  it("שגיאות שאינן קשורות למנוע אינן משתנות בין המצבים", () => {
    for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "no-speech"]) {
      expect(dictationErrorMessage(code, true), code).toBe(dictationErrorMessage(code, false));
    }
  });
});

describe("נפילה מהדפדפן לשרת", () => {
  it("כשל שאומר „המנוע לא יעבוד כאן” מפיל לשרת", () => {
    for (const code of ["language-not-supported", "network", undefined, "bad-grammar"]) {
      expect(dictationShouldFallBack(code), String(code)).toBe(true);
    }
  });

  it("כשל שיקרה גם בשרת אינו מפיל אליו", () => {
    /*
     * השרת מקליט מאותו מיקרופון: הרשאה שנדחתה ומכשיר בלי מיקרופון
     * ייכשלו שם באותה מידה, ומעבר אליהם רק מחליף הודעת שגיאה.
     */
    for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "no-speech", "aborted"]) {
      expect(dictationShouldFallBack(code), code).toBe(false);
    }
  });

  it("ברירת המחדל היא הדפדפן — הטקסט מופיע בו תוך כדי הדיבור", () => {
    expect(
      dictationMode({ browserReady: true, serverReady: true, browserFailed: false }),
    ).toBe("browser");
  });

  it("אחרי כשל עוברים לשרת", () => {
    expect(
      dictationMode({ browserReady: true, serverReady: true, browserFailed: true }),
    ).toBe("server");
  });

  it("בלי מנוע בדפדפן — ישר לשרת", () => {
    expect(
      dictationMode({ browserReady: false, serverReady: true, browserFailed: false }),
    ).toBe("server");
  });

  it("בלי שרת נשארים על הדפדפן גם אחרי כשל — אין לאן ליפול", () => {
    expect(
      dictationMode({ browserReady: true, serverReady: false, browserFailed: true }),
    ).toBe("browser");
  });
});
