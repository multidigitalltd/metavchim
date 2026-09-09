import { describe, expect, it } from "vitest";
import {
  CALL_CONVERT_INFO,
  callConvertCommand,
  callConvertKindFromText,
  callConvertQuestion,
  callConvertSubject,
  callConvertRefInCommand,
  callIsConvertible,
} from "./call-convert-chat.js";

/** ‏הנרמול של הוואטסאפ, מקוצר — כמו שהקורא מספק אותו. */
const normalize = (value: string): string => value.trim().replace(/\s+/gu, " ");

const CALL = "01JCAAAAAAAAAAAAAAAAAAAAAA";
/** ‏מה שהקורא מביא מהקטלוג — כאן קבוע, שם `examples[0]`. */
const SAID = "המר ללקוח";

describe("ארבעת הסוגים", () => {
  /*
   * ‏אותו מיפוי של המסך. שני ניסוחים של „מה זה מוכר” היו נפרדים
   * ‏בשקט, ואז אותה מילה הייתה פותחת כרטיס אחר בכל ערוץ.
   */
  it("ממופים לצורה ולסוג העסקה כמו במסך", () => {
    expect(CALL_CONVERT_INFO.map((i) => [i.label, i.target, i.dealType])).toEqual([
      ["קונה", "buyer", "sale"],
      ["שוכר", "buyer", "rent"],
      ["מוכר", "property", "sale"],
      ["משכיר", "property", "rent"],
    ]);
  });
});

describe("מה ניתן להמרה", () => {
  it("שיחה בלי ליד — כן, וזה המקרה שבשבילו זה נבנה", () => {
    expect(callIsConvertible({})).toBe(true);
  });

  it("וליד פתוח שלי — כן", () => {
    expect(callIsConvertible({ leadId: "01LEAD", leadStatus: "new" })).toBe(true);
  });

  /*
   * ‎**ליד שכבר הומר** — ההמרה השנייה מחזירה 409, אחרי שהמתווך כבר
   * ‏בחר סוג ובוואטסאפ אפילו כבר נפתח לו ליד.
   */
  it("וליד שכבר הומר — לא", () => {
    expect(callIsConvertible({ leadId: "01LEAD", leadStatus: "converted" })).toBe(false);
  });

  /*
   * ‎**נוכחות הסטטוס היא הרשות.** השרת מחזיר סטטוס רק לליד שמותר
   * ‏לגעת בו: ראות שיחה וראות ליד אינן אותו דבר, וסוכן רואה שיחה
   * ‏דרך נכס גלוי בזמן שהליד שייך לעמית. בלי התנאי הזה הבוט היה
   * ‏שואל „מה הצד השני” ואז נופל על 404.
   */
  it("וליד של עמית — לא, גם כשהשיחה עצמה נראית", () => {
    expect(callIsConvertible({ leadId: "01LEAD" })).toBe(false);
  });
});

describe("זיהוי התשובה", () => {
  it("המילה עצמה", () => {
    for (const info of CALL_CONVERT_INFO) {
      expect(callConvertKindFromText(info.label, normalize), info.label).toBe(info.kind);
    }
  });

  it("וצורות שמתווך באמת כותב", () => {
    expect(callConvertKindFromText("לקנות", normalize)).toBe("buyer");
    expect(callConvertKindFromText("שכירות", normalize)).toBe("renter");
    expect(callConvertKindFromText("מוכרת", normalize)).toBe("seller");
    expect(callConvertKindFromText("להשכיר", normalize)).toBe("landlord");
  });

  /*
   * ‎**מילה שלמה ולא „מכיל”.** התשובה נצרכת כשהמצב הממתין פתוח,
   * ‏ומיד אחריה נפתח כרטיס — כלומר זיהוי שגוי כאן פותח כרטיס מסוג
   * ‏לא נכון בשקט, ולא מחזיר „לא הבנתי”.
   */
  it("ומשפט שמכיל את המילה אינו בחירה", () => {
    for (const said of ["לא מוכר", "הקונה כבר קנה", "שאל אם יש מה למכור"]) {
      expect(callConvertKindFromText(said, normalize), said).toBeNull();
    }
  });

  it("ומה שאינו סוג — null", () => {
    expect(callConvertKindFromText("אולי", normalize)).toBeNull();
    expect(callConvertKindFromText("", normalize)).toBeNull();
  });
});

