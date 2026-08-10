/**
 * ניתוב פקודות קוליות (docs/06) — המתווך אומר משפט אחד, והמערכת מזהה
 * *מה הוא רוצה לעשות* לפני שהיא מחלצת פרטים. מנוע חוקים דטרמיניסטי,
 * במקביל ל-extract-property/extract-person; ספק LLM יורחב מעליו.
 *
 * עיקרון בטיחות: הפקודה אף פעם לא מבוצעת ישירות — היא מתורגמת לטיוטה
 * שהמתווך מאשר. במיוחד בפעולות שיוצאות ללקוח (שליחת הצעה).
 */

export type VoiceAction =
  | "add_property"
  | "add_buyer"
  | "add_lead"
  | "schedule_appointment"
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
  /** לשליחת הצעה: מה לזהות במאגר לפני האישור */
  offer?: { propertyPhrase?: string; buyerPhrase?: string };
}

const RULES: { action: VoiceAction; pattern: RegExp; confidence: "high" | "low" }[] = [
  // --- שליחת הצעה (לפני שאר הכללים: "שלח" חד-משמעי) ---
  { action: "send_offer", pattern: /(?:שלח|תשלח|שלחי)\s+(?:את\s+)?(?:ה?נכס|ה?דירה|ה?הצעה|הצעה)/u, confidence: "high" },
  { action: "send_offer", pattern: /(?:שלח|תשלח)\s+ל[א-ת]/u, confidence: "low" },

  /*
   * --- פגישה/סיור ---
   *
   * הדיבור האמיתי אינו מתחיל בפועל. "פגישה עם שמוליק על ההצעה
   * שהצעתי לו" הוא משפט שלם, ברור לחלוטין, שנדחה כ"לא זוהתה פקודה"
   * רק משום שחסרה בו המילה "קבע". מתווך שקיבל דחייה כזו פעם אחת
   * מפסיק לדבר אל המערכת — ולכן הצורות הנפוצות בלי פועל נכנסות כאן.
   */
  { action: "schedule_appointment", pattern: /(?:קבע(?:י)?|תקבע(?:י)?|לקבוע)\s+(?:לי\s+)?(?:פגישה|סיור|ביקור)/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:תזמן|תתאם|לתאם|תיאום)\s+(?:פגישה|סיור|ביקור)/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:פגישה|סיור|ביקור)\s+עם\s+[א-ת]/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:נפגש|להיפגש|אפגוש|תפגוש)\s+(?:עם\s+)?[א-ת]/u, confidence: "high" },
  { action: "schedule_appointment", pattern: /(?:פגישה|סיור)\s+(?:מחר|היום|מחרתיים|ביום|בשעה|ב-)/u, confidence: "low" },
  // "אני מראה לו את הדירה מחר" — סיור לכל דבר, בלי אף מילת פקודה
  { action: "schedule_appointment", pattern: /(?:להראות|מראה)\s+(?:לו|לה|להם)?\s*(?:את\s+)?(?:ה?דירה|ה?נכס|ה?בית)/u, confidence: "low" },

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

  // --- חיפוש ---
  { action: "search", pattern: /(?:חפש|תחפש|מצא|תמצא|איפה)\s+/u, confidence: "high" },
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
      } else if (rule.action === "send_offer") {
        command.offer = parseOfferTargets(text);
      }
      return command;
    }
  }
  return { action: "unknown", confidence: "low" };
}

/**
 * "שלח את הנכס בהרב שך למשה כהן" ⟵ מה לזהות במאגר:
 * הנכס = "הרב שך", הקונה = "משה כהן". שני הביטויים נפתרים בשרת מול
 * הנתונים של המשרד; אם יש יותר מהתאמה אחת — המתווך בוחר.
 */
export function parseOfferTargets(text: string): { propertyPhrase?: string; buyerPhrase?: string } {
  const result: { propertyPhrase?: string; buyerPhrase?: string } = {};

  // הנמען: "…ל<שם>" בסוף המשפט (עד שתי מילים)
  const toMatch = /\sל(?<buyer>[א-ת]+(?:\s+[א-ת]+)?)\s*$/u.exec(text);
  if (toMatch?.groups?.["buyer"]) {
    result.buyerPhrase = toMatch.groups["buyer"].trim();
  }

  // הנכס: מה שבין מילת הפקודה לנמען
  const body = toMatch ? text.slice(0, toMatch.index) : text;
  const propMatch =
    /(?:שלח|תשלח|שלחי)\s+(?:את\s+)?(?:ה?נכס|ה?דירה|ה?הצעה|הצעה)\s*(?:ב|של|ה)?\s*(?<prop>.+)/u.exec(body);
  const phrase = propMatch?.groups?.["prop"]?.trim();
  if (phrase !== undefined && phrase.length > 1) {
    result.propertyPhrase = phrase;
  }
  return result;
}

/** התוכן ללא מילות הפקודה — מוזן למנועי החילוץ. */
export function stripCommandPrefix(transcript: string): string {
  return transcript.replace(/\s+/gu, " ").trim().replace(COMMAND_PREFIX, "").trim();
}

export const VOICE_ACTION_LABELS: Record<VoiceAction, string> = {
  add_property: "הוספת נכס",
  add_buyer: "הוספת קונה",
  add_lead: "הוספת ליד",
  schedule_appointment: "קביעת פגישה",
  send_offer: "שליחת הצעה ללקוח",
  search: "חיפוש",
  unknown: "לא זוהתה פקודה",
};
