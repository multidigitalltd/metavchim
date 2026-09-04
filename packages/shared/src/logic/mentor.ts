import {
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  jerusalemWeekday,
  jerusalemWeekStart,
} from "./israel-time.js";

/**
 * המנטור האישי — ליבת הליווי (docs/13).
 *
 * ## מה זה, ומה זה לא
 *
 * המאמן החכם (`coach.ts`) עונה על „מה כדאי לעשות **עכשיו**”: ליד
 * שממתין, הצעה שנפתחה שלוש פעמים. המנטור עונה על שאלה אחרת —
 * „**איך הולך לי**, מול מה שהבטחתי לעצמי”. הוא זוכר את היעד
 * שהמתווך קבע, מודד אותו מול מה שקרה בפועל, ואומר את זה כמו שמנטור
 * אומר: חוגג עסקה במפורש, ומזכיר את היעד כשהשבוע היה חלש — בלי
 * להאשים.
 *
 * ## למה זה בחבילה המשותפת
 *
 * כמו `daily-brief.ts`: זה טקסט שמישהו **אומר** למתווך, והוא יוצא
 * בשלושה ערוצים — מסך המנטור, הפעמון, וואטסאפ. ניסוח בשלושה מקומות
 * הוא שלושה ניסוחים ביום שמתקנים אחד מהם. ה-API אוסף את המספרים,
 * הפונקציות כאן הופכות אותם למשפטים, והערוצים מציגים.
 *
 * ## על מה זה בנוי (docs/13 §2)
 *
 * לא ניסוח נעים אלא שיטת עבודה של מאמנים, כל כלל עם המקור שלו:
 *
 * - **יעדי תהליך לפני יעדי תוצאה.** „עסקה בחודש” אינה בשליטת
 *   המתווך; „6 סיורים בשבוע” כן. המנטור מתרגם תוצאה לתהליך לפי
 *   משפך ההמרה **של המתווך עצמו** (`suggestProcessGoals`) — מדדים
 *   מובילים ולא מדדים מאחרים (4DX, Locke & Latham).
 * - **היעד הוא של המתווך, עם „למה” משלו.** אוטונומיה היא תנאי
 *   למחויבות (Deci & Ryan). המנהל אינו קובע יעד דרך המנטור, והמנטור
 *   מצטט את ה„למה” כשקשה — לא נזיפה, עוגן.
 * - **כוונת יישום.** „כשאסיים את הבוקר — שולח הצעות” מכפילה את
 *   הסיכוי לביצוע מול יעד ערום (Gollwitzer). היעד נושא `intention`.
 * - **התקדמות קטנה נראית.** המניע החזק ביותר בעבודה הוא תחושת
 *   התקדמות (Amabile, progress principle) — ולכן גם שבוע בפיגור
 *   מקבל את מה שכן זז, ורצף שבועות נאמר בכותרת.
 * - **שאלה אחת, לא הרצאה.** בשבוע חלש המאמן שואל „מה עצר?” ומקשיב
 *   (GROW: Reality). שאלת רפלקציה אחת, ממוקדת ביעד שבפיגור.
 * - **מיקוד אחד לשבוע.** בקשה אחת לשבוע הבא, על היעד שבפיגור.
 *   שלוש בקשות הן אפס בקשות.
 *
 * ## כללי הטון (מחייבים — ראו docs/13 §4)
 *
 * 1. **עובדה, לא שיפוט.** „נשלחו 2 הצעות מתוך 5” ולא „שלחת מעט”.
 * 2. **השוואה רק לעצמו.** מול היעד שקבע ומול השבוע הקודם שלו —
 *    לעולם לא מול עמיתים. דוח הסוכנים קיים במקום אחר, למנהל.
 * 3. **כל הצלחה נאמרת בשמה.** עסקה שנסגרה אינה שורה בטבלה.
 * 4. **שבוע חלש מקבל תזכורת ליעד, לא נזיפה.** היעד הוא של המתווך;
 *    המנטור מזכיר מה הוא ביקש מעצמו.
 * 5. **שקט כשאין מה לומר.** אין יעדים ואין פעילות — אין הודעה.
 *    הודעה שמגיעה גם כשאין כלום מלמדת למחוק בלי לקרוא.
 *
 * ‎**פנייה ברבים** („אתם”) כמו בשאר ניסוחי המערכת — ניסוח אחד לכל
 * מתווך ומתווכת, בלי לנחש.
 */

/* ------------------------------------------------------------------ */
/* יעדים                                                               */
/* ------------------------------------------------------------------ */

/**
 * המדדים שאפשר לקבוע עליהם יעד. רשימה סגורה: כל מדד כאן הוא מספר
 * שה-API יודע לספור מהנתונים הקיימים (docs/13 §5), ולכן יעד עליו
 * הוא הבטחה שאפשר לקיים.
 */
