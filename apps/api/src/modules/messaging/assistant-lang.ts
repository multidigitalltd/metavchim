/**
 * פענוח תשובות קצרות בצ'אט של הסוכן האישי — פונקציות טהורות,
 * מכוסות בבדיקות בנפרד מהשירות.
 *
 * ההתאמה היא **מילה שלמה בלבד**: "אשר" מאשר, אבל "אשר לי פגישה
 * ליום שלישי" הוא משפט חדש. משפט שמכיל את המילה ועוד תוכן חייב
 * להתפרש מחדש — אישור שנקרא מתוך משפט ארוך היה מבצע פעולה שהמתווך
 * לא התכוון אליה.
 */

import { jerusalemWallParts } from "@metavchim/shared";

const CONFIRM_WORDS = new Set([
  "אשר",
  "אישור",
  "מאשר",
  "מאשרת",
  "כן",
  "בצע",
  "תבצע",
  "יאללה",
  "אוקיי",
  "אוקי",
  "בסדר",
  "סבבה",
  "ok",
  "yes",
]);

const CANCEL_WORDS = new Set(["בטל", "ביטול", "תבטל", "לא", "עזוב", "עזבי", "cancel", "no"]);

/**
 * בקשת תפריט — "מה אתה יודע לעשות?" נשאלת שוב ושוב, ובכל פעם עלתה
 * קריאת מודל שלמה כדי לנסח את אותה תשובה. כאן היא נענית מהקטלוג,
 * חינם ובלי סיכוי לניסוח שגוי: הרשימה נגזרת מהפעולות שלמשתמש הזה
 * מותר לבקש. ההתאמה על משפט שלם בלבד — "עזרה עם הקונה של אתמול"
 * הוא בקשה אמיתית ולא תפריט.
 */
const HELP_PHRASES = new Set([
  "עזרה",
  "תפריט",
  "עזור לי",
  "מה אתה יודע",
  "מה אתה יודע לעשות",
  "מה אפשר לעשות",
  "מה את יודעת לעשות",
  "מה אתה יכול לעשות",
  "אפשרויות",
  "help",
  "menu",
]);


