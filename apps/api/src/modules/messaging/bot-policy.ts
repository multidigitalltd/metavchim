import { jerusalemWallParts } from "@metavchim/shared";

/**
 * ‎**מדיניות הבוט — מה קבוע, מה ניתן לעריכה, ואיפה עובר הגבול**
 * (docs/12 §6).
 *
 * הקובץ הזה הוא פונקציות טהורות בכוונה: כל כלל כאן ניתן לבדיקה בלי
 * מסד, בלי רשת ובלי מודל. מה שנשבר בבוט אינו הניסוח אלא **הכללים**
 * — „הסר” שלא זוהה, שעות שחושבו הפוך, פרומפט שאיבד את איסור
 * ההתחזות — וכל אחד מהם נראה מבחוץ כמו בוט שעובד.
 */

/** מה שסוכן יכול לשנות. כל היתר קבוע ואינו יושב כאן. */
export interface BotSettings {
  enabled: boolean;
  /** שם התצוגה שהבוט מציג בו את עצמו — „העוזר של דנה נדל״ן” */
  officeName: string;
  greeting: string;
  /** שאלות האפיון, לפי סדר. ריק = ברירת המחדל */
  questions: string[];
  afterHoursMessage: string;
  /** שעון 24, בשעה שלמה. `from === to` ⇒ כל היום */
  hoursFrom: number;
  hoursTo: number;
  /** ימי פעילות, 0=ראשון. ריק = כל השבוע */
  days: number[];
}

export const BOT_DEFAULTS = {
  /**
   * ‎**נוסח ההסרה — ולמה הוא קבוע.**
   *
   * ‏opt-out הוא חובת מדיניות של Meta. אישור שנוסח בידי סוכן היה
   * יכול להיות מעורפל („נבדוק את זה”), וזה בדיוק מה שהופך תלונה
   * לדיווח ספאם.
   */
  optOutConfirmation: "הוסרת מרשימת הפניות. לא נשלח אליך הודעות נוספות.",
  /** אחרי אסקלציה — מספיק זמן שהמתווך יראה את ההתראה ויענה */
  escalationPauseMs: 6 * 60 * 60 * 1000,
  questions: [
    "מה מחפשים — קנייה, שכירות או מכירה?",
    "באיזה אזור?",
    "מה טווח התקציב?",
    "כמה חדרים?",
    "מתי רוצים להיכנס?",
  ],
} as const;

const FALLBACK: BotSettings = {
  enabled: false,
  officeName: "המשרד",
  greeting: "היי! אני העוזר הדיגיטלי של {{office}}. אשמח לכמה פרטים ואעביר לסוכן.",
  questions: [...BOT_DEFAULTS.questions],
  afterHoursMessage: "הודעתך התקבלה. נחזור אליך בשעות הפעילות.",
  hoursFrom: 8,
  hoursTo: 20,
  days: [0, 1, 2, 3, 4, 5],
};

/**
 * קריאת ההגדרות מהעמודה. **כל שדה חסר נופל לברירת מחדל** ולא מפיל
 * את הבוט: הגדרות שנשמרו בגרסה קודמת ימשיכו לעבוד אחרי שיתווסף שדה.
 */
export function parseBotSettings(raw: unknown): BotSettings {
  if (typeof raw !== "object" || raw === null) return { ...FALLBACK };
  const o = raw as Record<string, unknown>;
  const str = (k: string, d: string): string =>
    typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : d;
  const num = (k: string, d: number): number =>
    typeof o[k] === "number" && Number.isInteger(o[k]) ? (o[k] as number) : d;
  const list = (k: string): string[] =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const days = Array.isArray(o["days"])
    ? (o["days"] as unknown[]).filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : FALLBACK.days;
  const questions = list("questions");
  return {
    enabled: o["enabled"] === true,
    officeName: str("officeName", FALLBACK.officeName),
    greeting: str("greeting", FALLBACK.greeting),
    questions: questions.length > 0 ? questions : [...BOT_DEFAULTS.questions],
    afterHoursMessage: str("afterHoursMessage", FALLBACK.afterHoursMessage),
    hoursFrom: num("hoursFrom", FALLBACK.hoursFrom),
    hoursTo: num("hoursTo", FALLBACK.hoursTo),
    days: days.length > 0 ? days : [...FALLBACK.days],
  };
}

/**
 * ‎**זיהוי בקשת הסרה.**
 *
 * מכוון להיות רחב ולא צר: „הסר אותי בבקשה” חייב להיתפס בדיוק כמו
 * „הסר”. הכיוון השגוי כאן יקר — לקוח שביקש להפסיק וממשיך לקבל
 * הודעות מדווח ספאם, וזה פוגע בדירוג של המספר הפרטי של הסוכן.
 */
