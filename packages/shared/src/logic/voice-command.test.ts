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

/**
 * שאלות על מאגר הנכסים — הכלל שלא היה קיים.
 *
 * "מה יש לי ברמת גן עד שני מיליון" הוא המשפט שמופיע כדוגמה בקטלוג
 * הפעולות עצמו, והוא נדחה כ"לא זוהתה פקודה" בכל התקנה שבה מנוע
 * ההבנה אינו זמין: מנוע החוקים הכיר שאלות על קונים בלבד (דיווח
 * המשתמש).
 */
describe("שאלה על מאגר הנכסים", () => {
  it("מזהה את הניסוח הנפוץ ביותר — „מה יש לי ב…”", () => {
    expect(routeVoiceCommand("מה יש לי ברמת גן עד שני מיליון").action).toBe(
      "query_properties",
    );
    expect(routeVoiceCommand("מה יש לנו בבני ברק").action).toBe(
      "query_properties",
    );
  });

  it("מזהה שאלה עם המילה נכסים או דירות", () => {
    for (const text of [
      "אילו דירות יש בבני ברק להשכרה",
      "איזה נכסים יש לי",
      "כמה דירות יש במלאי",
      "תראה לי את הנכסים ברמת גן",
      "דירות להשכרה",
    ]) {
      expect(routeVoiceCommand(text).action, text).toBe("query_properties");
    }
  });

  /*
   * אותו ניסוח בדיוק, עם המילה קונים — שאלה על הקונים ולא על
   * המלאי. הכלל של הקונים יושב לפניו בכוונה.
   */
  it("„מה יש לי” עם המילה קונים הוא שאלה על הקונים", () => {
    expect(routeVoiceCommand("מה יש לי קונים לרמת גן").action).toBe(
      "query_buyers",
    );
  });

  /*
   * הגבול מול הפעולות הסמוכות: אלה ניסוחים שכבר עבדו, ושכלל חדש
   * ורחב מדי היה חוטף.
   */
  it("אינו חוטף הוספת נכס או חיפוש שם", () => {
    expect(routeVoiceCommand("תוסיף דירה ברמת גן").action).toBe("add_property");
    expect(routeVoiceCommand("יש לי דירה חדשה למכירה").action).toBe(
      "add_property",
    );
    expect(routeVoiceCommand("חפש את משה כהן").action).toBe("search");
    expect(routeVoiceCommand("מי מחפש 4 חדרים בגבעתיים").action).toBe(
      "query_buyers",
    );
  });
});

/**
 * שאלות על שאר המערכת — יומן, משימות, שיחות, דוח ועסקאות שת"פ.
 *
 * הסדר הוא חלק מהנכונות: "מה יש לי ביומן" מתאים גם לתבנית הנכסים
 * (`לי` ואחריו `ב`+אות), ורק העובדה שכלל היומן יושב לפניה מציל
 * אותו. הבדיקות כאן נועלות את הגבולות האלה.
 */
describe("שאלות קריאה על כל המערכת", () => {
  it("היומן גובר על שאלת הנכסים — „מה יש לי ביומן”", () => {
    expect(routeVoiceCommand("מה יש לי ביומן").action).toBe("show_schedule");
    expect(routeVoiceCommand("מה יש לי היום").action).toBe("show_schedule");
    expect(routeVoiceCommand("מה הפגישות שלי מחר").action).toBe("show_schedule");
  });

  it("„מה יש לי ברמת גן” נשאר שאלת נכסים", () => {
    expect(routeVoiceCommand("מה יש לי ברמת גן עד שני מיליון").action).toBe(
      "query_properties",
    );
  });

  it("קונים עם ה' הידיעה ובלי סימן שאלה", () => {
    expect(routeVoiceCommand("מה יש לי בבני ברק מבחינת קונים").action).toBe(
      "query_buyers",
    );
    expect(routeVoiceCommand("כמה יש לנו קונים?").action).toBe("query_buyers");
  });

  it("משימות: הצגה וסגירה", () => {
    expect(routeVoiceCommand("מה המשימות שלי").action).toBe("show_tasks");
    expect(routeVoiceCommand("סגור את המשימה להתקשר לדוד").action).toBe(
      "complete_task",
    );
    // "תזכיר לי" נשאר תזכורת — לא נחטף על ידי כללי המשימות
    expect(routeVoiceCommand("תזכיר לי מחר להתקשר לדוד").action).toBe("add_task");
  });

  /*
   * מנוע הכללים רץ כשהמודל אינו זמין. פעולה שאין לה כלל פשוט אינה
   * קיימת שם — ולכן „למי לחזור” נבדקת כאן ולא רק בקטלוג.
   */
  it("„למי לחזור” — בכל שלוש דרכי הניסוח", () => {
    for (const said of [
      "למי אני צריך לחזור",
      "למי לחזור היום",
      "מי מחכה לי",
      "מי ממתין לחזרה",
      "תן לי טלפונים שצריך לחזור אליהם",
      "רשימת החזרות",
    ]) {
      expect(routeVoiceCommand(said).action).toBe("show_callbacks");
    }
  });

  /*
   * „מי התקשר ולא חזרתי אליו” נופל גם על תבנית יומן השיחות. סדר
   * הכללים הוא מה שמכריע, ולכן הוא נבדק ולא מונח.
   */
  it("„מי התקשר ולא חזרתי” הוא חזרה, לא יומן שיחות", () => {
    expect(routeVoiceCommand("מי התקשר ולא חזרתי אליו").action).toBe("show_callbacks");
    expect(routeVoiceCommand("מי התקשר אליי היום").action).toBe("show_calls");
  });

  it("שיחות, דוח ועסקאות שת\"פ", () => {
    expect(routeVoiceCommand("מי התקשר אליי היום").action).toBe("show_calls");
    expect(routeVoiceCommand("כמה לידים נכנסו החודש").action).toBe("office_report");
    expect(routeVoiceCommand("מה קורה עם העסקאות המשותפות").action).toBe("show_deals");
  });

  it("הערה, סטטוס ליד ושיתוף ברשת", () => {
    expect(routeVoiceCommand("תוסיף הערה למשה כהן שהוא נוסע לחול").action).toBe(
      "add_note",
    );
    expect(routeVoiceCommand("תעדכן את הליד של דני לבטיפול").action).toBe(
      "update_lead_status",
    );
    expect(routeVoiceCommand("שתף את הדירה ברמת גן ברשת").action).toBe(
      "share_property",
    );
    expect(routeVoiceCommand("תעלה את הביקוש של משפחת כהן לרשת").action).toBe(
      "share_buyer",
    );
  });

  it("אינו חוטף את הפעולות הקיימות", () => {
    expect(routeVoiceCommand("קבע סיור מחר בעשר בדירה ברמת גן").action).toBe(
      "schedule_appointment",
    );
    expect(routeVoiceCommand("שלח את הדירה בהרב שך למשה כהן").action).toBe(
      "send_offer",
    );
    expect(routeVoiceCommand("תוסיף משימה לבדוק את החוזה").action).toBe("add_task");
  });
});