/** ניקוי לפני השוואה: סימני פיסוק וגרשיים שוואטסאפ ומקלדות מוסיפים. */
function normalizeShort(text: string): string {
  return text
    .trim()
    .replace(/[.,!?״"'׳*]+/gu, "")
    .toLowerCase();
}

export function isConfirmMessage(text: string): boolean {
  return CONFIRM_WORDS.has(normalizeShort(text));
}

export function isCancelMessage(text: string): boolean {
  return CANCEL_WORDS.has(normalizeShort(text));
}

/**
 * ‎**בקשה מפורשת להקראה — לתשובה הזו בלבד.**
 *
 * הקראה אינה אוטומטית: היא עולה קריאת TTS בכל תשובה, ובעל המוצר
 * ביקש שלא תקרה בלי שביקשו אותה. שתי דרכים לבקש — „תקריא לי” כאן
 * ועכשיו, או „תמיד תענה לי בקול” כהעדפת קבע (`set_preference`).
 *
 * ‎**נבדק כהכלה ולא כהודעה שלמה**, בשונה מ„אשר”/„בטל”: הבקשה מגיעה
 * בתוך משפט — „תקריא לי מה יש לי היום” — ולא לבדה. שאר המשפט ממשיך
 * לפירוש כרגיל, ולכן אין כאן מסלול נפרד אלא דגל על התשובה.
 */
/*
 * ‎**בלי `\b`.** גבול־מילה ב-JS מוגדר על תווי ASCII, ואות עברית
 * אינה אחד מהם: ‎`/\bתקריא\b/` אינו מתאים ל„תקריא לי” כלל. ביטוי
 * שנראה מדויק ואינו נפלט לעולם הוא בדיוק סוג הכלל המת שהמערכת
 * הזו כבר נכוותה בו — ולכן ההשוואה כאן היא הכלה פשוטה.
 */
const SPEAK_PHRASES: readonly string[] = [
  "תקריא",
  "תענה לי בקול",
  "תגיד לי בקול",
  "תשלח לי בקול",
  "בהודעה קולית",
  "בקול בבקשה",
];

/*
 * ‎**שלילה אינה בקשה.** „אל תענה לי בקול” מכיל „תענה לי בקול”,
 * ולכן הכלה לבדה הפכה בדיוק את הכיבוי להדלקה: המשתמש ביקש
 * להפסיק — וקיבל את אישור ההפסקה בהודעה קולית (ביקורת Codex).
 */
const NEGATIONS: readonly string[] = ["אל ", "בלי ", "לא ", "תפסיק", "די עם"];

export function wantsSpokenReply(text: string): boolean {
  const cleaned = normalizeShort(text);
  if (!SPEAK_PHRASES.some((phrase) => cleaned.includes(phrase))) return false;
  /*
   * השלילה נבדקת **לפני** הביטוי שנתפס ולא בכל המשפט: „תקריא לי
   * מה יש היום, אל תשכח את הפגישה” אינה שלילה של ההקראה.
   */
  const at = SPEAK_PHRASES.reduce((found, phrase) => {
    const index = cleaned.indexOf(phrase);
    return index === -1 ? found : Math.min(found, index);
  }, cleaned.length);
  const before = cleaned.slice(0, at);
  return !NEGATIONS.some((negation) => before.includes(negation));
}

export function isHelpMessage(text: string): boolean {
  return HELP_PHRASES.has(normalizeShort(text));
}

/**
 * בחירת מועמד במספר — "2" או "2." בלבד, בטווח הרשימה שהוצגה.
 * null = זו לא בחירה (והמשפט יתפרש כפקודה חדשה).
 */
export function choiceIndex(text: string, optionCount: number): number | null {
  const cleaned = normalizeShort(text);
  if (!/^\d{1,2}$/u.test(cleaned)) return null;
  const index = Number.parseInt(cleaned, 10);
  if (index < 1 || index > optionCount) return null;
  return index - 1;
}

/**
 * צורות ההקלדה הנפוצות של מספר ישראלי — להשוואה מול טלפון המשתמש.
 *
 * ה-wa_id של Meta הוא ספרות בינלאומיות ("9725..."); בפרופיל
 * המשתמשים מקלידים בדרך כלל מקומית ("05..."). ההשוואה נעשית על
 * ספרות בלבד משני הצדדים, ולכן די בשתי הצורות.
 */
export function waPhoneVariants(waId: string): string[] {
  const digits = waId.replace(/\D/gu, "");
  const variants = new Set<string>([digits]);
  if (digits.startsWith("972")) variants.add(`0${digits.slice(3)}`);
  else if (digits.startsWith("0")) variants.add(`972${digits.slice(1)}`);
  return [...variants];
}

/* ==================== „שקט לשעתיים” — ובכל ניסוח אחר ==================== */

/**
 * ‎**תקרת ההשתקה — 12 שעות, ולא כי זה נשמע סביר.**
 *
 * ‏סבב הדחיפה סורק התראות מ-24 השעות האחרונות בלבד
 * (`WA_NOTIFY_MAX_AGE_MS`), כי אחרת התראות שנדחו היו מצטברות לנצח.
 * השתקה ארוכה מהחלון הזה אינה „שקט” אלא **מחיקה שקטה**: ההתראה
 * מתיישנת בזמן שהיא ממתינה, ולא נשלחת לעולם. שתים-עשרה שעות
 * משאירות מרווח גם כששעות השקט של הלילה נופלות מיד אחריהן.
 *
 * בקשה ארוכה יותר אינה נדחית — היא נחתכת, והתשובה אומרת עד מתי
 * באמת. „עד מחר בערב” שהופך בשקט לשעתיים הוא בדיוק סוג ההבטחה
 * שגורמת למתווך להפסיק לסמוך על הסוכן.
 */
export const MAX_SNOOZE_MINUTES = 12 * 60;

/** ברירת המחדל כשלא נאמר משך — אותן שעתיים שהכפתור נתן. */
export const DEFAULT_SNOOZE_MINUTES = 120;

/** השעה שאליה „עד מחר” מתכוון — תחילת יום העבודה. */
const MORNING_HOUR = 7;

/** מה שמזהה בקשת השתקה. בלעדיו המשפט אינו נוגע להתראות בכלל. */
const QUIET_TRIGGERS: readonly string[] = [
  "שקט",
  "תשתוק",
  "תשתקי",
  "שתוק",
  "השתק",
  "תשתיק",
  "אל תפריע",
  "אל תפריעי",
  "לא להפריע",
  "בלי התראות",
  "בלי הודעות",
  "די להתראות",
  "די עם ההתראות",
  "תפסיק להפריע",
  "תפסיקי להפריע",
  "תפסיק עם ההתראות",
  "עזוב אותי",
  "תעזוב אותי",
  "נא לא להפריע",
];

/**
 * ביטול ההשתקה — **נבדק לפני** ההשתקה עצמה.
 *
 * „תבטל את השקט” מכיל „שקט”, ולכן סדר הפוך היה הופך כל בקשת ביטול
 * להשתקה נוספת: המתווך מבקש לחזור לקבל התראות ומקבל עוד שעתיים
 * של שקט. אותה מלכודת בדיוק כמו „אל תענה לי בקול” למעלה.
 */
const RESUME_PHRASES: readonly string[] = [
  "בטל את השקט",
  "תבטל את השקט",
  "ביטול שקט",
  "מספיק שקט",
  "די עם השקט",
  "תפסיק את השקט",
  "סיים את השקט",
  "תחזור להתריע",
  "חזור להתריע",
  "אפשר להתריע",
  "אפשר להפריע",
  "תחזור לעדכן",
  "אני חוזר",
  "חזרתי",
];

/** מספרים במילים — „שלוש שעות” נכתב לפחות כמו „3 שעות”. */
const NUMBER_WORDS: Record<string, number> = {
  אחת: 1,
  אחד: 1,
  שתי: 2,
  שתיים: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
  "אחת עשרה": 11,
  "שתים עשרה": 12,
};

export interface SnoozeRequest {
  /** דקות להשתקה; ‎`0` = ביטול ההשתקה וחזרה לקבל התראות. */
  minutes: number;
  /** הבקשה הייתה ארוכה מהתקרה ונחתכה — התשובה חייבת לומר זאת. */
  clamped: boolean;
}

/** „ל-3 שעות”, „ל3 שעות”, „3 שעות” — המקף והתחילית אינם חלק מהמספר. */
function numberBefore(text: string, unit: RegExp): number | null {
  const digits = new RegExp(`(\\d{1,3})\\s*${unit.source}`, "u").exec(text);
  if (digits?.[1] !== undefined) return Number.parseInt(digits[1], 10);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`${word}\\s*${unit.source}`, "u").test(text)) return value;
  }
  return null;
}

