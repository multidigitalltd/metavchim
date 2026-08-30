import { describe, expect, it } from "vitest";
import {
  WHATSAPP_TEMPLATE_PARAMS,
  whatsappDeepLinkSuffix,
  whatsappTemplateButton,
  whatsappTemplateParams,
} from "./whatsapp-templates.js";

/**
 * ‎**מה שהמסך מבטיח שנרשם ב-Meta, ומה שנשלח בפועל.**
 *
 * ## התקלה שהבדיקות האלה נולדו ממנה
 *
 * ‏Meta עברה למשתנים בעלי שם ודוחה `{{1}}` בעורך התבניות. השליחה
 * הייתה **מיקומית** — `parameters: params.map(text => ({type,text}))` —
 * כלומר כל ארבע התבניות היו נרשמות בהצלחה ואז נדחות בשליחה, בשקט:
 * `sendTemplate` מחזיר `false` ואינו זורק, וההתראה פשוט לא מגיעה.
 *
 * ולכן הבדיקות כאן אינן על „הפורמט” אלא על **שלוש נקודות שאם אחת
 * מהן מחליקה ההודעה נעלמת בלי סימן**: השם, הניקוי, והכפתור.
 */

describe("ערכי התבנית נושאים שמות", () => {
  /*
   * ‎`parameter_name` הוא ההבדל בין הודעה שנמסרת לאחת שנדחית, והוא
   * גם השם שנרשם ידנית ב-WhatsApp Manager. הבדיקה מצמידה את שניהם.
   */
  it("כל ערך נושא את שם המשתנה שלו", () => {
    expect(whatsappTemplateParams("emailReply", ["דנה כהן"])).toEqual([
      { type: "text", parameter_name: "customer_name", text: "דנה כהן" },
    ]);
    expect(whatsappTemplateParams("notify", ["ליד חדש", "מאתר הבית"])).toEqual([
      { type: "text", parameter_name: "update_title", text: "ליד חדש" },
      { type: "text", parameter_name: "update_details", text: "מאתר הבית" },
    ]);
  });

  /* שם משתנה חוקי אצל Meta: אותיות קטנות, ספרות וקו תחתון בלבד */
  it("השמות עומדים בכללי Meta", () => {
    for (const names of Object.values(WHATSAPP_TEMPLATE_PARAMS)) {
      for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/u);
    }
  });

  /*
   * ‎**ירידת שורה פוסלת את ההודעה כולה, לא את השורה.**
   *
   * נוסח התזכורת לסיור נכתב על ידי המשרד בתיבת טקסט רב-שורתית, ולכן
   * זה לא מקרה קצה תיאורטי אלא מה שקורה כשמשרד מעצב לעצמו הודעה.
   */
  it("ערך רב-שורתי מיושר לשורה אחת", () => {
    const [param] = whatsappTemplateParams("emailReply", ["דנה\nכהן\n\nלוי"]);
    expect(param?.text).toBe("דנה כהן לוי");
  });

  /* גוף התבנית מוגבל ל-1024 תווים, וחריגה פוסלת — לא מקצרת */
  it("ערך ארוך נחתך ואינו פוסל את ההודעה", () => {
    const [param] = whatsappTemplateParams("emailReply", ["א".repeat(2000)]);
    expect(param?.text.length).toBeLessThanOrEqual(900);
    expect(param?.text.endsWith("…")).toBe(true);
  });

  /*
   * ‎**התזכורת נשלחת בשדות, ולא כנוסח אחד.**
   *
   * משתנה יחיד שמכיל את כל ההודעה אינו קריא ל-Meta, והיא מסווגת מה
   * שאינה מבינה כ-Marketing — כלומר תזכורת לפגישה, השירותית
   * שבהודעות, נחסמת כדיוור. חזרה למשתנה אחד מפילה את הבדיקה הזאת.
   */
  it("תזכורת הסיור בשדות — כשזו התבנית שנרשמה", () => {
    const params = whatsappTemplateParams("viewingReminderFields", [
      "דנה",
      "27/08",
      "17:30",
      "הרצל 12, רעננה",
      'נדל"ן רעננה',
    ]);
    expect(params.map((p) => p.parameter_name)).toEqual([
      "customer_name",
      "visit_date",
      "visit_time",
      "visit_address",
      "office_name",
    ]);
    expect(params[2]?.text).toBe("17:30");
  });

  /*
   * ‎**החוזה הישן נשאר, ואינו „מוחלף בשקט”.**
   *
   * מאחורי שם התבנית ששמור בהגדרות עומדת תבנית שאושרה ב-Meta עם
   * משתנה אחד. שליחת חמישה שמות אחרים אליה נדחית — ובערוץ „שניהם”
   * המייל מצליח, ולכן גם לא נפתחת משימה לסוכן: התזכורת בוואטסאפ
   * נעלמת בלי שאיש יידע (ביקורת Codex, P1). מחיקת הצורה הישנה מכאן
   * מפילה את הבדיקה הזאת.
   */
  it("הצורה הישנה — נוסח אחד — נשמרת", () => {
    expect(WHATSAPP_TEMPLATE_PARAMS.viewingReminder).toEqual(["reminder_text"]);
    expect(whatsappTemplateParams("viewingReminder", ["היי דנה, מחר ב-17:30"])).toEqual([
      { type: "text", parameter_name: "reminder_text", text: "היי דנה, מחר ב-17:30" },
    ]);
  });

  /*
   * ‎**שם המשרד ראשון, לפני הקישור.**
   *
   * הלקוח התקשר למשרד מסוים, וההודעה מגיעה אליו ממספר שאינו מוכר
   * לו — בלי השם אינו יודע למי הוא עונה, ואין בהודעה סימן לעסקה
   * שהוא צד לה. גם הסדר נבדק: היפוך היה שותל את הקישור בשם.
   */
  it("הזמנת הדרישות נושאת את שם המשרד לפני הקישור", () => {
    expect(WHATSAPP_TEMPLATE_PARAMS.intake).toEqual(["office_name", "form_link"]);
    expect(whatsappTemplateParams("intake", ['נדל"ן רעננה', "https://a/f/tok"])).toEqual([
      { type: "text", parameter_name: "office_name", text: 'נדל"ן רעננה' },
      { type: "text", parameter_name: "form_link", text: "https://a/f/tok" },
    ]);
  });

  /* ‏Meta דוחה ערך ריק; רווח יחיד עובר ומשאיר את ההודעה חסרה אך נמסרת */
  it("ערך ריק אינו נשלח ריק", () => {
    expect(whatsappTemplateParams("emailReply", [""])[0]?.text).toBe(" ");
  });
});

