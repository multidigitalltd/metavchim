import { jerusalemDayLabel, jerusalemWeekStart } from "./israel-time.js";

/**
 * ‎**מנוע היעדים של המנטור — חשבון טהור, בלי מסד ובלי שעון פנימי.**
 *
 * ## מה המנטור הזה אינו
 *
 * ‏הוא אינו מבקש מהמתווך לדווח. כל המספרים שהוא צריך כבר במערכת —
 * שיחות מהמרכזייה, לידים, פגישות ביומן, הצעות שנשלחו, עסקאות
 * שנסגרו. מה שחסר הוא **יעד להשוות אליו**, וזו כל תוספת הנתונים
 * כאן. אפליקציית יעדים מבקשת „סמן שעשית”; מנטור כבר יודע מה עשית.
 *
 * ## שלושת הדברים שהקובץ הזה יודע
 *
 * ‎**1. החישוב לאחור.** מתווך יודע כמה הוא רוצה להרוויח; הוא אינו
 * יודע כמה שיחות זה. `backwardPlan` עושה את החשבון מהיעד השנתי עד
 * „כמה שיחות ביום”, לפי **יחסי ההמרה שלו** ולא לפי ממוצע בענף.
 *
 * ‎**2. הציון השבועי.** לפי „The 12 Week Year”: מודדים **ביצוע**
 * ולא תוצאה, כי על התוצאה אי אפשר להשפיע השבוע. מי שמשלים 85%
 * מהפעולות שהתחייב להן — משיג את היעד.
 *
 * ‎**3. מה יש לומר עליו.** `mentorMoments` מחזירה את הרגעים שראויים
 * לפנייה: יעד שהושלם, יעד שכמעט הושלם, ושבוע שהיה חלש. השליחה
 * עצמה אינה כאן — כאן רק ההכרעה מה קרה.
 *
 * ## שתי הכרעות שנשענות על מחקר, ולא על תחושה
 *
 * ‎**אין רצפים.** הדחף לבנות „12 ימים ברצף” הוא בדיוק מה שמפיל
 * מוצרים כאלה: רצף שנשבר מוריד מוטיבציה **מתחת** לנקודת ההתחלה,
 * ומעקב „הכול או כלום” מוביל לנטישת ההרגל. לכן היעד השבועי הוא
 * תדירות — „5 מתוך 7” — ו-`missedTwoInARow` הוא הדגל היחיד שמסמן
 * החמצה, לפי הכלל „אף פעם לא פעמיים ברצף”.
 *
 * ‎**העידוד יושב על 85% ומעלה.** אפקט מדרג-היעד (Hull, 1932): המאמץ
 * עולה ככל שמתקרבים ליעד. „נשארו לך שלוש שיחות” ברגע הזה שווה יותר
 * מעשר תזכורות באמצע.
 */

/* ==========================================================================
 * ארבע רמות היעד
 * ========================================================================== */

/**
 * ‏ארבע הרמות, מהחזון ועד השבוע. כל רמה היא **חלוקה של זו שמעליה**
 * ולא רשימה נפרדת: השנתי הוא החלום, והשבועי הוא היחיד שאפשר לפעול
 * לפיו היום.
 *
 * ‎`cycle` הוא **13 שבועות**, ולא „חודשיים” כפי שנוסח בבקשה ולא 12
 * כפי שנוסח כאן תחילה. שתי הסיבות:
 *
 * ‎**1. היעדים חייבים להתחבר.** ‏4 × 12 = 48, כלומר ארבעה מחזורים
 * שכל אחד מהם הושג במלואו עדיין מפספסים את היעד השנתי בארבעה
 * שבועות. בדיקה שכתבתי כדי לוודא „ארבעה מחזורים מכסים שנה” נפלה על
 * זה, ובצדק: מנטור שהחשבון שלו אינו סוגר הוא מנטור שאי אפשר לסמוך
 * עליו. ‏4 × 13 = 52 בדיוק.
 *
 * ‎**2. מה שהשיטה באמת תורמת נשאר.** „The 12 Week Year” אינה בעיקר
 * אורך המחזור אלא **המדידה השבועית**: ציון על ביצוע ולא על תוצאה,
 * וסף 85% שמנבא עמידה ביעד. שני אלה חיים ב-`weeklyScore`, והם
 * שרירים ללא קשר לאורך המחזור.
 */
