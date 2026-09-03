import {
  jerusalemDayLabel,
  jerusalemDayStart,
  jerusalemWeekStart,
} from "./israel-time.js";

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
 * ‎**במה נמדד היעד — ושתי משפחות, לא רשימה אחת.**
 *
 * ‎**תוצאה** (עמלות, עסקאות, בלעדיות) היא מה שהמתווך רוצה שיקרה,
 * ואין לו שליטה ישירה עליה: היא נסגרת בהחלטה של מישהו אחר, ולעתים
 * חודשיים אחרי העבודה שהביאה אליה.
 *
 * ‎**פעילות** (לידים, שיחות) היא מה שהוא עושה בעצמו, והיא היחידה
 * שאפשר להתחייב לה מחר בבוקר.
 *
 * ‏שתיהן יעדים לגיטימיים, והן מתנהגות אחרת בחישוב לאחור: יעד תוצאה
 * עובר במשפך ההמרה, ויעד פעילות רק נפרס על השנה — כי הוא **כבר**
 * המספר שנמדד. להעביר „1,000 שיחות” במשפך היה ממציא שלב שאינו קיים.
 */
export const GOAL_UNITS = [
  "commission",
  "deals",
  "exclusives",
  "leads",
  "calls",
] as const;
export type GoalUnit = (typeof GOAL_UNITS)[number];

/**
 * ‏לאיזו משפחה שייכת כל יחידה. המסך מקבץ לפי זה, והחישוב לאחור
 * מסתעף לפי זה — ובדיקה מוודאת שהמפה והענף אומרים אותו דבר.
 */
export const GOAL_UNIT_KIND: Record<GoalUnit, "result" | "activity"> = {
  commission: "result",
  deals: "result",
  exclusives: "result",
  leads: "activity",
  calls: "activity",
};

/** שם היחידה בעברית — לכל מקום שמציג יעד. */
export const GOAL_UNIT_LABELS: Record<GoalUnit, string> = {
  commission: "עמלות",
  deals: "עסקאות",
  exclusives: "בלעדיות",
  leads: "לידים חדשים",
  calls: "שיחות יוצאות",
};

/**
 * ‎**מה הטופס אומר על כל יחידה — ולמה לכל אחת משפט משלה.**
 *
 * ‏המשפטים היו קודם לפי **משפחה**, ואז המשפחה „תוצאה” הבטיחה חישוב
 * לאחור „עד כמה שיחות ביום” גם ל„בלעדיות” — שעבורן `backwardPlan`
 * מחזירה `incomplete` והכרטיס אינו מוצג כלל. כלומר הטופס הבטיח פלט
 * שלעולם אינו מגיע, וזה בדיוק הכשל שהמסך הזה נבנה כדי למנוע.
 *
 * ‏משפט לכל יחידה אינו יכול להיסדק כך, ובדיקה מריצה את `backwardPlan`
 * על כל יחידה ומוודאת שמה שנכתב כאן מתאים למה שהיא באמת מחזירה.
 */
export const GOAL_UNIT_NOTES: Record<GoalUnit, string> = {
  commission:
    "נסגר בהחלטה של מישהו אחר, לפעמים חודשיים אחרי העבודה שהביאה אליו. מכאן אני עושה את החשבון אחורה עד כמה שיחות ביום.",
  deals:
    "נסגר בהחלטה של מישהו אחר, לפעמים חודשיים אחרי העבודה שהביאה אליו. מכאן אני עושה את החשבון אחורה עד כמה שיחות ביום.",
  exclusives:
    "בלעדיות מגיעות מהצד של בעל הנכס — פנייה, הערכת שווי, חתימה — ולא ממשפך הקונים. היעד נשמר ונמדד, אבל חישוב לאחור לא יוצג כאן: הוא היה מבוסס על יחס המרה שאינו קיים.",
  leads:
    "בשליטה מלאה שלך, ואפשר להתחייב לזה כבר מחר בבוקר. אין כאן חשבון אחורה — היעד עצמו הוא המספר, ואני רק פורס אותו על השבועות.",
  calls:
    "בשליטה מלאה שלך, ואפשר להתחייב לזה כבר מחר בבוקר. אין כאן חשבון אחורה — היעד עצמו הוא המספר, ואני רק מחלק אותו לימי העבודה.",
};

/**
 * ‏פעולות שהמתווך שולט בהן, ושהמערכת יודעת לספור לבד. אלה „מדדים
 * מובילים”: הם מנבאים את התוצאה, ואפשר לתקן אותם עוד השבוע — בניגוד
 * לעסקה שנסגרת בעוד חודשיים.
 */