export const MENTOR_GOAL_METRICS = [
  "deals_closed",
  "offers_sent",
  "viewings_held",
  "leads_answered",
  "new_buyers",
  "new_properties",
] as const;
export type MentorGoalMetric = (typeof MENTOR_GOAL_METRICS)[number];

export const MENTOR_GOAL_PERIODS = ["week", "month"] as const;
export type MentorGoalPeriod = (typeof MENTOR_GOAL_PERIODS)[number];

/**
 * הגבול העליון ליעד — בלם לטעות הקלדה, לא מגבלת מוצר: „500 עסקאות
 * בשבוע” אינו יעד שמישהו התכוון אליו. קבוע אחד לסכמה ולהצעות
 * המנטור, כדי שהצעה שהמנטור מציע תמיד תהיה יעד שאפשר לשמור.
 */
export const MENTOR_GOAL_TARGET_MAX = 200;

/**
 * ‎**תוצאה** — מה שהמתווך רוצה ואינו שולט בו במלואו (עסקה). ‎**תהליך** —
 * מה שבידיו לעשות (סיור, הצעה, מענה לליד). המנטור מציע יעדי תהליך
 * לכל יעד תוצאה, כי יעד שאינו בשליטה מייאש ולא מניע.
 */
export type MentorMetricKind = "outcome" | "process";

export interface MentorMetricInfo {
  code: MentorGoalMetric;
  kind: MentorMetricKind;
  /** שם המדד — לבחירה במסך היעדים */
  label: string;
  /** יחידה אחת — „עסקה אחת” */
  one: string;
  /** צורת רבים — „עסקאות”; ננקבת עם מספר לפניה */
  many: string;
}

export const MENTOR_METRICS: readonly MentorMetricInfo[] = [
  {
    code: "deals_closed",
    kind: "outcome",
    label: "עסקאות שנסגרו",
    one: "עסקה אחת",
    many: "עסקאות",
  },
  {
    code: "offers_sent",
    kind: "process",
    label: "הצעות שנשלחו",
    one: "הצעה אחת",
    many: "הצעות",
  },
  {
    code: "viewings_held",
    kind: "process",
    label: "סיורים שהתקיימו",
    one: "סיור אחד",
    many: "סיורים",
  },
  {
    code: "leads_answered",
    kind: "process",
    label: "לידים שנענו",
    one: "ליד אחד",
    many: "לידים",
  },
  {
    code: "new_buyers",
    kind: "process",
    label: "קונים חדשים",
    one: "קונה אחד",
    many: "קונים",
  },
  {
    code: "new_properties",
    kind: "process",
    label: "נכסים חדשים",
    one: "נכס אחד",
    many: "נכסים",
  },
];

const METRIC_BY_CODE = new Map(MENTOR_METRICS.map((m) => [m.code, m]));

export function isMentorGoalMetric(value: string): value is MentorGoalMetric {
  return METRIC_BY_CODE.has(value as MentorGoalMetric);
}

/** „עסקה אחת” / „3 עסקאות” — כמות עם היחידה בעברית טבעית. */
export function mentorQuantity(metric: MentorGoalMetric, n: number): string {
  const info = METRIC_BY_CODE.get(metric);
  if (info === undefined) return String(n);
  if (n === 1) return info.one;
  return `${n} ${info.many}`;
}

const PERIOD_LABEL: Record<MentorGoalPeriod, string> = {
  week: "בשבוע",
  month: "בחודש",
};

/** „5 הצעות בשבוע” — היעד כפי שהמתווך יראה אותו ברשימה. */
export function mentorGoalLabel(
  metric: MentorGoalMetric,
  target: number,
  period: MentorGoalPeriod,
): string {
  return `${mentorQuantity(metric, target)} ${PERIOD_LABEL[period]}`;
}

/**
 * גבולות התקופה הנוכחית בשעון ישראל, כערכי UTC לשאילתות.
 *
 * שבוע = ראשון 00:00 עד ראשון הבא — אותה פונקציה שהיומן והמאמן
 * משתמשים בה, כדי ש„השבוע” יהיה אותו שבוע בכל מסך. חודש = הראשון
 * בחודש 00:00 שעון ישראל; החשבון על תווית התאריך ולא על מילישניות,
 * מאותה סיבה שב-`jerusalemWeekStart` — יום מעבר שעון אינו 24 שעות.
 */