export const GOAL_HORIZONS = ["year", "half", "cycle", "week"] as const;
export type GoalHorizon = (typeof GOAL_HORIZONS)[number];

/** אורך כל אופק בשבועות — הבסיס לכל פריסה של יעד לרמה שמתחתיו. */
export const HORIZON_WEEKS: Record<GoalHorizon, number> = {
  year: 52,
  half: 26,
  /* רבע שנה בדיוק — ראו ההסבר למעלה על 4 × 13 */
  cycle: 13,
  week: 1,
};

/**
 * ‏במה נמדד היעד. שלוש יחידות ולא אחת: יש מי שמנהל את עצמו לפי
 * עמלות, יש מי שסופר עסקאות, ויש מי שכל הרבעון שלו הוא „כמה
 * בלעדיות הבאתי”. החישוב לאחור עובד מכולן.
 */
export const GOAL_UNITS = ["commission", "deals", "exclusives"] as const;
export type GoalUnit = (typeof GOAL_UNITS)[number];

/**
 * ‏פעולות שהמתווך שולט בהן, ושהמערכת יודעת לספור לבד. אלה „מדדים
 * מובילים”: הם מנבאים את התוצאה, ואפשר לתקן אותם עוד השבוע — בניגוד
 * לעסקה שנסגרת בעוד חודשיים.
 */
export const LEAD_MEASURES = ["calls", "appointments", "offers", "listings"] as const;
export type LeadMeasure = (typeof LEAD_MEASURES)[number];

/* ==========================================================================
 * החישוב לאחור
 * ========================================================================== */

/**
 * יחסי ההמרה של המתווך — כולם 0..1.
 *
 * ‎**נגזרים מההיסטוריה שלו, ולא מממוצע בענף.** מתווך שסוגר אחד
 * מכל שש פגישות צריך תוכנית אחרת ממי שסוגר אחד משלוש, ותוכנית
 * שנבנתה על ממוצע היא תוכנית של מישהו אחר.
 */
export interface ConversionRatios {
  /** שיחה ⇒ פגישה */
  callToAppointment: number;
  /** פגישה ⇒ הצעה שנשלחה */
  appointmentToOffer: number;
  /** הצעה ⇒ עסקה שנסגרה */
  offerToDeal: number;
}

/**
 * ‏ברירות מחדל ענפיות — **לשימוש רק עד שיש היסטוריה משלו**, ומסומנות
 * ככאלה במסך. מספר שהומצא ומוצג כעובדה גרוע ממספר חסר.
 *
 * הטווחים לקוחים ממדדי ליווי מקובלים בענף: שיחה→פגישה בטווח החד-ספרתי
 * הנמוך, פגישה→חוזה מעל 60%, וחוזה→סגירה גבוה. אלה נקודות פתיחה
 * שמרניות, לא הבטחה.
 */
export const DEFAULT_RATIOS: ConversionRatios = {
  callToAppointment: 0.08,
  appointmentToOffer: 0.6,
  offerToDeal: 0.12,
};

export interface BackwardPlanInput {
  /** היעד השנתי, ביחידה שנבחרה. עמלות — באגורות. */
  target: number;
  unit: GoalUnit;
  /** עמלה ממוצעת לעסקה, באגורות. נדרש רק ל-`commission`. */
  averageCommissionAgorot?: number;
  ratios: ConversionRatios;
  /** ימי עבודה בשבוע. חמישה בברירת מחדל — א׳–ה׳. */
  workDaysPerWeek?: number;
}

