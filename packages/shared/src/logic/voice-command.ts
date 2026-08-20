/**
 * ניתוב פקודות קוליות — **הרצפה, לא המסלול הראשי.**
 *
 * ההבנה עברה ל-`agent/` : Gemini בוחר את הפעולה **וממלא את השדות
 * שלה**, במקום לזהות כוונה ולמסור את המשפט למנוע חוקים. המנוע כאן
 * נשאר כי הוא עובד בלי רשת ובלי מפתח — כשאין Gemini, או כשהקריאה
 * נכשלת, עדיף זיהוי חלקי על „לא הבנתי”.
 *
 * המגבלה שלו מתועדת ולא מוסתרת: `extract-property` מזהה ערים מול
 * **רשימה קשיחה של תשעה-עשר שמות בקוד**, ולכן כל יישוב מחוצה לה
 * אינו מזוהה. זה בדיוק מה שהמסלול החדש בא לפתור — ומה שהופך את
 * הקוד הזה לגיבוי ולא לברירת מחדל.
 *
 * עיקרון הבטיחות לא השתנה: הפקודה לעולם אינה מבוצעת ישירות אלא
 * מתורגמת להצעה שהמתווך מאשר.
 */

export type VoiceAction =
  | "add_property"
  | "add_buyer"
  | "add_lead"
  | "schedule_appointment"
  | "add_task"
  | "query_buyers"
  | "query_properties"
  | "send_offer"
  | "search"
  | "unknown";

export interface VoiceCommand {
  action: VoiceAction;
  /** ביטחון גס: high = ניסוח מפורש, low = ניחוש לפי הקשר */
  confidence: "high" | "low";
  /** מה שזוהה כפקודה — להצגה למתווך ("הבנתי: קביעת פגישה") */
  matched?: string;
  /** לחיפוש: מה לחפש */
  query?: string;
}