/**
 * כמה דקות נותרו עד השעה `hour` בשעון ישראל, ביום הבא.
 *
 * ‏`jerusalemWallParts` ולא `getHours`: השרת רץ ב-UTC, ו„עד מחר
 * בבוקר” שנמדד בשעון המכונה היה מעיר את המתווך בחמש לפנות בוקר
 * בקיץ. כלל הזהב של `israel-time/device-clock`.
 */
function minutesUntilTomorrowMorning(now: Date): number {
  const { time } = jerusalemWallParts(now);
  const [hourText = "0", minuteText = "0"] = time.split(":");
  const nowMinutes = Number.parseInt(hourText, 10) * 60 + Number.parseInt(minuteText, 10);
  const target = MORNING_HOUR * 60;
  // אחרי חצות ולפני הבוקר, „מחר” הוא כבר היום הזה
  return nowMinutes < target ? target - nowMinutes : 24 * 60 - nowMinutes + target;
}

/**
 * ‎**„שקט לשעתיים” בכל ניסוח — בלי כפתור.**
 *
 * ההשתקה הייתה פקד כפתור בלבד: כל הודעת התראה נשאה אותו, גם
 * כשלא היה קשור למה שכתוב מעליה, ובלעדיו לא הייתה שום דרך
 * להשתיק. עכשיו זו אמירה — „שקט לחצי שעה”, „אל תפריע לי עד מחר”,
 * „תשתוק ל-3 שעות” — והכפתור אינו נחוץ עוד.
 *
 * מחזירה ‎`null` כשהמשפט אינו על השתקה בכלל, וההודעה ממשיכה
 * למנוע כרגיל. פענוח כאן ולא במודל: השתקה שגויה משתיקה את הסוכן
 * ליום, וזו טעות שהמתווך מגלה רק ממה שלא הגיע.
 */