export interface BackwardPlan {
  /** עסקאות שנדרשות לשנה כדי לעמוד ביעד. */
  dealsPerYear: number;
  offersPerYear: number;
  appointmentsPerYear: number;
  callsPerYear: number;
  /** השורה היחידה שמשנה מחר בבוקר. */
  callsPerWorkday: number;
  appointmentsPerWeek: number;
  /**
   * ‎`true` כשאי אפשר לחשב — אין עמלה ממוצעת, או שאחד היחסים אפס.
   * מסך שמציג „0 שיחות ביום” על חישוב שלא רץ משקר בשקט.
   */
  incomplete: boolean;
}

/** חלוקה שמחזירה `null` במקום `Infinity` — אפס אינו יחס המרה. */
function over(value: number, ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return value / ratio;
}

/**
 * ‎**מהיעד ועד „כמה שיחות היום”.**
 *
 * ‏זה הלב של המנטור. מתווך יודע כמה הוא רוצה להרוויח ואינו יודע מה
 * זה אומר על יום שני בבוקר; החשבון הזה הוא הגשר.
 *
 * ‏העיגול הוא **כלפי מעלה בכל שלב**, ובכוונה: תוכנית שמעגלת כלפי
 * מטה מייצרת יעד שמי שיעמוד בו בדיוק עדיין יפספס. עדיף להתחייב
 * לשיחה אחת יותר.
 */
export function backwardPlan(input: BackwardPlanInput): BackwardPlan {
  const empty: BackwardPlan = {
    dealsPerYear: 0,
    offersPerYear: 0,
    appointmentsPerYear: 0,
    callsPerYear: 0,
    callsPerWorkday: 0,
    appointmentsPerWeek: 0,
    incomplete: true,
  };
  if (!Number.isFinite(input.target) || input.target <= 0) return empty;

  /*
   * ‎**„עסקאות” ו„בלעדיות” הן כבר ספירה** — אין להן עמלה ממוצעת
   * לחלק בה. רק יעד בעמלות עובר המרה לכסף, ובלי עמלה ממוצעת אין
   * חישוב כלל: להניח אותה פירושו להמציא את כל התוכנית.
   */
  const dealsPerYear =
    input.unit !== "commission"
      ? Math.ceil(input.target)
      : input.averageCommissionAgorot !== undefined &&
          input.averageCommissionAgorot > 0
        ? Math.ceil(input.target / input.averageCommissionAgorot)
        : null;
  if (dealsPerYear === null) return empty;

  const offers = over(dealsPerYear, input.ratios.offerToDeal);
  const appointments =
    offers === null ? null : over(Math.ceil(offers), input.ratios.appointmentToOffer);
  const calls =
    appointments === null
      ? null
      : over(Math.ceil(appointments), input.ratios.callToAppointment);
  if (offers === null || appointments === null || calls === null) {
    return { ...empty, dealsPerYear };
  }

  const workDays = input.workDaysPerWeek ?? 5;
  const callsPerYear = Math.ceil(calls);
  const appointmentsPerYear = Math.ceil(appointments);
  return {
    dealsPerYear,
    offersPerYear: Math.ceil(offers),
    appointmentsPerYear,
    callsPerYear,
    callsPerWorkday: Math.ceil(callsPerYear / (HORIZON_WEEKS.year * workDays)),
    appointmentsPerWeek: Math.ceil(appointmentsPerYear / HORIZON_WEEKS.year),
    incomplete: false,
  };
}

/**
 * ‏פריסת יעד שנתי לאופק קצר יותר — פרופורציונלית לשבועות.
 *
 * ‏עיגול כלפי מעלה, מאותו טעם כמו בחישוב לאחור: יעד רבעוני שנגזר
 * כלפי מטה ארבע פעמים מפספס את השנתי.
 */
export function splitToHorizon(yearlyTarget: number, horizon: GoalHorizon): number {
  if (!Number.isFinite(yearlyTarget) || yearlyTarget <= 0) return 0;
  return Math.ceil((yearlyTarget * HORIZON_WEEKS[horizon]) / HORIZON_WEEKS.year);
}

/* ==========================================================================
 * הציון השבועי
 * ========================================================================== */