export function mentorPeriodRange(
  period: MentorGoalPeriod,
  now: Date,
): { start: Date; end: Date } {
  if (period === "week") {
    return { start: jerusalemWeekStart(now), end: jerusalemWeekStart(now, 1) };
  }
  const [year, month] = jerusalemWallParts(now).date.split("-").map(Number) as [
    number,
    number,
  ];
  const startIso = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endIso = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000`;
  return {
    start: jerusalemWallIsoToUtc(startIso),
    end: jerusalemWallIsoToUtc(endIso),
  };
}

/** איפה עומדים מול הקצב — לא רק מול היעד הסופי. */
export type MentorPace = "done" | "ahead" | "on_track" | "behind";

export interface MentorGoalProgressInput {
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
  actual: number;
  /** ה„למה” של המתווך — מצוטט כשקשה. חסר = היעד בלי עוגן */
  why?: string;
  /** כוונת היישום — „כש… אז…”. מוזכרת בבקשה לשבוע הבא */
  intention?: string;
  /** גבולות התקופה (מ-`mentorPeriodRange`) */
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}

export interface MentorGoalProgress {
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
  actual: number;
  why?: string;
  intention?: string;
  /** כמה מהיעד הושג — 0 עד 1, ויכול לעבור את 1 */
  ratio: number;
  /** כמה מהתקופה חלף — 0 עד 1 */
  elapsed: number;
  /** כמה היה צפוי עד עכשיו לו הקצב היה אחיד */
  expected: number;
  pace: MentorPace;
  /** מה עוד נשאר — 0 כשהיעד הושג */
  remaining: number;
}

/**
 * מצב היעד — **מול הקצב**, ולא רק מול המספר הסופי.
 *
 * ‎„2 מתוך 5” ביום שני הוא מצוין, ובחמישי הוא פיגור. מדידה מול היעד
 * הסופי הייתה מציגה „פיגור” בכל בוקר ראשון של כל שבוע, וזה בדיוק
 * ההודעה שמלמדת להתעלם מהמנטור.
 *
 * ‎**הסובלנות אינה סימטרית.** פיגור נספר רק מעבר ליחידה שלמה ועוד
 * 15% מהיעד: 0 מתוך 5 ביום שני אינו פיגור, ו-0 מתוך 3 בחודש ביום
 * העשירי אינו פיגור — עסקה אינה מתחלקת, ו„היה צריך להיות ב-1.0”
 * אינו דבר שאפשר לעשות. הקדמה נספרת מ-15% בלבד, כי אי אפשר להקדים
 * במקרה — מי ששלח 2 מתוך 5 עד יום שני באמת מקדים.
 *
 * וכשהתקופה נגמרה יש רק שתי תשובות: הושג, או לא. „בקצב” בסוף
 * השבוע עם 4 מתוך 5 הוא משפט שאין לו משמעות.
 */
export function mentorGoalProgress(
  input: MentorGoalProgressInput,
): MentorGoalProgress {
  const { metric, period, now, periodStart, periodEnd } = input;
  const target = Math.max(1, Math.floor(input.target));
  const actual = Math.max(0, Math.floor(input.actual));
  const span = periodEnd.getTime() - periodStart.getTime();
  const elapsed =
    span <= 0
      ? 1
      : Math.min(
          1,
          Math.max(0, (now.getTime() - periodStart.getTime()) / span),
        );
  const expected = target * elapsed;
  const slack = target * 0.15;

  let pace: MentorPace;
  if (actual >= target) pace = "done";
  else if (elapsed >= 1) pace = "behind";
  else if (actual >= 1 && actual - expected >= slack) pace = "ahead";
  else if (expected - actual >= 1 + slack) pace = "behind";
  else pace = "on_track";

  return {
    metric,
    period,
    target,
    actual,
    ...(input.why === undefined ? {} : { why: input.why }),
    ...(input.intention === undefined ? {} : { intention: input.intention }),
    ratio: actual / target,
    elapsed,
    expected,
    pace,
    remaining: Math.max(0, target - actual),
  };
}

/* ------------------------------------------------------------------ */
/* מתוצאה לתהליך — משפך ההמרה של המתווך עצמו                          */
/* ------------------------------------------------------------------ */

/**
 * המשפך, מהתחלה לסוף: ליד שנענה ⟵ קונה ⟵ הצעה ⟵ סיור ⟵ עסקה.
 * כל שלב נספר לפי אותו מדד שאפשר לקבוע עליו יעד, ולכן ההצעה של
 * המנטור היא יעד שאפשר ללחוץ עליו „קבע”.
 */
export const MENTOR_FUNNEL: readonly MentorGoalMetric[] = [
  "leads_answered",
  "new_buyers",
  "offers_sent",
  "viewings_held",
  "deals_closed",
];

/**
 * יחסי המרה כשאין עדיין היסטוריה — **ברירת מחדל שנאמרת בשמה**,
 * לא ניחוש בשקט: כל 5 סיורים עסקה, כל 3 הצעות סיור, כל 2 קונים
 * הצעה, וכל 2 לידים שנענו קונה. שמרני בכוונה: מוטב יעד שמושג
 * ומועלה, מיעד שמפספסים בשבוע הראשון.
 */
export const DEFAULT_FUNNEL_RATIOS: Readonly<Record<MentorGoalMetric, number>> =
  {
    leads_answered: 2,
    new_buyers: 2,
    offers_sent: 3,
    viewings_held: 5,
    deals_closed: 1,
    new_properties: 1,
  };

/** כמה מהיסטוריה נחשב „מספיק כדי לסמוך עליה” — פחות מזה, ברירת המחדל. */
const MIN_HISTORY_DEALS = 2;

export interface ProcessGoalSuggestion {
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
  /** „כל 5 סיורים ⟵ עסקה, לפי 90 הימים האחרונים שלכם” */
  reason: string;
}

export interface SuggestProcessGoalsInput {
  /** יעד התוצאה שהמתווך רוצה */
  outcome: { target: number; period: MentorGoalPeriod };
  /** הפעילות המצטברת בחלון ההיסטוריה (ה-API סופר, בדרך כלל 90 יום) */
  history: MentorActivity;
  /** כמה שבועות מכסה ההיסטוריה */
  historyWeeks: number;
}

/**
 * מיעד תוצאה ליעדי תהליך שבועיים — **לפי היחסים של המתווך עצמו.**
 *
 * „עסקה בחודש” נעשה „6 סיורים בשבוע, 15 הצעות, 8 קונים חדשים” —
 * ומה שבשליטה נמדד כל שבוע. היחס נלקח מההיסטוריה של המתווך כשיש
 * בה מספיק עסקאות; אחרת מברירת המחדל, וההסבר אומר איזה משניהם.
 *
 * ‎**עיגול כלפי מעלה בכל שלב, ואף פעם לא אפס.** יעד תהליך של 0 הוא
 * הודעה שאין מה לעשות, וזה ההפך ממה שביקשו. מוצע רק מה שלפני
 * העסקה במשפך; „נכסים חדשים” הוא צד ההיצע ואינו נגזר מעסקה.
 */
export function suggestProcessGoals(
  input: SuggestProcessGoalsInput,
): ProcessGoalSuggestion[] {
  const outcomeTarget = Math.max(1, Math.floor(input.outcome.target));
  const weeksInPeriod = input.outcome.period === "week" ? 1 : 52 / 12;
  const dealsPerWeek = outcomeTarget / weeksInPeriod;

  const { history, historyWeeks } = input;
  const enoughHistory =
    historyWeeks > 0 && history.deals_closed >= MIN_HISTORY_DEALS;

  const suggestions: ProcessGoalSuggestion[] = [];
  /*
   * מהעסקה אחורה: כל שלב צריך פי-יחס ממה **שהוצע** לשלב שאחריו —
   * המספר המעוגל, לא השבר. אחרת „2 סיורים” מקבל „4 הצעות” כשהיחס
   * אומר 3 לסיור, והיעדים סותרים זה את זה (ביקורת Codex).
   */
  let needed = dealsPerWeek;
  for (let i = MENTOR_FUNNEL.length - 2; i >= 0; i--) {
    const metric = MENTOR_FUNNEL[i]!;
    const next = MENTOR_FUNNEL[i + 1]!;
    let ratio = DEFAULT_FUNNEL_RATIOS[metric];
    let source = "לפי ממוצע מקובל, עד שתהיה היסטוריה משלכם";
    if (enoughHistory && history[metric] > 0 && history[next] > 0) {
      ratio = Math.max(1, history[metric] / history[next]);
      source = `לפי ${historyWeeks} השבועות האחרונים שלכם`;
    }
    // לא מעל מה שהסכמה מקבלת — הצעה שאי אפשר ללחוץ עליה „קבע” אינה הצעה
    const target = Math.min(
      MENTOR_GOAL_TARGET_MAX,
      Math.max(1, Math.ceil(needed * ratio - 1e-9)),
    );
    needed = target;
    const shown = Math.round(ratio * 10) / 10;
    suggestions.unshift({
      metric,
      period: "week",
      target,
      reason: `כל ${shown} ${METRIC_BY_CODE.get(metric)?.many ?? metric} ⟵ ${METRIC_BY_CODE.get(next)?.one ?? next} — ${source}`,
    });
  }
  return suggestions;
}

/* ------------------------------------------------------------------ */
/* הסיכום השבועי                                                       */
/* ------------------------------------------------------------------ */

/** הצלחה שנאמרת בשמה — לא מונה, אלא אירוע. */
export type MentorWinKind =
  "deal_closed" | "exclusivity_signed" | "offer_interested" | "coop_deal";

export interface MentorWin {
  kind: MentorWinKind;
  /** מה בדיוק — כותרת הנכס, בלי PII של הלקוח */
  title: string;
}

/** פעילות השבוע — המונים שה-API סופר, לפי אותם מדדים של היעדים. */
export type MentorActivity = Record<MentorGoalMetric, number>;

export interface MentorWeekSignals {
  /** תחילת השבוע שמסכמים */
  weekStart: Date;
  wins: MentorWin[];
  activity: MentorActivity;
  /** השבוע שלפניו — להשוואה למתווך עם עצמו. חסר = אין השוואה */
  previousActivity?: MentorActivity;
  /** היעדים הפעילים, כבר מחושבים לסוף השבוע */
  goals: MentorGoalProgress[];
  /** כמה שבועות רצופים כל היעדים הושגו (כולל זה) */
  streakWeeks?: number;
  /**
   * מה שהמתווך התחייב אליו בסיכום הקודם, ואם עמד בזה — נבדק מול
   * היעדים של השבוע הזה. חסר = לא הייתה מחויבות (או שלא ענה).
   */
  previousCommitment?: {
    metric: MentorGoalMetric;
    period: MentorGoalPeriod;
    target: number;
    kept: boolean;
  };
}

/** היעד שהבקשה לשבוע הבא מדברת עליו — מה שאפשר להתחייב אליו. */
export interface MentorAsk {
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
}

/**
 * הטון של הסיכום — נגזר מהשבוע, ומכתיב כותרת ואייקון בערוץ.
 *
 * ‎`celebrate` — הייתה הצלחה או שכל היעדים הושגו.
 * ‎`steady` — יש התקדמות, אין דרמה.
 * ‎`encourage` — יש יעדים ולא הגיעו אליהם, או שבוע ריק עם יעדים.
 */
export type MentorMood = "celebrate" | "steady" | "encourage";

export interface MentorReview {
  mood: MentorMood;
  headline: string;
  /** פסקאות הגוף, בסדר: הצלחות ⟵ יעדים ⟵ תנועה מול שבוע שעבר */
  paragraphs: string[];
  /** מה המנטור מבקש לשבוע הבא — `null` כשאין יעדים */
  askNextWeek: string | null;
  /** היעד שהבקשה מדברת עליו — כדי שאפשר יהיה להתחייב, ולבדוק בשבוע הבא */
  ask: MentorAsk | null;
  /**
   * שאלת רפלקציה אחת, על היעד שבפיגור — `null` כשאין פיגור.
   * המאמן שואל ומקשיב; התשובה נשמרת ליד היעד (docs/13 §2).
   */
  reflection: string | null;
}

const WIN_PHRASE: Record<MentorWinKind, (title: string) => string> = {
  deal_closed: (t) => `סגרתם את ${t}`,
  exclusivity_signed: (t) => `חתמתם בלעדיות על ${t}`,
  offer_interested: (t) => `קונה אמר „מעוניין” על ${t}`,
  coop_deal: (t) => `עסקת שיתוף פעולה על ${t}`,
};

/** „סגרתם את X, וחתמתם בלעדיות על Y” — כל הצלחה בשמה. */
function winsSentence(wins: MentorWin[]): string {
  const phrases = wins.map((w) => WIN_PHRASE[w.kind](w.title));
  if (phrases.length === 1)
    return `${phrases[0]}. כל הכבוד — זה מה שהשבוע היה בשבילו.`;
  const last = phrases[phrases.length - 1];
  return `${phrases.slice(0, -1).join(", ")}, ו${last}. שבוע כזה לא קורה במקרה.`;
}

function goalSentence(goal: MentorGoalProgress): string {
  const label = mentorGoalLabel(goal.metric, goal.target, goal.period);
  const achieved = mentorQuantity(goal.metric, goal.actual);
  switch (goal.pace) {
    case "done":
      return `היעד של ${label} — הושג: ${achieved}.`;
    case "ahead":
      return `${label}: כבר ${achieved}, מעל הקצב.`;
    case "on_track":
      return `${label}: ${achieved} עד עכשיו, בקצב.`;
    case "behind": {
      // „עוד יש זמן” רק כשבאמת יש — הסיכום השבועי נאמר אחרי שהשבוע נגמר (ביקורת Codex)
      const periodOver = goal.elapsed >= 1;
      const base =
        goal.actual === 0
          ? periodOver
            ? `${label}: לא יצא הפעם. זה היעד שביקשתם מעצמכם, והוא מתחיל מחדש.`
            : `${label}: עדיין לא התחיל. זה היעד שביקשתם מעצמכם, ועוד יש זמן.`
          : periodOver
            ? `${label}: ${achieved}. חסרו ${mentorQuantity(goal.metric, goal.remaining)} ליעד שקבעתם.`
            : `${label}: ${achieved} עד עכשיו. עוד ${mentorQuantity(goal.metric, goal.remaining)} ליעד שקבעתם.`;
      // ה„למה” של המתווך — עוגן, לא נזיפה. רק כשקשה, ורק אם כתב אחד.
      return goal.why === undefined || goal.why.trim() === ""
        ? base
        : `${base} כתבתם שזה בשביל: ${goal.why.trim()}.`;
    }
  }
}

/**
 * שאלה אחת על מה שעצר — לפי סוג המדד, כי „מה עצר?” סתמי מקבל
 * „לא יודע”. השאלה מציעה שתי תשובות אפשריות ומשאירה מקום לשלישית.
 */
const REFLECTION: Record<MentorGoalMetric, string> = {
  deals_closed: "מה הכי קרוב לסגירה עכשיו, ומה חסר לו כדי להיסגר?",
  offers_sent:
    "מה עצר את ההצעות השבוע — לא היו התאמות טובות, או לא היה זמן לשלוח?",
  viewings_held: "מה עצר את הסיורים — קונים שלא הגיעו, או לא נקבעו מספיק?",
  leads_answered:
    "מה עצר את המענה ללידים — הגיעו בשעות לא נוחות, או שהיו יותר מדי בבת אחת?",
  new_buyers: "מאיפה הגיעו הקונים שכן נכנסו החודש — ומה אפשר להגביר שם?",
  new_properties:
    "מה עצר קליטת נכסים — לא היו פניות מוכרים, או שלא היה זמן לצאת אליהם?",
};

/**
 * תנועה מול השבוע הקודם — **רק מה שהשתנה**, ורק מול עצמו.
 *
 * מדד שלא זז לא נאמר: „הצעות: 3 (שבוע שעבר 3)” הוא רעש. ומי שאין
 * לו שבוע קודם (מתווך חדש) אינו מקבל השוואה כלל — אין מול מה.
 */
function trendSentence(
  activity: MentorActivity,
  previous: MentorActivity | undefined,
): string | null {
  if (previous === undefined) return null;
  const ups: string[] = [];
  const downs: string[] = [];
  for (const info of MENTOR_METRICS) {
    const now = activity[info.code];
    const before = previous[info.code];
    if (now === before || (now === 0 && before === 0)) continue;
    const text = `${info.label} ${before} ⟵ ${now}`;
    (now > before ? ups : downs).push(text);
  }
  if (ups.length === 0 && downs.length === 0) return null;
  const parts: string[] = [];
  if (ups.length > 0) parts.push(`עלייה מול שבוע שעבר: ${ups.join(" · ")}.`);
  if (downs.length > 0) parts.push(`פחות משבוע שעבר: ${downs.join(" · ")}.`);
  return parts.join(" ");
}

function isEmptyActivity(activity: MentorActivity): boolean {
  return MENTOR_METRICS.every((m) => activity[m.code] === 0);
}

/**
 * הסיכום השבועי — מה שהמנטור אומר במוצאי שבת.
 *
 * ‎`null` = אין מה לומר: אין יעדים, אין הצלחות, ואין פעילות. עם
 * יעדים תמיד יש מה לומר, גם על שבוע ריק — זה בדיוק השבוע שבו מנטור
 * מדבר.
 */
export function mentorWeeklyReview(
  signals: MentorWeekSignals,
): MentorReview | null {
  const { wins, goals, activity, previousActivity } = signals;
  const noActivity = isEmptyActivity(activity);
  if (wins.length === 0 && goals.length === 0 && noActivity) return null;

  const allGoalsMet = goals.length > 0 && goals.every((g) => g.pace === "done");
  const anyBehind = goals.some((g) => g.pace === "behind");
  const commitment = signals.previousCommitment;

  let mood: MentorMood;
  if (wins.length > 0 || allGoalsMet || commitment?.kept === true)
    mood = "celebrate";
  else if (anyBehind || (goals.length > 0 && noActivity)) mood = "encourage";
  else mood = "steady";

  const paragraphs: string[] = [];
  /*
   * המחויבות מהשבוע שעבר נאמרת **ראשונה** — לפני ההצלחות ולפני
   * היעדים: זה מה שהמתווך אמר שיעשה, וזה הדבר הראשון שמנטור בודק.
   * עמידה — בשמה; אי-עמידה — עובדה, ובלי לקחת את ההתחייבות בחזרה
   * (ייחוס לתהליך, לא ליכולת).
   */
  if (commitment !== undefined) {
    const label = mentorGoalLabel(
      commitment.metric,
      commitment.target,
      commitment.period,
    );
    paragraphs.push(
      commitment.kept
        ? `התחייבתם ל${label} — ועמדתם בזה.`
        : `התחייבתם ל${label}. הפעם לא יצא, וההתחייבות עדיין שלכם.`,
    );
  }
  if (wins.length > 0) paragraphs.push(winsSentence(wins));
  if (goals.length > 0) paragraphs.push(goals.map(goalSentence).join(" "));
  const trend = trendSentence(activity, previousActivity);
  if (trend !== null) paragraphs.push(trend);

  const streak = signals.streakWeeks ?? 0;
  let headline: string;
  if (mood === "celebrate") {
    headline =
      allGoalsMet && streak >= 2
        ? `${streak} שבועות רצופים שכל היעדים מושגים`
        : allGoalsMet
          ? "כל היעדים של השבוע הושגו"
          : wins.length === 0 && commitment?.kept === true
            ? "עמדתם במה שהתחייבתם"
            : "שבוע עם תוצאה";
  } else if (mood === "encourage") {
    headline = noActivity
      ? "שבוע שקט. השבוע הבא מתחיל מחדש"
      : "לא הגעתם ליעד השבוע — והוא עדיין שלכם";
  } else {
    headline = "שבוע של עבודה, בקצב";
  }

  let askNextWeek: string | null = null;
  let ask: MentorAsk | null = null;
  let reflection: string | null = null;
  if (goals.length > 0) {
    const behind = goals.find((g) => g.pace === "behind");
    /*
     * הבקשה היא **לשבוע הבא**, ולכן על יעד שבועי בלבד. יעד חודשי הוא
     * מצטבר: מי שכבר השיג אותו ב-1 בחודש „עומד” בו בכל שבוע בלי
     * לעשות דבר, ומי שמאחור בו אינו יכול לסגור אותו בשבוע. כשיש רק
     * יעדים חודשיים — הבקשה היא להוסיף יעד תהליך שבועי לצידם.
     */
    const weekly = goals.filter((g) => g.period === "week");
    const focus =
      weekly.find((g) => g.pace === "behind") ?? weekly[0] ?? undefined;
    if (focus === undefined) {
      askNextWeek =
        "יש יעד חודשי בלי יעד תהליך שבועי לצידו. לשבוע הבא: להוסיף אחד — זה מה שמזיז את החודש.";
    }
    if (focus !== undefined) {
      ask = {
        metric: focus.metric,
        period: focus.period,
        target: focus.target,
      };
      if (allGoalsMet) {
        askNextWeek = "אותם יעדים לשבוע הבא? אפשר גם להעלות אחד מהם.";
      } else {
        const label = mentorGoalLabel(focus.metric, focus.target, focus.period);
        // כוונת היישום של המתווך עצמו — התוכנית שכבר כתב, לא תוכנית חדשה
        const intention =
          focus.intention === undefined || focus.intention.trim() === ""
            ? ""
            : ` התוכנית שכתבתם: „${focus.intention.trim()}”.`;
        askNextWeek = `לשבוע הבא: ${label}. זה מה שביקשתם מעצמכם, ואני מזכיר.${intention}`;
      }
    }
    if (behind !== undefined) reflection = REFLECTION[behind.metric];
  }

  return { mood, headline, paragraphs, askNextWeek, ask, reflection };
}

/**
 * הסדר שבו הצלחות נאמרות, וכמה מהן: עסקה קודם לבלעדיות, ושתיהן
 * לפני „מעוניין”. שש לכל היותר — משפט עם עשר הצלחות אינו חגיגה
 * אלא רשימה, ומי שסגר עשר יודע.
 */
const WIN_ORDER: Record<MentorWinKind, number> = {
  deal_closed: 0,
  coop_deal: 1,
  exclusivity_signed: 2,
  offer_interested: 3,
};
const MAX_WINS_TOLD = 6;

export function selectWins(wins: readonly MentorWin[]): MentorWin[] {
  return [...wins]
    .sort((a, b) => WIN_ORDER[a.kind] - WIN_ORDER[b.kind])
    .slice(0, MAX_WINS_TOLD);
}

/**
 * החגיגה המיידית — ההתראה שיוצאת **באותו יום**, לא במוצאי שבת.
 * חיזוק קרוב לאירוע חזק מחיזוק בסוף השבוע (docs/13 §2).
 */
export function mentorCelebration(win: MentorWin): {
  title: string;
  body: string;
} {
  switch (win.kind) {
    case "deal_closed":
      return {
        title: "🎉 סגרתם עסקה",
        body: `${win.title} — נסגר. כל הכבוד. זה מה שכל השבוע היה בשבילו, והמנטור רושם.`,
      };
    case "exclusivity_signed":
      return {
        title: "🎉 בלעדיות נחתמה",
        body: `${win.title} — הבלעדיות חתומה. נכס שסומכים עליכם בו הוא הבסיס לעסקה הבאה.`,
      };
    case "coop_deal":
      return {
        title: "🎉 עסקת שיתוף פעולה נסגרה",
        body: `${win.title} — נסגר יחד עם משרד אחר. עסקה שלא הייתה קורית לבד.`,
      };
    case "offer_interested":
      return {
        title: "👍 קונה אמר „מעוניין”",
        body: `${win.title} — הקונה הגיב שהוא מעוניין. זה הרגע לקבוע סיור.`,
      };
  }
}

/**
 * מה שנשמר עם הסיכום — הכול נאמר, וגם מה שצריך כדי להציג אותו
 * במסך ולחשב את הרצף בשבוע הבא, בלי לחשב מחדש נתונים שכבר השתנו.
 */
export interface MentorReviewBody {
  paragraphs: string[];
  askNextWeek: string | null;
  ask: MentorAsk | null;
  reflection: string | null;
  allGoalsMet: boolean;
  wins: MentorWin[];
  activity: MentorActivity;
  goals: {
    metric: MentorGoalMetric;
    period: MentorGoalPeriod;
    target: number;
    actual: number;
    pace: MentorPace;
  }[];
}

export function mentorReviewBody(
  signals: MentorWeekSignals,
  review: MentorReview,
): MentorReviewBody {
  return {
    paragraphs: review.paragraphs,
    askNextWeek: review.askNextWeek,
    ask: review.ask,
    reflection: review.reflection,
    allGoalsMet:
      signals.goals.length > 0 && signals.goals.every((g) => g.pace === "done"),
    wins: signals.wins,
    activity: signals.activity,
    goals: signals.goals.map((g) => ({
      metric: g.metric,
      period: g.period,
      target: g.target,
      actual: g.actual,
      pace: g.pace,
    })),
  };
}

/**
 * דחיפת אמצע השבוע — מה שמנטור אומר ביום רביעי, לא במוצאי שבת.
 *
 * מנטור אמיתי אינו מחכה לסוף השבוע כדי לומר שהקצב נפל; הוא מתערב
 * כשעוד אפשר לשנות משהו. הכלל כאן צר בכוונה: רק יעד **שבועי**
 * שכבר **מאחור** מקבל דחיפה, ורק אחד — זה שהכי רחוק מהקצב. יעד
 * חודשי מקבל את זה בסיכום השבועי; „בקצב” ו„מעל הקצב” לא מקבלים
 * כלום, כי דחיפה שמגיעה גם כשהכול בסדר היא רעש.
 *
 * הניסוח: עובדה (כמה יש, כמה חסר), התוכנית שהמתווך כתב, וה„למה”
 * שלו — עוגן, לא נזיפה. ‎`null` = אין מה לומר.
 */
export function mentorMidweekNudge(
  goals: readonly MentorGoalProgress[],
  now: Date,
): { title: string; body: string; metric: MentorGoalMetric } | null {
  const behind = goals.filter(
    (g) => g.period === "week" && g.pace === "behind",
  );
  if (behind.length === 0) return null;
  // הכי רחוק מהקצב — הפער היחסי בין הצפוי למה שיש
  const focus = [...behind].sort(
    (a, b) =>
      (b.expected - b.actual) / b.target - (a.expected - a.actual) / a.target,
  )[0]!;
  const label = mentorGoalLabel(focus.metric, focus.target, focus.period);
  const left = workdaysLeftLabel(now);
  const parts = [
    focus.actual === 0
      ? `${label}: עדיין לא התחיל, ${left}.`
      : `${label}: ${mentorQuantity(focus.metric, focus.actual)} עד עכשיו, עוד ${mentorQuantity(focus.metric, focus.remaining)} ליעד — ${left}.`,
  ];
  if (focus.intention !== undefined && focus.intention.trim() !== "") {
    parts.push(`התוכנית שכתבתם: „${focus.intention.trim()}”.`);
  }
  if (focus.why !== undefined && focus.why.trim() !== "") {
    parts.push(`בשביל: ${focus.why.trim()}.`);
  }
  return {
    title: `🧭 אמצע השבוע — ${label}`,
    body: parts.join(" "),
    metric: focus.metric,
  };
}

/**
 * כמה ימי עבודה נשארו בשבוע הישראלי, לפי רגע השליחה — לא „שלושה”
 * קבוע: הדחיפה יכולה לצאת גם בחמישי (אחרי השבתה, או למי שנפל מהקצב
 * רק אז), ותאריך יעד שגוי גרוע מאין תאריך. ראשון עד חמישי הם ימי
 * עבודה; שישי נספר כחצי; היום עצמו נספר כשעדיין לפני הצהריים.
 */
function workdaysLeftLabel(now: Date): string {
  const weekday = jerusalemWeekday(now);
  const beforeNoon = Number(jerusalemWallParts(now).time.slice(0, 2)) < 12;
  // ימי עבודה מלאים אחרי היום: ראשון(0)…חמישי(4)
  const fullDaysAfterToday = Math.max(0, 4 - weekday);
  const days = fullDaysAfterToday + (weekday <= 4 && beforeNoon ? 1 : 0);
  if (weekday === 5 || (weekday === 4 && !beforeNoon))
    return "והשבוע כמעט נגמר";
  if (days >= 3) return `ונשארו ${days} ימי עבודה`;
  if (days === 2) return "ונשארו יומיים";
  return "ונשאר יום עבודה אחד";
}

/** כותרת ההתראה בפעמון ובוואטסאפ — לפי הטון, אייקון אחד לכל טון. */
export function mentorReviewTitle(review: MentorReview): string {
  const icon =
    review.mood === "celebrate"
      ? "🎉"
      : review.mood === "encourage"
        ? "💪"
        : "📈";
  return `${icon} ${review.headline}`;
}