const OPT_OUT = [
  "הסר",
  "הסירו",
  "תסיר",
  "תסירו",
  "להסיר",
  "תפסיק",
  "תפסיקו",
  "להפסיק",
  "די",
  "עזוב אותי",
  "אל תשלח",
  "stop",
  "unsubscribe",
  "remove me",
];

export function isOptOut(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!,?]/gu, "");
  if (clean === "") return false;
  /*
   * ‎**רק הודעות קצרות.** „די כבר חיפשתי דירה חודשיים” אינה בקשת
   * הסרה, והתייחסות אליה ככזו הייתה מנתקת לקוח פעיל בשקט.
   */
  if (clean.length > 40) return false;
  return OPT_OUT.some((word) => clean === word || clean.startsWith(`${word} `));
}

/**
 * האם עכשיו בשעות הפעילות של הסוכן — **בשעון ישראל**.
 *
 * ‎`getHours` היה קורא את שעון המכונה, שהוא UTC בייצור: בוט שהוגדר
 * ל-08:00–20:00 היה עונה בפועל ב-10:00–22:00 שעון ישראל, ושותק
 * בדיוק בשעתיים העמוסות של הבוקר. ‏`jerusalemWallParts` מחזירה שעת
 * קיר אמיתית וגם מטפלת במעבר שעון קיץ/חורף.
 */
export function withinHours(settings: BotSettings, now: Date): boolean {
  const wall = jerusalemWallParts(now);
  /* היום בשבוע נגזר מתאריך הקיר הישראלי, לא מהתאריך המקומי */
  const day = new Date(`${wall.date}T12:00:00Z`).getUTCDay();
  if (!settings.days.includes(day)) return false;
  if (settings.hoursFrom === settings.hoursTo) return true;
  const hour = Number(wall.time.slice(0, 2));
  /* חלון שחוצה חצות (22→6) — השוואה הפוכה, אחרת הוא תמיד סגור */
  if (settings.hoursFrom < settings.hoursTo) {
    return hour >= settings.hoursFrom && hour < settings.hoursTo;
  }
  return hour >= settings.hoursFrom || hour < settings.hoursTo;
}

/** סכימת התשובה שהמודל מחזיר — מבנה ולא טקסט חופשי. */
export function botReplySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      reply: { type: "string" },
      intent: { type: "string", enum: ["buy", "rent", "sell", "other", "unknown"] },
      escalate: { type: "boolean" },
      escalationReason: { type: "string" },
    },
    required: ["reply", "escalate"],
  };
}

/**
 * ‎**הפרומפט — והחלק הקבוע שלו.**
 *
 * ההגדרות של הסוכן נכנסות כ**נתונים** בתוך מבנה קבוע, ולא כהוראות
 * שמחליפות אותו. זה ההבדל בין „גמישות” לבין סוכן שיכול לבטל בטעות
 * את איסור ההתחזות.
 */
export function buildBotPrompt(input: {
  settings: BotSettings;
  customerName: string;
  history: { role: string; text: string }[];
  message: string;
}): string {
  const { settings } = input;
  const greeting = settings.greeting.replace(/\{\{office\}\}/gu, settings.officeName);
  const turns = input.history
    .map((t) => `${t.role === "bot" ? "הבוט" : "הלקוח"}: ${t.text}`)
    .join("\n");

  return [
    "אתה עוזר דיגיטלי של משרד תיווך, שעונה ללקוח בוואטסאפ בעברית.",
    "",
    "כללים שאין לחרוג מהם בשום מצב:",
    "1. אתה בוט. אם נשאלת — אמור זאת במפורש. אין להתחזות לאדם.",
    "2. אין להתחייב על מחיר, זמינות, תנאי עסקה או תאריך. אלה נתונים שרק הסוכן מוסר.",
    "3. אין להמציא נכסים או פרטים. מה שאינך יודע — אמור שהסוכן ישיב.",
    "4. אם הלקוח מבקש לדבר עם אדם, נשמע מתוסכל או כועס, או שואל משהו",
    "   שאין לך עליו תשובה — החזר escalate=true ותשובה קצרה שמודיעה",
    "   שהסוכן יחזור אליו.",
    "5. תשובה קצרה: עד שלושה משפטים, ושאלה אחת בכל פעם.",
    "",
    `שם המשרד: ${settings.officeName}`,
    `נוסח הפתיחה (רק בתחילת שיחה): ${greeting}`,
    "",
    "מטרתך: לאפיין את הפנייה בשאלות קצרות, לפי הסדר, ורק מה שעוד לא נענה:",
    ...settings.questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    `שם הלקוח: ${input.customerName}`,
    turns === "" ? "זו ההודעה הראשונה בשיחה." : `השיחה עד כה:\n${turns}`,
    "",
    `ההודעה החדשה של הלקוח: ${input.message}`,
    "",
    "החזר JSON עם reply (התשובה ללקוח), intent, escalate, ו-escalationReason אם escalate.",
  ].join("\n");
}
