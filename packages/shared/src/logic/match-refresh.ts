/**
 * רענון ההתאמות — **מה שקורה כשמשתנה משהו שאינו נכס ואינו קונה.**
 *
 * המנוע מחשב מחדש בכל יצירה ובכל עריכה, ובשני הכיוונים: נכס חדש
 * נסרק מול כל הקונים, קונה חדש מול כל הנכסים. זה מכסה כמעט הכול —
 * ומחמיץ בדיוק את מה שאינו נובע מרשומה בודדת:
 *
 * 1. **המשרד שינה את המשקלים.** מנהל שהעלה את משקל המיקום שינה
 *    הגדרה **כדי** לראות תוצאה אחרת, ורואה בדיוק את אותם ציונים.
 *    זה הכשל המטעה מכולם: המסך אישר "נשמר", והמספרים לא זזו.
 * 2. **המנוע עצמו שודרג.** מרחק אמיתי במקום השוואת שמות ערים חל רק
 *    על רשומה שמישהו נגע בה מאז; השאר נשארו עם הניקוד הישן.
 * 3. **הזמן עבר.** התאמת מועד הכניסה נמדדת מול `now` — נכס שהתפנה
 *    "בעוד שלושה חודשים" נכנס בשלב כלשהו לטווח של קונה שביקש
 *    כניסה מיידית, בלי שאיש ערך דבר.
 *
 * שלושתם מתוארים כאן בכלל אחד: **מה מחייב סבב, ומאיזו סיבה.**
 *
 * ## למה גרסת מנוע ולא "תמיד לרענן"
 *
 * סבב מלא הוא נכסים × קונים. להריץ אותו בכל עלייה של השרת היה הופך
 * כל פריסה לעומס, ולהריץ אותו לעולם לא היה משאיר ניקוד ישן במסך.
 * מחרוזת גרסה שמתעדכנת ידנית כשהניקוד משתנה היא ההצהרה המפורשת
 * "הפעם זה באמת אחר" — והיא נשמרת לצד תוצאת הסבב, כך שהשוואה פשוטה
 * עונה על השאלה.
 */

/** דרגת חיווי משותפת למסכים; זהה במשמעותה לזו של הגיבוי. */
export type MatchRefreshLevel = "ok" | "warn" | "danger";

/**
 * מה הזיז את הסבב. הסיבה נשמרת ומוצגת — "רועננו 84 נכסים" בלי למה
 * הוא שורת לוג, ועם למה הוא תשובה לשאלה ששאלו.
 */
export type MatchRefreshReason = "weights" | "engine" | "schedule" | "manual";

export const MATCH_REFRESH_REASON_LABELS: Record<MatchRefreshReason, string> = {
  weights: "שינוי משקלי ההתאמה",
  engine: "שדרוג מנוע ההתאמות",
  schedule: "סבב יומי",
  manual: "הופעל ידנית",
};

/**
 * גרסת מנוע ההתאמות.
 *
 * **מעלים אותה כשהניקוד משתנה** — קריטריון חדש, משקל ברירת מחדל
 * אחר, שינוי בסינון הגס. אין צורך להעלות על תיקון שאינו נוגע בציון.
 *
 * הפורמט הוא תאריך ותיאור קצר, כדי ששורת ה-JSON השמורה תהיה קריאה
 * גם בלי הקוד שלידה.
 */
export const MATCH_ENGINE_VERSION = "2026-08-16-custom-features";

/** כל כמה זמן סבב גם כשדבר לא השתנה — בגלל התלות ב-`now`. */
export const MATCH_REFRESH_INTERVAL_DAYS = 1;

/** מעבר לזה הסבב היומי כנראה אינו רץ, והמסך אומר זאת. */
export const MATCH_REFRESH_STALE_DAYS = 3;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** תוצאת הסבב האחרון, כפי שהיא נשמרת בהגדרות המשרד. */
export interface MatchRefreshState {
  /** מתי הסתיים (ISO). */
  at: string;
  /**
   * מתי הסבב **התחיל** (ISO) — וזה השדה שהחלטות נשענות עליו.
   *
   * שינוי משקלים שנשמר בזמן שסבב כבר רץ נופל בין הכיסאות אם משווים
   * לזמן הסיום: הסבב מסתיים אחרי השמירה, החותמת שלו מאוחרת ממנה,
   * ו-`matchRefreshDue` מסיק שהשינוי טופל — בעוד שהנכסים שנסרקו
   * לפניו קיבלו את המשקלים הישנים. מול זמן ההתחלה זה נתפס תמיד
   * (ביקורת Codex).
   */
  startedAt: string;
  reason: MatchRefreshReason;
  /** גרסת המנוע שרצה בפועל — זה מה שמאפשר לזהות שדרוג. */
  engineVersion: string;
  /** כמה נכסים נסרקו. */
  properties: number;
  /** כמה התאמות קיימות אחרי הסבב. */
  matches: number;
  /** כמה **נולדו** בו — זה מה שמעניין את הסוכן. */
  opened: number;
  durationMs: number;
  /**
   * `false` = הסבב נקטע באמצע (שגיאה, כיבוי השרת). הסבב הבא ירוץ
   * גם אם לפי הזמן עוד לא הגיע תורו: סבב חלקי משאיר חלק מהמאגר
   * בניקוד ישן, וזה בדיוק המצב שהמנגנון נועד למנוע.
   */
  ok: boolean;
}

export interface MatchRefreshInput {
  /** גרסת המנוע שרצה עכשיו — `MATCH_ENGINE_VERSION`. */
  engineVersion: string;
  /** מתי שונו המשקלים לאחרונה (ISO); `null` = מעולם לא. */
  weightsChangedAt: string | null;
}