export function parseSnoozeRequest(text: string, now: Date): SnoozeRequest | null {
  const cleaned = normalizeShort(text).replace(/[-–־]/gu, " ").replace(/\s+/gu, " ");
  /*
   * ‎**משפט ארוך אינו פקודת השתקה.**
   *
   * „תרשום בהערות שהלקוח ביקש שקט בבניין” מכיל „שקט” — ובלי
   * הגבול הזה היה משתיק את הסוכן לשעתיים במקום לרשום הערה.
   * בקשת השתקה אמיתית קצרה מטבעה: „אל תפריע לי עד מחר בבוקר”
   * הוא 24 תווים, והארוכה שבצורות אינה חוצה ארבעים.
   */
  if (cleaned.length > 40) return null;
  if (RESUME_PHRASES.some((phrase) => cleaned.includes(phrase))) {
    return { minutes: 0, clamped: false };
  }
  if (!QUIET_TRIGGERS.some((phrase) => cleaned.includes(phrase))) return null;

  const requested = ((): number => {
    // הסדר קובע: „שעה וחצי” ו„חצי שעה” מכילים שניהם „שעה”
    if (/חצי שעה/u.test(cleaned)) return 30;
    if (/רבע שעה/u.test(cleaned)) return 15;
    if (/שעה וחצי/u.test(cleaned)) return 90;
    if (/שעתיים/u.test(cleaned)) return 120;
    if (/עד מחר|עד הבוקר|למחר|עד בוקר/u.test(cleaned)) return minutesUntilTomorrowMorning(now);
    const hours = numberBefore(cleaned, /שעות/u);
    if (hours !== null) return hours * 60;
    const minutes = numberBefore(cleaned, /דק(?:ה|ות)/u);
    if (minutes !== null) return minutes;
    if (/יומיים|שבוע|כל היום/u.test(cleaned)) return MAX_SNOOZE_MINUTES + 1;
    if (/שעה/u.test(cleaned)) return 60;
    return DEFAULT_SNOOZE_MINUTES;
  })();

  // אפס דקות אינו „ביטול” אלא בקשה חסרת משמעות — ברירת המחדל עדיפה
  if (requested <= 0) return { minutes: DEFAULT_SNOOZE_MINUTES, clamped: false };
  return requested > MAX_SNOOZE_MINUTES
    ? { minutes: MAX_SNOOZE_MINUTES, clamped: true }
    : { minutes: requested, clamped: false };
}

/** „שעתיים”, „45 דקות”, „3 שעות” — כפי שאומרים את זה. */
export function snoozeDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} דקות`;
  if (minutes === 60) return "שעה";
  if (minutes === 90) return "שעה וחצי";
  if (minutes === 120) return "שעתיים";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} שעות` : `${(minutes / 60).toFixed(1)} שעות`;
}

/**
 * מה שהסוכן עונה על בקשת שקט.
 *
 * ‏**אומר את המשך בפועל ולא את מה שהתבקש**: מי שביקש „עד מחר”
 * ב-9 בבוקר מקבל שתים-עשרה שעות, וההודעה אומרת זאת במקום לאשר
 * בקשה שלא בוצעה. וגם אומר איך חוזרים — השתקה בלי דרך חזרה
 * מוכרת היא בדיוק הסיבה שמישהו לא ישתמש בה שוב.
 */
export function snoozeReply(request: SnoozeRequest): string {
  if (request.minutes === 0) {
    return "🔔 חוזרים לעדכונים. אעדכן אותך על כל מה שקורה.";
  }
  const label = snoozeDurationLabel(request.minutes);
  const head = request.clamped
    ? `🔕 שקט ל${label} — זו התקרה שלי, כדי שעדכון לא יתיישן ויאבד בדרך.`
    : `🔕 שקט ל${label}.`;
  return `${head}\nלא אפריע עד אז. אם תצטרכו משהו קודם פשוט כתבו לי, ואפשר גם „מספיק שקט” כדי לחזור מיד.`;
}
