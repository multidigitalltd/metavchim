import { describe, expect, it } from "vitest";
import {
  routeVoiceCommand,
  stripCommandPrefix,
  taskTitleFromTranscript,
} from "./voice-command.js";

describe("routeVoiceCommand", () => {
  it("מזהה הוספת נכס בניסוח מפורש", () => {
    expect(routeVoiceCommand("תוסיף נכס דירת 3 חדרים בבני ברק").action).toBe("add_property");
  });

  it("מזהה הוספת קונה", () => {
    expect(routeVoiceCommand("רשום קונה חדש משה כהן").action).toBe("add_buyer");
  });

  it("מזהה ליד לפי ניסוח טבעי", () => {
    const command = routeVoiceCommand("דיברתי עם יוסי, מתעניין בדירה");
    expect(command.action).toBe("add_lead");
    expect(command.confidence).toBe("low");
  });

  it("מזהה קביעת פגישה", () => {
    const command = routeVoiceCommand("קבע פגישה מחר בעשר עם משה");
    expect(command.action).toBe("schedule_appointment");
    expect(command.confidence).toBe("high");
  });

  it("מזהה חיפוש ומחזיר את מה שצריך לחפש", () => {
    const command = routeVoiceCommand("חפש את משה כהן");
    expect(command.action).toBe("search");
    expect(command.query).toBe("את משה כהן");
  });

  it("כלל מפורש גובר על ניחוש לפי הקשר", () => {
    // "מחפש דירה" הוא רמז לקונה, אבל "תוסיף נכס" מפורש
    expect(routeVoiceCommand("תוסיף נכס ללקוח שמחפש דירה").action).toBe("add_property");
  });

  /*
   * המנוע כאן מזהה **כוונה** בלבד. פירוק הנכס והנמען לביטויים עבר
   * ל-`agent/`, שם המודל מחזיר אותם כשדות והקוד פותר אותם מול
   * המאגר ומחזיר מועמדים לבחירה — במקום ביטוי רגולרי שתופס "שתי
   * מילים אחרי ל'".
   */
  it("מזהה שליחת הצעה", () => {
    expect(routeVoiceCommand("שלח את הנכס בהרב שך למשה כהן").action).toBe("send_offer");
    expect(routeVoiceCommand("תשלח הצעה לשרה לוי").action).toBe("send_offer");
  });


  it("מזהה קביעת פגישה בלי מילת פועל", () => {
    /*
     * זה התמלול שנדחה בשימוש אמיתי. משפט ברור לחלוטין, שנפסל רק
     * משום שחסרה בו המילה "קבע" — ומתווך שקיבל דחייה כזו פעם אחת
     * מפסיק לדבר אל המערכת.
     */
    const command = routeVoiceCommand("פגישה עם שמוליק על ההצעה שהצעתי לו");
    expect(command.action).toBe("schedule_appointment");
    expect(command.confidence).toBe("high");
  });

  it("מזהה 'נפגש עם' ו'להיפגש עם'", () => {
    expect(routeVoiceCommand("נפגש עם דנה מחר בארבע").action).toBe("schedule_appointment");
    expect(routeVoiceCommand("להיפגש עם משה כהן ביום שלישי").action).toBe("schedule_appointment");
  });

  it("'אני מראה לו את הדירה מחר' הוא סיור", () => {
    expect(routeVoiceCommand("אני מראה לו את הדירה מחר בעשר").action).toBe(
      "schedule_appointment",
    );
  });

  it("'תקבע' ו'לקבוע' עובדים כמו 'קבע'", () => {
    expect(routeVoiceCommand("תקבע פגישה מחר").action).toBe("schedule_appointment");
    expect(routeVoiceCommand("לקבוע סיור ביום חמישי").action).toBe("schedule_appointment");
  });

  it("טקסט שאינו פקודה מסווג כלא ידוע", () => {
    expect(routeVoiceCommand("בוקר טוב").action).toBe("unknown");
  });

  it("מסיר מילות פקודה לפני החילוץ", () => {
    expect(stripCommandPrefix("תוסיף קונה משה כהן 050-1234567")).toBe("משה כהן 050-1234567");
    expect(stripCommandPrefix("קבע פגישה מחר בעשר")).toBe("מחר בעשר");
  });
});