/**
 * האם המשרד זקוק לסבב, ומאיזו סיבה. `null` = לא.
 *
 * הסדר אינו שרירותי — הוא סדר הדחיפות בהסבר שיוצג. משרד שגם שינה
 * משקלים וגם מריץ מנוע ישן יראה "שדרוג מנוע", כי זה ההסבר שמסביר
 * את השינוי הגדול מבין השניים.
 */
export function matchRefreshDue(
  state: MatchRefreshState | null,
  now: Date,
  input: MatchRefreshInput,
): MatchRefreshReason | null {
  // מעולם לא רץ — כולל משרד שקיים מלפני שהמנגנון נוסף
  if (state === null) return "schedule";
  if (state.engineVersion !== input.engineVersion) return "engine";
  if (!state.ok) return "schedule";

  /*
   * שינוי משקלים מפעיל סבב מיידי בשעת השמירה, וזו רשת הביטחון: אם
   * אותו סבב נפל או שהשרת ירד באמצע, החותמת נשארת מאוחרת מזמן
   * ההתחלה של הסבב האחרון והסורק יתפוס את זה.
   *
   * **מול `startedAt` ולא מול `at`** — ראו ההסבר על השדה עצמו.
   *
   * השוואת זמנים ולא השוואת מחרוזות: שתי החותמות אמנם נכתבות
   * ב-`toISOString`, אבל ערך שנערך ידנית ב-JSON בפורמט אחר היה נופל
   * בהשוואה לקסיקוגרפית **בשקט** — ומשקלים שהשתנו לא היו מפעילים
   * דבר.
   *
   * חותמת שאינה ניתנת לפענוח מדולגת בכוונה ואינה מחזירה "weights":
   * היא לא תתוקן מעצמה, וסבב שמופעל לפיה היה חוזר בכל תקתוק לנצח.
   * הסבב היומי מכסה את המקרה תוך יממה.
   */
  const changedAt =
    input.weightsChangedAt === null ? NaN : new Date(input.weightsChangedAt).getTime();
  if (!Number.isNaN(changedAt) && changedAt > new Date(state.startedAt).getTime()) {
    return "weights";
  }

  const ageDays = (now.getTime() - new Date(state.at).getTime()) / MS_PER_DAY;
  if (ageDays >= MATCH_REFRESH_INTERVAL_DAYS) return "schedule";
  return null;
}

export interface MatchRefreshSummary {
  level: MatchRefreshLevel;
  /** ימים מאז הסבב האחרון; `null` כשמעולם לא רץ. */
  ageDays: number | null;
  /** משפט אחד למסך. */
  headline: string;
}

/**
 * חיווי המצב למסך ההגדרות.
 *
 * ההבחנה שחשובה כאן היא בין "רץ ולא מצא מה לפתוח" לבין "לא רץ".
 * הראשון הוא ✓ — המאגר מעודכן; השני נראה זהה במסך תמים, ולכן הוא
 * מקבל דרגה משלו.
 */
export function summarizeMatchRefresh(
  state: MatchRefreshState | null,
  now: Date,
): MatchRefreshSummary {
  if (state === null) {
    return {
      level: "warn",
      ageDays: null,
      headline: "ההתאמות טרם חושבו מחדש בסבב מלא — הציונים עשויים להיות ישנים.",
    };
  }

  const ageDays = Math.floor((now.getTime() - new Date(state.at).getTime()) / MS_PER_DAY);

  if (!state.ok) {
    return {
      level: "danger",
      ageDays,
      headline: `הסבב האחרון נקטע אחרי ${state.properties} נכסים — חלק מהמאגר בניקוד ישן.`,
    };
  }
  if (ageDays >= MATCH_REFRESH_STALE_DAYS) {
    return {
      level: "warn",
      ageDays,
      headline: `הסבב האחרון רץ לפני ${ageDays} ימים — הסבב היומי כנראה אינו רץ.`,
    };
  }

  const when = ageDays === 0 ? "היום" : ageDays === 1 ? "אתמול" : `לפני ${ageDays} ימים`;
  const opened =
    state.opened === 0
      ? "בלי התאמות חדשות"
      : state.opened === 1
        ? "ונפתחה התאמה אחת חדשה"
        : `ונפתחו ${state.opened} התאמות חדשות`;
  return {
    level: "ok",
    ageDays,
    headline: `${state.properties} נכסים חושבו מחדש ${when} ${opened}.`,
  };
}

/**
 * טקסט ההתראה לבעלי המשרד בתום סבב שפתח התאמות.
 *
 * **התראה אחת לסבב, לא אחת לנכס.** הסבב נוגע בכל המאגר, ולכן
 * ההתראה הרגילה של "נמצאו קונים חדשים לנכס" הייתה מגיעה בעשרות
 * עותקים בלילה אחד — הדרך הבטוחה ביותר להרגיל משרד לכבות התראות.
 *
 * `null` כשלא נפתח דבר: סבב שלא שינה כלום אינו חדשה.
 */
export function matchRefreshNotice(
  state: MatchRefreshState,
): { title: string; body: string } | null {
  if (state.opened < 1) return null;
  const count =
    state.opened === 1 ? "התאמה אחת חדשה" : `${state.opened} התאמות חדשות`;
  return {
    title: `חישוב ההתאמות מחדש פתח ${count}`,
    body: `${MATCH_REFRESH_REASON_LABELS[state.reason]} — ${state.properties} נכסים נסרקו מול כל הקונים במאגר. פתחו את מסך ההתאמות כדי לראות מה נוסף.`,
  };
}