const RULES: { action: VoiceAction; pattern: RegExp; confidence: "high" | "low" }[] = [
  /*
   * --- "תזכיר לי" ראשון, מעל הכול ---
   * המילים שאחריו מתארות את *תוכן* התזכורת, לא פקודה לביצוע עכשיו:
   * "תזכיר לי לקבוע פגישה עם משה" הוא תזכורת, לא קביעת פגישה,
   * ו"תזכיר לי לשלוח את ההצעה" אינו שולח שום דבר.
   */
  { action: "add_task", pattern: /תזכיר(?:י)?\s+לי/u, confidence: "high" },

  // --- שליחת הצעה (לפני שאר הכללים: "שלח" חד-משמעי) ---
  { action: "send_offer", pattern: /(?:שלח|תשלח|שלחי)\s+(?:את\s+)?(?:ה?נכס|ה?דירה|ה?הצעה|הצעה)/u, confidence: "high" },
  { action: "send_offer", pattern: /(?:שלח|תשלח)\s+ל[א-ת]/u, confidence: "low" },

  // --- פגישה/סיור, בניסוח עם פועל ---
  { action: "schedule_appointment", pattern: /(?:קבע(?:י)?|תקבע(?:י)?|לקבוע)\s+(?:לי\s+)?(?:פגישה|סיור|ביקור)/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:תזמן|תתאם|לתאם|תיאום)\s+(?:פגישה|סיור|ביקור)/u, confidence: "high" },

  // --- נכס ---
  { action: "add_property", pattern: /(?:הוסף|תוסיף|רשום|תרשום|קלוט)\s+(?:לי\s+)?(?:נכס|דירה|בית)/u, confidence: "high" },
  { action: "add_property", pattern: /נכס\s+חדש|דירה\s+חדשה\s+ל(?:מכירה|השכרה)/u, confidence: "high" },
  { action: "add_property", pattern: /(?:קיבלתי|יש לי)\s+(?:נכס|דירה)\s+(?:חדש|חדשה|ל)/u, confidence: "low" },

  // --- קונה ---
  { action: "add_buyer", pattern: /(?:הוסף|תוסיף|רשום|תרשום)\s+(?:לי\s+)?(?:קונה|לקוח\s+קונה)/u, confidence: "high" },
  { action: "add_buyer", pattern: /קונה\s+חדש|לקוח\s+חדש\s+ש?מחפש/u, confidence: "high" },
  { action: "add_buyer", pattern: /מחפש\s+(?:דירה|נכס|בית)|מחפשת\s+(?:דירה|נכס)/u, confidence: "low" },

  // --- ליד ---
  { action: "add_lead", pattern: /(?:הוסף|תוסיף|רשום|תרשום)\s+(?:לי\s+)?ליד/u, confidence: "high" },
  { action: "add_lead", pattern: /ליד\s+חדש/u, confidence: "high" },
  { action: "add_lead", pattern: /(?:התקשר|התקשרה|פנה|פנתה|דיברתי עם)\s/u, confidence: "low" },

  // --- תזכורת/משימה בניסוחים נוספים ("תזכיר לי" כבר נתפס למעלה) ---
  { action: "add_task", pattern: /(?:הוסף|תוסיף|רשום|תרשום|צור|תצור)\s+(?:לי\s+)?(?:משימה|תזכורת|פולו[־\s-]?אפ)/u, confidence: "high" },
  { action: "add_task", pattern: /(?:משימה|תזכורת)\s+(?:חדשה|ל[א-ת])/u, confidence: "low" },

  /*
   * --- שאלה על המאגר — לפני "חיפוש" בכוונה ---
   *
   * "מי מחפש 4 חדרים בגבעתיים?" היא שאלה שהתשובה עליה היא רשימת
   * קונים לפי קריטריונים, לא חיפוש טקסט בשמות. היא יושבת לפני כלל
   * החיפוש כדי ש"תחפש מי מחפש 4 חדרים" יקבל את התשובה הנכונה —
   * ו"חפש את משה כהן" נשאר חיפוש כי אין בו "מי".
   */
  { action: "query_buyers", pattern: /מי\s+(?:מחפש|רוצה|צריך|מעוניין)/u, confidence: "high" },
  { action: "query_buyers", pattern: /(?:איזה|אילו)\s+קונים/u, confidence: "high" },
  /*
   * "תחפש קונים ארבע חדרים" — פועל חיפוש + **קונים ברבים** הוא שאלה
   * על המאגר, לא חיפוש שמות: התשובה הנכונה היא רשימת קונים לפי
   * הקריטריונים. ביחיד ("חפש את הקונה משה") זה נשאר חיפוש רגיל.
   */
  { action: "query_buyers", pattern: /(?:חפש|תחפש|מצא|תמצא|הצג|תציג|תביא|תראה)\s+(?:לי\s+)?(?:את\s+)?ה?קונים/u, confidence: "high" },
  { action: "query_buyers", pattern: /קונים\s+(?:שמחפשים|מתאימים|עם|עד\s|ל[א-ת0-9]|ב[א-ת])/u, confidence: "low" },
  { action: "query_buyers", pattern: /יש\s+(?:לי\s+|לנו\s+)?קונ(?:ה|ים)\s+ל/u, confidence: "low" },
  /*
   * "מה יש לי" עם המילה קונים — לפני הכלל המקביל על הנכסים, שהוא
   * הקריאה הטבעית של אותו ניסוח בלי המילה הזו.
   */
  { action: "query_buyers", pattern: /(?:מה|כמה)\s+(?:יש|נשארו|נשאר)\s+(?:לי|לנו)\b[^?]*\bקונים\b/u, confidence: "high" },

  /*
   * --- שאלה על מאגר הנכסים ---
   *
   * **הכלל הזה פשוט לא היה קיים**, ולכן "מה יש לי ברמת גן עד שני
   * מיליון" — המשפט שמופיע כדוגמה בקטלוג הפעולות עצמו — נדחה
   * כ"לא זוהתה פקודה" בכל התקנה שבה מנוע ההבנה אינו זמין. מנוע
   * החוקים הכיר שאלות על קונים בלבד, כלומר חצי מהשאלה הבסיסית
   * ביותר שמתווך שואל את המאגר שלו (דיווח המשתמש).
   */
  { action: "query_properties", pattern: /(?:איזה|אילו|כמה)\s+(?:נכסים|דירות|בתים)/u, confidence: "high" },
  { action: "query_properties", pattern: /(?:חפש|תחפש|מצא|תמצא|הצג|תציג|תביא|תראה)\s+(?:לי\s+)?(?:את\s+)?ה?(?:נכסים|דירות)/u, confidence: "high" },
  /*
   * "מה יש לי ב..." — הניסוח הנפוץ ביותר לשאלת מלאי, ובלי פועל
   * אחד. הדרישה ל-`ב`/`עד`/מספר אחריו מפרידה אותו מ"מה יש לי
   * היום ביומן", שהיא שאלה אחרת לגמרי.
   */
  { action: "query_properties", pattern: /(?:מה|כמה)\s+(?:יש|נשאר|נשארו)\s+(?:לי|לנו)\s+(?:ב[א-ת]|עד\s|מ-?\d|\d)/u, confidence: "high" },
  { action: "query_properties", pattern: /(?:נכסים|דירות)\s+(?:ב[א-ת]|עד\s|מ-?\d|להשכרה|למכירה)/u, confidence: "low" },

  // --- חיפוש ---
  { action: "search", pattern: /(?:חפש|תחפש|מצא|תמצא|איפה)\s+/u, confidence: "high" },

  /*
   * --- פגישה בלי מילת פועל ---
   *
   * הדיבור האמיתי אינו מתחיל בפועל. "פגישה עם שמוליק על ההצעה
   * שהצעתי לו" הוא משפט שלם וברור שנדחה כ"לא זוהתה פקודה" רק משום
   * שחסרה בו המילה "קבע" — ומתווך שקיבל דחייה כזו פעם אחת מפסיק
   * לדבר אל המערכת.
   *
   * **המיקום כאן, בסוף, הוא חלק מהנכונות ולא סדר שרירותי.** בתוך
   * אותה רמת ביטחון הכלל הראשון שמתאים מנצח, ולכן כלל בלי פועל
   * שיושב למעלה חוטף משפטים שיש בהם פועל מפורש אחר: "חפש פגישה עם
   * משה" היה נקבע כפגישה במקום להיות חיפוש, ו"תוסיף נכס מהביקור עם
   * משה" היה קובע פגישה במקום להוסיף נכס (ביקורת Codex). כאן, כל
   * פועל מפורש כבר קיבל את הזדמנותו.
   */
  { action: "schedule_appointment", pattern: /(?:פגישה|סיור|ביקור)\s+עם\s+[א-ת]/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:נפגש|להיפגש|אפגוש|תפגוש)\s+(?:עם\s+)?[א-ת]/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:פגישה|סיור)\s+(?:מחר|היום|מחרתיים|ביום|בשעה|ב-)/u, confidence: "low" },
  // "אני מראה לו את הדירה מחר" — סיור לכל דבר, בלי אף מילת פקודה
  { action: "schedule_appointment", pattern: /(?:להראות|מראה)\s+(?:לו|לה|להם)?\s*(?:את\s+)?(?:ה?דירה|ה?נכס|ה?בית)/u, confidence: "low" },
];