export const LEAD_MEASURES = [
  "calls",
  "leads",
  "appointments",
  "offers",
  "listings",
] as const;
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

/**
 * ‎**כל שורה היא `number | null`, ו-`null` אינו אפס.**
 *
 * ‏אפס הוא טענה — „לא צריך שיחות”. `null` הוא היעדר טענה: השורה לא
 * חושבה, ולכן אינה מוצגת. ההבחנה נחוצה מרגע שיש יעדי פעילות: מיעד
 * של „1,000 שיחות” ידועות השיחות בלבד, ולהציג לצידן „0 עסקאות” היה
 * אומר למתווך שהתוכנית שלו אינה מובילה לשום עסקה.
 */
export interface BackwardPlan {
  /** עסקאות שנדרשות לשנה כדי לעמוד ביעד. */
  dealsPerYear: number | null;
  offersPerYear: number | null;
  appointmentsPerYear: number | null;
  callsPerYear: number | null;
  leadsPerYear: number | null;
  /** השורה היחידה שמשנה מחר בבוקר. */
  callsPerWorkday: number | null;
  appointmentsPerWeek: number | null;
  leadsPerWeek: number | null;
  /**
   * ‎`true` כשאין ולו שורה אחת לחשב — אין עמלה ממוצעת, אחד היחסים
   * אפס, או יחידה שאין לה משפך. מסך שמציג „0 שיחות ביום” על חישוב
   * שלא רץ משקר בשקט, ולכן הכרטיס כולו אינו מוצג.
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
    dealsPerYear: null,
    offersPerYear: null,
    appointmentsPerYear: null,
    callsPerYear: null,
    leadsPerYear: null,
    callsPerWorkday: null,
    appointmentsPerWeek: null,
    leadsPerWeek: null,
    incomplete: true,
  };
  if (!Number.isFinite(input.target) || input.target <= 0) return empty;

  const workDays = input.workDaysPerWeek ?? 5;

  /*
   * ‎**יעד פעילות אינו עובר במשפך — הוא כבר המספר שנמדד.**
   *
   * ‏„1,000 שיחות השנה” הוא יעד שלם בפני עצמו, ומה שחסר עליו הוא
   * חלוקה: כמה זה ביום עבודה. להריץ אותו דרך `callToAppointment`
   * היה עונה על שאלה אחרת לגמרי — כמה שיחות נדרשות כדי להגיע
   * לעסקאות שמספרן לא נאמר.
   *
   * ‏שאר השורות נשארות `null`: מיעד שיחות אי אפשר לגזור כמה עסקאות
   * ייסגרו בלי לדעת מה המתווך רוצה להרוויח.
   */
  if (input.unit === "leads" || input.unit === "calls") {
    const perYear = Math.ceil(input.target);
    return input.unit === "leads"
      ? {
          ...empty,
          leadsPerYear: perYear,
          leadsPerWeek: Math.ceil(perYear / HORIZON_WEEKS.year),
          incomplete: false,
        }
      : {
          ...empty,
          callsPerYear: perYear,
          callsPerWorkday: Math.ceil(perYear / (HORIZON_WEEKS.year * workDays)),
          incomplete: false,
        };
  }

  /*
   * ‎**„בלעדיות” אינן עסקאות, ואין להן משפך** (ביקורת Codex, P2).
   *
   * ‏המשפך כאן הוא שיחה ⇐ פגישה ⇐ הצעה ⇐ **עסקה**, ויחסי ההמרה
   * מתארים קונים. בלעדיות מגיעות מהצד השני לגמרי — פנייה לבעל
   * נכס, הערכת שווי, חתימה — ואין ביניהן ובין `offerToDeal` שום
   * יחס. עד כה 20 בלעדיות הוצגו כ„20 עסקאות, 167 הצעות ו-3,472
   * שיחות”, כלומר תוכנית שלמה שנבנתה על יחס שאינו קיים.
   *
   * ‎`incomplete` ולא ניחוש: המסך אינו מציג את כרטיס „מה זה אומר
   * על מחר בבוקר” על יעד בלעדיות, ומספר שהומצא גרוע ממספר חסר.
   * (משפך בלעדיות משלו — פניות לבעלי נכסים, הערכות שווי — הוא
   * מדידה שהמערכת עדיין אינה עושה.)
   */
  if (input.unit === "exclusives") return empty;

  /*
   * ‎**„עסקאות” היא כבר ספירה** — אין לה עמלה ממוצעת לחלק בה. רק
   * יעד בעמלות עובר המרה לכסף, ובלי עמלה ממוצעת אין חישוב כלל:
   * להניח אותה פירושו להמציא את כל התוכנית.
   */
  const dealsPerYear =
    input.unit === "deals"
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