describe("השאלה", () => {
  it("נושאת את הנושא ואת ארבעת הסוגים", () => {
    const text = callConvertQuestion("השיחה עם דנה כהן");
    expect(text).toContain("דנה כהן");
    for (const info of CALL_CONVERT_INFO) expect(text).toContain(info.label);
    expect(text).toContain("ביטול");
  });

  /*
   * ‎**מי — ובלי טלפון.** השאלה נשמרת בזיכרון השיחה, וזיכרון השיחה
   * ‏נוסע לפרומפט של מודל חיצוני. כשאין שם, מועד השיחה הוא הזיהוי.
   */
  it("ובלי שם מזוהה השיחה לפי מתי הייתה", () => {
    expect(callConvertSubject({ when: "09.09 14:05" })).toBe("השיחה מ-09.09 14:05");
    expect(callConvertSubject({ name: "דנה", when: "09.09 14:05" })).toBe("השיחה עם דנה");
    /* ‏שם ריק אינו שם — כרטיס שנשמר בלי שם לא ייתן „השיחה עם ” */
    expect(callConvertSubject({ name: "  ", when: "09.09 14:05" })).toBe(
      "השיחה מ-09.09 14:05",
    );
  });
});

describe("הפקודה של הכפתור", () => {
  /*
   * ‎**הכפתור מדבר על השיחה שההתראה הציגה, לא על „האחרונה”.**
   *
   * ‏הודעה בוואטסאפ נשארת לחיצה לנצח: בלי המצביע, לחיצה על כפתור
   * ‏של יום שני אחרי ששיחה חדשה נכנסה ביום שלישי הייתה פותחת
   * ‏כרטיס על האדם הלא נכון.
   */
  it("נושאת את המצביע, ומחזירה אותו", () => {
    for (const kind of ["call", "lead", "contact"] as const) {
      const text = callConvertCommand(SAID, { kind, id: CALL });
      expect(text).toContain(SAID);
      expect(callConvertRefInCommand(text), kind).toEqual({ kind, id: CALL });
    }
  });

  /* ‏הקלדה בלי מצביע — ואז „האחרונה שאפשר להמיר” */
  it("והקלדה בלי מצביע — null, ולא ניחוש", () => {
    expect(callConvertRefInCommand(SAID)).toBeNull();
    expect(callConvertRefInCommand(`${SAID} [${CALL}]`)).toBeNull();
  });

  /*
   * ‎**מצביע פגום אינו מצביע חלקי.** „כמעט תקין” היה נשלף כשיחה
   * ‏אחרת או כמסנן ריק, כלומר שאלה על מי שלא נשאל עליו.
   */
  it("ומצביע שאינו תקין נדחה כולו", () => {
    expect(callConvertRefInCommand(`${SAID} [buyer:${CALL}]`)).toBeNull();
    expect(callConvertRefInCommand(`${SAID} [call:לא-מזהה]`)).toBeNull();
  });

  /*
   * ‏הפקודה נבנית סביב מה שהקורא מביא — ואינה משכתבת אותו. הניסוח
   * ‏שהמנוע מזהה נשמר בקטלוג, וההרכבה שלו לכפתור נבדקת אצל הקורא
   * ‏(`whatsapp-notify.test`).
   */
  it("ומשמרת את המשפט כפי שנמסר", () => {
    expect(callConvertCommand(SAID, { kind: "call", id: CALL }).startsWith(`${SAID} `)).toBe(
      true,
    );
  });
});