/** מה שהמתווך התחייב לו השבוע, ומה שהמערכת ספרה בפועל. */
export type WeeklyCommitment = Partial<Record<LeadMeasure, number>>;
export type WeeklyActual = Partial<Record<LeadMeasure, number>>;

export interface WeeklyScore {
  /** אחוז ביצוע 0..100, ממוצע על הפעולות שהתחייב להן. */
  percent: number;
  /** ‎`true` מ-85% ומעלה — הסף שמנבא עמידה ביעד. */
  onTrack: boolean;
  /** פירוט לכל פעולה: מה הובטח, מה נעשה, וכמה חסר. */
  lines: {
    measure: LeadMeasure;
    committed: number;
    actual: number;
    remaining: number;
    percent: number;
  }[];
}

/** הסף של „The 12 Week Year”: 85% ביצוע מנבא עמידה ביעד. */
export const ON_TRACK_THRESHOLD = 85;

/**
 * ‎**הציון הוא על ביצוע, לא על תוצאה.**
 *
 * ‏זו ההכרעה המרכזית של השיטה, והיא גם ההוגנת: מתווך ששוחח עם
 * ארבעים אנשים בשבוע שבו איש לא קנה עשה את העבודה. ציון על עסקאות
 * היה מעניש אותו על החלטות של אחרים.
 *
 * ‎**עודף אינו מפצה על חוסר.** כל פעולה נחתכת ב-100% לפני הממוצע,
 * אחרת מאה שיחות ביום אחד היו „מכסות” אפס פגישות — וזה בדיוק הסוג
 * של ציון שנראה טוב ואינו אומר דבר.
 */
export function weeklyScore(
  committed: WeeklyCommitment,
  actual: WeeklyActual,
): WeeklyScore {
  const lines = LEAD_MEASURES.filter(
    (m) => (committed[m] ?? 0) > 0,
  ).map((measure) => {
    const target = committed[measure] ?? 0;
    const done = actual[measure] ?? 0;
    return {
      measure,
      committed: target,
      actual: done,
      remaining: Math.max(0, target - done),
      percent: Math.min(100, Math.round((done / target) * 100)),
    };
  });
  if (lines.length === 0) return { percent: 0, onTrack: false, lines: [] };
  const percent = Math.round(
    lines.reduce((sum, l) => sum + l.percent, 0) / lines.length,
  );
  return { percent, onTrack: percent >= ON_TRACK_THRESHOLD, lines };
}

/* ==========================================================================
 * מה יש לומר, ומתי
 * ========================================================================== */

export type MomentKind =
  /** יעד שבועי הושלם — חוגגים. */
  | "week_complete"
  /** קרוב מאוד ליעד — זה הרגע שבו עידוד עובד הכי טוב. */
  | "almost_there"
  /** אמצע שבוע ומאחור — עוד אפשר לתקן. */
  | "midweek_behind"
  /** שבוע שני ברציפות מתחת לסף — לא נזיפה, שאלה. */
  | "two_weak_weeks"
  /** התקדמות מול התקופה הקודמת — ההשוואה שמראה כמה השתנה. */
  | "period_progress";

export interface MentorMoment {
  kind: MomentKind;
  /** הפעולה שהרגע מדבר עליה, כשהוא ספציפי לאחת. */
  measure?: LeadMeasure;
  /** כמה חסר עד היעד — ל„almost_there” ול„midweek_behind”. */
  remaining?: number;
  percent: number;
}

export interface MomentInput {
  score: WeeklyScore;
  /** יום בשבוע ישראלי, 0 ראשון … 6 שבת. */
  weekday: number;
  /** הציון של השבוע שעבר, אם היה. */
  previousPercent?: number;
}

/**
 * ‎**מתי יש למנטור מה לומר — ומתי עדיף שישתוק.**
 *
 * ‏ההחלטה הזו היא כל ההבדל בין ליווי לבין ספאם. מנטור שמדבר בכל
 * יום נעשה רעש שמסננים, ואז גם ההודעה שבאמת חשובה לא נקראת.
 *
 * ‏הפונקציה מחזירה **מערך**, ואפשר שיהיה ריק — וזו התשובה הנפוצה.
 */
