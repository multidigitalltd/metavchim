import { describe, expect, it } from "vitest";
import { routeVoiceCommand, stripCommandPrefix } from "./voice-command.js";

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

  it("מזהה שליחת הצעה ומפרק את הנכס והנמען", () => {
    const command = routeVoiceCommand("שלח את הנכס בהרב שך למשה כהן");
    expect(command.action).toBe("send_offer");
    expect(command.offer?.propertyPhrase).toBe("הרב שך");
    expect(command.offer?.buyerPhrase).toBe("משה כהן");
  });

  it("שליחת הצעה בלי נכס מפורש — נמען בלבד", () => {
    const command = routeVoiceCommand("תשלח הצעה לשרה לוי");
    expect(command.action).toBe("send_offer");
    expect(command.offer?.buyerPhrase).toBe("שרה לוי");
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