describe("סדר הכללים — פועל מפורש מנצח ניסוח בלי פועל", () => {
  it("'חפש פגישה עם משה' הוא חיפוש ולא קביעת פגישה", () => {
    /*
     * בתוך אותה רמת ביטחון הכלל הראשון שמתאים מנצח. כלל בלי פועל
     * שיושב למעלה חוטף משפטים שיש בהם פועל מפורש אחר (ביקורת Codex).
     */
    expect(routeVoiceCommand("חפש פגישה עם משה").action).toBe("search");
  });

  it("'תוסיף נכס מהביקור עם משה' מוסיף נכס", () => {
    expect(routeVoiceCommand("תוסיף נכס מהביקור עם משה").action).toBe("add_property");
  });

  it("'תשלח הצעה לפני הפגישה עם משה' היא שליחת הצעה", () => {
    expect(routeVoiceCommand("תשלח הצעה לפני הפגישה עם משה").action).toBe("send_offer");
  });

  it("ובלי פועל מפורש — עדיין פגישה", () => {
    expect(routeVoiceCommand("פגישה עם שמוליק על ההצעה שהצעתי לו").action).toBe(
      "schedule_appointment",
    );
  });
});

describe("תזכורות בקול", () => {
  it("'תזכיר לי' — תזכורת, בכל ניסוח", () => {
    expect(routeVoiceCommand("תזכיר לי מחר להתקשר לדוד").action).toBe("add_task");
    expect(routeVoiceCommand("תוסיף משימה לבדוק את החוזה").action).toBe("add_task");
  });

  it("'תזכיר לי' גובר על פעולות אחרות — התוכן הוא התזכורת, לא פקודה", () => {
    /*
     * "תזכיר לי לקבוע פגישה עם משה" הוא תזכורת לקבוע — לא קביעה
     * עכשיו, ו"תזכיר לי לשלוח את ההצעה" בטח שלא שולח שום דבר ללקוח.
     */
    expect(routeVoiceCommand("תזכיר לי לקבוע פגישה עם משה").action).toBe("add_task");
    expect(routeVoiceCommand("תזכיר לי לשלוח את ההצעה למשה כהן").action).toBe("add_task");
  });

  it("כותרת התזכורת — בלי מילות הפקודה", () => {
    expect(taskTitleFromTranscript("תזכיר לי מחר בעשר להתקשר לדוד")).toBe(
      "מחר בעשר להתקשר לדוד",
    );
    expect(taskTitleFromTranscript("תוסיף משימה לבדוק את החוזה")).toBe("לבדוק את החוזה");
  });
});

describe("שאלות על המאגר", () => {
  it("'מי מחפש …' — שאילתת קונים, לא חיפוש טקסט ולא הוספת קונה", () => {
    /*
     * "מי מחפש 4 חדרים בגבעתיים?" — התשובה היא רשימת קונים לפי
     * קריטריונים. בלי הכלל הזה המשפט היה נופל ל-add_buyer (בגלל
     * "מחפש דירה") או לחיפוש שמות שלא מוצא כלום.
     */
    expect(routeVoiceCommand("מי מחפש 4 חדרים בגבעתיים?").action).toBe("query_buyers");
    expect(routeVoiceCommand("מי מעוניין בדירה ברמת גן").action).toBe("query_buyers");
    expect(routeVoiceCommand("אילו קונים יש לי עד 2 מיליון").action).toBe("query_buyers");
  });

  it("'תחפש מי מחפש' — עדיין שאילתת קונים; 'חפש את משה' נשאר חיפוש", () => {
    expect(routeVoiceCommand("תחפש מי מחפש 4 חדרים בגבעתיים").action).toBe("query_buyers");
    expect(routeVoiceCommand("חפש את משה כהן").action).toBe("search");
  });

  it("פועל חיפוש + קונים ברבים = שאלה על המאגר (המקרה מהשטח)", () => {
    /*
     * "תחפש קונים ארבע חדרים" נפל לחיפוש טקסט בשמות — שלא מוצא
     * כלום. קונים **ברבים** אחרי פועל חיפוש הוא תמיד שאלה על המאגר.
     */
    expect(routeVoiceCommand("תחפש קונים ארבע חדרים").action).toBe("query_buyers");
    expect(routeVoiceCommand("מצא לי קונים לדירה בגבעתיים").action).toBe("query_buyers");
    expect(routeVoiceCommand("תראה לי את הקונים עד 2 מיליון").action).toBe("query_buyers");
  });

  it("'מחפש דירה' בלי 'מי' — עדיין הוספת קונה", () => {
    expect(routeVoiceCommand("דיברתי עם יוסי שמחפש דירה בבני ברק").action).not.toBe(
      "query_buyers",
    );
  });
});