export function mentorMoments(input: MomentInput): MentorMoment[] {
  const { score, weekday } = input;
  const out: MentorMoment[] = [];
  if (score.lines.length === 0) return out;

  if (score.percent >= 100) {
    out.push({ kind: "week_complete", percent: score.percent });
    return out;
  }

  /*
   * ‎**מדרג-היעד.** ‏המאמץ עולה מעצמו ככל שמתקרבים, ותפקיד ההודעה
   * הוא רק לומר כמה נשאר. הפעולה שנבחרת היא זו שהכי קרובה לסיום
   * מבין החסרות — היא הניצחון הזמין.
   */
  if (score.percent >= ON_TRACK_THRESHOLD) {
    const closest = [...score.lines]
      .filter((l) => l.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining)[0];
    if (closest !== undefined) {
      out.push({
        kind: "almost_there",
        measure: closest.measure,
        remaining: closest.remaining,
        percent: score.percent,
      });
    }
    return out;
  }

  /*
   * ‏אמצע שבוע בלבד: ביום ראשון אין על מה לדבר, ובשישי כבר מאוחר
   * מכדי לתקן — והודעה שאי אפשר לפעול לפיה היא רק אשמה.
   */
  if (weekday >= 2 && weekday <= 3) {
    const biggest = [...score.lines].sort((a, b) => b.remaining - a.remaining)[0];
    if (biggest !== undefined && biggest.remaining > 0) {
      out.push({
        kind: "midweek_behind",
        measure: biggest.measure,
        remaining: biggest.remaining,
        percent: score.percent,
      });
    }
  }

  /*
   * ‎**שבוע חלש אחד אינו סיפור.** שניים ברציפות כן, וגם אז זו שאלה
   * („מה עצר אותך?”) ולא נזיפה: המכשול הוא המידע שאפשר לעבוד איתו,
   * ותוכנית „אם-אז” נבנית עליו.
   */
  if (
    input.previousPercent !== undefined &&
    input.previousPercent < ON_TRACK_THRESHOLD &&
    weekday === 0
  ) {
    out.push({ kind: "two_weak_weeks", percent: score.percent });
  }
  return out;
}

/* ==========================================================================
 * „איפה היית, ואיפה אתה”
 * ========================================================================== */

export interface PeriodComparison {
  current: number;
  previous: number;
  /** שינוי באחוזים; `null` כשהתקופה הקודמת הייתה אפס. */
  changePercent: number | null;
  direction: "up" | "down" | "same";
}

/**
 * ‎**ההשוואה שביקש בעל המוצר: „איפה היית לפני תקופה”.**
 *
 * ‏`null` באחוז השינוי כשהתקופה הקודמת הייתה אפס — ולא „עלייה של
 * 100%” ולא „אינסוף”. מי שסגר עסקה ראשונה לא השתפר באחוזים, הוא
 * התחיל, וזה משפט אחר לגמרי.
 */
export function comparePeriods(current: number, previous: number): PeriodComparison {
  const direction = current > previous ? "up" : current < previous ? "down" : "same";
  return {
    current,
    previous,
    changePercent:
      previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
    direction,
  };
}

/* ==========================================================================
 * גבולות השבוע
 * ========================================================================== */

/**
 * מזהה השבוע שאליו שייך רגע נתון — `YYYY-MM-DD` של יום ראשון שלו,
 * בשעון ישראל.
 *
 * ‏מחרוזת ולא חותמת זמן: זה מפתח של שורה בטבלה, והוא חייב להיות
 * יציב וקריא. שבוע נמדד לפי הלוח של המשרד, לא לפי שעון המכשיר של מי
 * שפתח את המסך.
 */
export function weekKey(at: Date): string {
  return jerusalemDayLabel(jerusalemWeekStart(at));
}