  const callsPerYear = Math.ceil(calls);
  const appointmentsPerYear = Math.ceil(appointments);
  return {
    dealsPerYear,
    offersPerYear: Math.ceil(offers),
    appointmentsPerYear,
    callsPerYear,
    callsPerWorkday: Math.ceil(callsPerYear / (HORIZON_WEEKS.year * workDays)),
    appointmentsPerWeek: Math.ceil(appointmentsPerYear / HORIZON_WEEKS.year),
    /*
     * ‏המשפך מתאר קונים ואינו יודע כמה **לידים** נדרשים: ליד מגיע
     * משיווק, מהפניה או ממודעה, ואין יחס המרה בין שיחה לליד שהמערכת
     * מודדת. `null` ולא ניחוש.
     */
    leadsPerYear: null,
    leadsPerWeek: null,
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

/**
 * ‎**קריאת התחייבות מ-JSON — במקום אחד לשני התהליכים.**
 *
 * ‏ה-API קורא אותה כדי להציג את הציון, והסורק היומי קורא אותה כדי
 * להחליט אם הסוכן סגר את השבוע. שני מפענחים נפרדים לאותו JSON הם
 * שתי דעות על מה נחשב התחייבות — ומספיק שאחד מהם יקבל אפס או ערך
 * שלילי כדי שהמנהל יקבל חגיגה על שבוע שהסוכן רואה כלא-סגור.
 *
 * ‏רק מספר חיובי הוא התחייבות: אפס פירושו „לא התחייבתי לזה”, ולא
 * „התחייבתי לכלום”.
 */
export function parseWeeklyCommitment(value: unknown): WeeklyCommitment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: WeeklyCommitment = {};
  for (const measure of LEAD_MEASURES) {
    const n = raw[measure];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[measure] = Math.floor(n);
  }
  return out;
}

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
  /**
   * ‎**ציוני השבועות ש*הסתיימו*, מהאחרון אחורה.**
   *
   * ‏מערך ולא מספר בודד, וזה תיקון של באג ולא הרחבה (ביקורת Codex,
   * P2). ‏עד כה נבדק „השבוע שעבר היה חלש” ביום ראשון, ואז **השבוע
   * הנוכחי חלש מעצם היותו בן יום אחד** — כך ש„שבוע שני ברציפות”
   * נשלח אחרי שבוע חלש **אחד**. מנטור שסופר לא נכון גרוע ממנטור
   * ששותק, כי אי אפשר לסמוך על שום דבר אחר שהוא אומר.
   *
   * ‏שני האיברים הראשונים הם שני השבועות השלמים האחרונים, ורק
   * כששניהם מתחת לסף יש „פעמיים ברצף”.
   */
  previousPercents?: number[];
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
   *
   * ‎**שני השבועות שנספרים הם שבועות שהסתיימו.** השבוע הנוכחי אינו
   * אחד מהם: ביום ראשון הוא בן יום אחד וממילא מתחת לסף, וספירה
   * שכוללת אותו הייתה שולחת „פעמיים ברצף” על שבוע חלש אחד.
   */
  const completed = input.previousPercents ?? [];
  if (
    weekday === 0 &&
    completed.length >= 2 &&
    completed[0]! < ON_TRACK_THRESHOLD &&
    completed[1]! < ON_TRACK_THRESHOLD
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

/** תקופה של יעד — שני תאריכים בשעון ישראל, `YYYY-MM-DD`. */
export interface GoalPeriod {
  start: string;
  end: string;
}

/**
 * ‎`YYYY-MM-DD` ⇒ חותמת UTC של אותו תאריך — חשבון לוח בלי שעון קיץ.
 *
 * ‏התווית כבר בשעון ישראל; מה שנדרש כאן הוא רק המרחק **בימי לוח**
 * בינה לבין אחרת, ו-`Date.UTC` נותן בדיוק את זה.
 */
function dayNumber(label: string): number {
  const [y, m, d] = label.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** מספר הימים באותה שנה — 365, או 366 בשנה מעוברת. */
function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

/**
 * ‎**התקופה שאליה שייך יעד עכשיו — נגזרת, ולא נשלחת מהמסך.**
 *
 * ‏אילו הלקוח היה שולח תאריכים, שני מכשירים באזורי זמן שונים היו
 * יוצרים שתי שורות „לאותה תקופה”, והאילוץ הייחודי במסד לא היה
 * מונע זאת: הוא כולל את `period_start`.
 *
 * ‎**העיגון הוא ה-1 בינואר, וכל האופקים מרוצפים ממנו** — כך
 * שמחזורים מתחברים לחצאים, וחצאים לשנה, בלי חורים ובלי חפיפה.
 * המחזור האחרון בשנה נמתח עד 31 בדצמבר: 4 × 13 שבועות הם 364
 * ימים, והיום או היומיים שנשארים חייבים להיות שייכים למישהו —
 * אחרת נוצר יום שבו „אין מחזור פעיל”, והמנטור שותק בדיוק בסוף
 * השנה.
 *
 * ‎`week` הוא היחיד שאינו מרוצף מינואר אלא מיום ראשון של השבוע
 * הנוכחי: השבוע הוא יחידת הביצוע, ושבוע שנחתך באמצע בגלל גבול
 * שנה הוא ציון שלא אומר דבר.
 */
export function goalPeriod(horizon: GoalHorizon, now: Date): GoalPeriod {
  if (horizon === "week") {
    const start = jerusalemWeekStart(now);
    return {
      start: jerusalemDayLabel(start),
      end: jerusalemDayLabel(jerusalemDayStart(start, 6)),
    };
  }

  const year = Number(jerusalemDayLabel(now).slice(0, 4));
  const yearStart = jerusalemDayStart(new Date(Date.UTC(year, 0, 1, 12)));
  const total = daysInYear(year);
  if (horizon === "year") {
    return {
      start: jerusalemDayLabel(yearStart),
      end: jerusalemDayLabel(jerusalemDayStart(yearStart, total - 1)),
    };
  }

  const span = HORIZON_WEEKS[horizon] * 7;
  const blocks = Math.round(HORIZON_WEEKS.year / HORIZON_WEEKS[horizon]);
  /*
   * ‎**הימים נספרים בלוח, לא בחלוקת מילישניות** (ביקורת Codex, P2).
   *
   * ‏חיסור שתי חצות ישראליות וחלוקה ב-24 שעות טועה ביום שלם אחרי
   * מעבר השעון באביב: הטווח מכיל יממה בת 23 שעות, ולכן ה-2 באפריל
   * 2026 יצא 90 ימים במקום 91. התוצאה אינה קוסמטית — היום הראשון
   * של מחזור חדש עדיין נספר לקודם, ויעד שנקבע בו נשמר לתקופה
   * שנגמרה ונעלם למחרת.
   *
   * ‏התוויות הן `YYYY-MM-DD` בשעון ישראל, ולכן `Date.UTC` עליהן הוא
   * חשבון לוח טהור שאין בו שעון קיץ כלל.
   */
  const elapsed = Math.round(
    (dayNumber(jerusalemDayLabel(now)) - dayNumber(jerusalemDayLabel(yearStart))) /
      86_400_000,
  );
  /* ‏הימים שמעבר לריצוף שייכים לבלוק האחרון, ולא לבלוק חמישי */
  const index = Math.min(blocks - 1, Math.floor(elapsed / span));
  const last = index === blocks - 1;
  return {
    start: jerusalemDayLabel(jerusalemDayStart(yearStart, index * span)),
    end: jerusalemDayLabel(
      jerusalemDayStart(yearStart, (last ? total : (index + 1) * span) - 1),
    ),
  };
}

/* ==========================================================================
 * ‏מה המנטור אומר
 * ========================================================================== */

/** שמות הפעולות בעברית — לכל מקום שמציג מדד. */
export const LEAD_MEASURE_LABELS: Record<LeadMeasure, string> = {
  calls: "שיחות",
  leads: "לידים חדשים",
  appointments: "פגישות",
  offers: "הצעות",
  listings: "נכסים חדשים",
};

/** שמות הרמות. */
export const GOAL_HORIZON_LABELS: Record<GoalHorizon, string> = {
  year: "השנה",
  half: "חצי שנה",
  cycle: "המחזור",
  week: "השבוע",
};

/** צורת יחיד, לניסוח „נשארה שיחה אחת”. */
const MEASURE_SINGULAR: Record<LeadMeasure, string> = {
  calls: "שיחה אחת",
  leads: "ליד אחד",
  appointments: "פגישה אחת",
  offers: "הצעה אחת",
  listings: "נכס אחד",
};

export interface MentorLine {
  /** ‏הכותרת — משפט אחד, זה שנקרא. */
  title: string;
  /** ‏השורה שמתחת: מה לעשות, או למה זה חשוב. */
  body: string;
  /** ‏הטון, לצבע ולאייקון במסך. */
  tone: "celebrate" | "push" | "steady" | "ask";
}

/**
 * ‎**המילים של המנטור — במקום אחד, לשני הפיות.**
 *
 * ‏המסך והוואטסאפ חייבים לומר את אותו דבר: מתווך שקיבל „נשארו לך
 * שלוש שיחות” בהודעה ורואה במסך ניסוח אחר מקבל שני מנטורים. הנוסח
 * כאן, והשליחה במקום אחר.
 *
 * ‎**כל משפט כאן הוא החלטה על טון**, ולא מילוי תבנית:
 *
 * ‎`week_complete` — חוגגים **את מה שהוא עשה**, ולא את המספר. „100%”
 * הוא ציון; „עמדת בכל מה שהתחייבת לו” הוא משפט של אדם.
 *
 * ‎`almost_there` — נוקבים במספר המדויק שנשאר. „כמעט שם” בלי מספר
 * הוא עידוד ריק; „נשארו שלוש שיחות” הוא משימה שאפשר לסיים היום.
 *
 * ‎`two_weak_weeks` — **שאלה, לא נזיפה.** מנטור אמיתי שואל „מה עצר
 * אותך”, כי המכשול הוא המידע שאפשר לעבוד איתו. „לא עמדת ביעד
 * פעמיים” הוא משפט שגורם לאנשים לסגור את האפליקציה.
 */
export function mentorLine(moment: MentorMoment): MentorLine {
  const measure = moment.measure;
  const remaining = moment.remaining ?? 0;
  const noun =
    measure === undefined
      ? ""
      : remaining === 1
        ? MEASURE_SINGULAR[measure]
        : `${remaining} ${LEAD_MEASURE_LABELS[measure]}`;

  switch (moment.kind) {
    case "week_complete":
      return {
        title: "עמדת בכל מה שהתחייבת לו השבוע 🎉",
        body: "זה בדיוק מה שמפריד בין מי שמגיע ליעד לבין מי שרק קבע אותו. תעצור רגע ותרשום לעצמך שעשית את זה.",
        tone: "celebrate",
      };
    case "almost_there":
      return {
        title: `נשאר ${noun} והשבוע סגור`,
        body: "אתה כבר בקצה. הפעולה הזו היא ההפרש בין שבוע שכמעט היה לשבוע שהיה.",
        tone: "push",
      };
    case "midweek_behind":
      return {
        title: `${noun} עד סוף השבוע`,
        body: "עוד אמצע שבוע, ויש מספיק זמן. חלק את זה על היומיים הקרובים ואל תשאיר הכול לחמישי.",
        tone: "steady",
      };
    case "two_weak_weeks":
      return {
        title: "שבוע שני שלא נסגר — מה עצר אותך?",
        body: "שבוע אחד קורה לכולם. שניים אומרים שמשהו בדרך לא עובד, וזה מה שכדאי לנסח: מה המכשול, ומה אתה עושה כשהוא חוזר.",
        tone: "ask",
      };
    case "period_progress":
      return {
        title: "התקדמת מהתקופה הקודמת",
        body: "המספרים עלו. זו לא הרגשה — זו השוואה למה שבאמת עשית קודם.",
        tone: "celebrate",
      };
  }
}

/**
 * ‎**מה אומרים כשאין רגע מיוחד — ואין יעד.**
 *
 * ‏מסך ריק הוא הרגע הכי חשוב במוצר הזה: זו הפעם הראשונה שמתווך
 * פוגש את המנטור. הוא אינו מציג „אין נתונים”, אלא את הצעד הראשון.
 */
export function mentorOpeningLine(hasYearGoal: boolean, hasWeekGoal: boolean): MentorLine {
  if (!hasYearGoal) {
    return {
      title: "נתחיל מהסוף — כמה אתה רוצה להרוויח השנה?",
      body: "מספר אחד, ומכאן אני עושה את החשבון אחורה: כמה עסקאות זה, כמה הצעות, וכמה שיחות ביום. בלי לנחש.",
      tone: "ask",
    };
  }
  if (!hasWeekGoal) {
    return {
      title: "יש יעד. עכשיו נקבע מה קורה השבוע",
      body: "יעד שנתי לא זז לבד. בחר כמה שיחות ופגישות אתה לוקח על עצמך השבוע — ואת השאר אני סופר בשבילך.",
      tone: "push",
    };
  }
  return {
    title: "השבוע בעיצומו",
    body: "אני סופר את מה שאתה עושה — שיחות, פגישות, הצעות ונכסים. אין מה לדווח, רק לעבוד.",
    tone: "steady",
  };
}