describe("כפתור „פתח במערכת”", () => {
  it("נתיב הופך לסיפא בלי לוכסן מוביל", () => {
    expect(whatsappDeepLinkSuffix("/leads/abc")).toBe("leads/abc");
    expect(whatsappDeepLinkSuffix("/properties/7")).toBe("properties/7");
  });

  it("כתובת מלאה של המערכת — רק מה שאחרי המקור", () => {
    expect(whatsappDeepLinkSuffix("https://app.example.com/f/tok", "https://app.example.com")).toBe(
      "f/tok",
    );
  });

  /*
   * ‎**מחרוזת שאילתה יורדת בכוונה.** ההודעה נמסרת ל-Meta כערך שנדבק
   * לבסיס, ואין דרך לאמת מראש שהיא תתקבל שם; תבנית שנדחית אינה
   * נמסרת כלל, וזו דווקא התראת השיחה — השכיחה מכולן.
   */
  it("שאילתה נגזרת ונשארת רשימת השיחות", () => {
    expect(whatsappDeepLinkSuffix("/calls?call=abc")).toBe("calls");
  });

  /*
   * ‎**אין יעד יחיד ⟸ מסך ההתראות.** סיפא ריקה פוסלת את ההודעה,
   * ולכן „בלי יעד” חייב להיות יעד ולא ריק.
   */
  it("בלי יעד — מסך ההתראות", () => {
    expect(whatsappDeepLinkSuffix("")).toBe("notifications");
    expect(whatsappDeepLinkSuffix("/")).toBe("notifications");
  });

  /* כתובת ממקור זר אינה נדבקת מתחת לבסיס שלנו ויוצרת כתובת שבורה */
  it("מקור זר אינו הופך לסיפא", () => {
    expect(whatsappDeepLinkSuffix("https://evil.example/x")).toBe("notifications");
  });

  it("הכפתור מיקומי, ואינו נושא שם משתנה", () => {
    const button = whatsappTemplateButton("leads/abc");
    expect(button).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "leads/abc" }],
    });
    expect(JSON.stringify(button)).not.toContain("parameter_name");
  });

  it("סיפא ריקה אינה מייצרת כפתור", () => {
    expect(whatsappTemplateButton("  ")).toBeNull();
  });
});