/** מסירה את מילות הפקודה כדי שהחילוץ יקבל רק את התוכן. */
const COMMAND_PREFIX =
  /^(?:היי\s+)?(?:מערכת[,\s]+)?(?:בבקשה\s+)?(?:הוסף|תוסיף|רשום|תרשום|קלוט|קבע|קבעי|תקבע|תקבעי|לקבוע|תזמן|תתאם|לתאם|חפש|תחפש|מצא|תמצא)\s+(?:לי\s+)?(?:נכס|דירה|בית|קונה|לקוח|ליד|פגישה|סיור|ביקור)?\s*/u;

export function routeVoiceCommand(transcript: string): VoiceCommand {
  const text = transcript.replace(/\s+/gu, " ").trim();
  if (text === "") return { action: "unknown", confidence: "low" };

  // כלל מפורש גובר תמיד על ניחוש לפי הקשר
  for (const confidence of ["high", "low"] as const) {
    for (const rule of RULES) {
      if (rule.confidence !== confidence) continue;
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const command: VoiceCommand = {
        action: rule.action,
        confidence: rule.confidence,
        matched: match[0],
      };
      if (rule.action === "search") {
        command.query = text.replace(rule.pattern, "").trim();
      }
      return command;
    }
  }
  return { action: "unknown", confidence: "low" };
}

/** התוכן ללא מילות הפקודה — מוזן למנועי החילוץ. */
export function stripCommandPrefix(transcript: string): string {
  return transcript.replace(/\s+/gu, " ").trim().replace(COMMAND_PREFIX, "").trim();
}

/**
 * כותרת התזכורת מתוך המשפט: בלי "תזכיר לי", ובלי ה-ל' של שם הפועל
 * שנשארת אחריו — "תזכיר לי להתקשר לדוד" ⟵ "להתקשר לדוד" נשאר קריא,
 * אבל "תזכיר לי מחר על החוזה" ⟵ "מחר על החוזה". המועד עצמו מחולץ
 * בנפרד (parseHebrewDateTime) ולא מוסר מהכותרת — כותרת עם "מחר"
 * מיותר עדיפה על כותרת שנחתכה לא נכון.
 */
export function taskTitleFromTranscript(transcript: string): string {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const stripped = text
    .replace(/^.*?תזכיר(?:י)?\s+לי\s*/u, "")
    .replace(/^(?:הוסף|תוסיף|רשום|תרשום|צור|תצור)\s+(?:לי\s+)?(?:משימה|תזכורת|פולו[־\s-]?אפ)\s*(?:של)?\s*/u, "")
    .trim();
  return stripped === "" ? text : stripped;
}
