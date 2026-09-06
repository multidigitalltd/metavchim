import {
  MENTOR_METRICS,
  mentorGoalLabel,
  mentorQuantity,
  mentorTrendSentence,
  type MentorActivity,
  type MentorGoalMetric,
  type MentorGoalPeriod,
  type MentorPace,
  type MentorWin,
} from "./mentor.js";
import type { MentorIdeaOutcome } from "./mentor-outcome.js";
import {
  DEFAULT_MENTOR_PERSONA,
  mentorSalutation,
  type MentorPersona,
} from "./mentor-persona.js";
import {
  playbookIdeaPick,
  type MentorIdeaFeedback,
  type MentorIdeaMark,
  type OfficeProvenLookup,
} from "./mentor-playbook.js";

/**
 * הסיכום החודשי — מה עבד ומה לא (docs/14 §3).
 *
 * השבועי אומר „מה קרה השבוע”; החודשי אומר **מה עובד אצלך**: המספרים
 * של החודש מול החודש שלפניו, כמה שבועות היעד הושג, אילו רעיונות
 * סימנת ומי מהם באמת הזיז מספר, ומיקוד אחד לחודש הבא. הוא נבנה
 * מהסיכומים השבועיים שכבר נאמרו (`mentor_reviews.body`) — לא מחשב
 * מחדש שבועות שכבר נסגרו — ומהמונים של החודש (§5.1).
 *
 * הקול כמו בשבועי (§4): גוף שני, עובדות, ייחוס לתהליך.
 */

export interface MentorMonthWeek {
  weekStart: Date;
  goals: {
    metric: MentorGoalMetric;
    period: MentorGoalPeriod;
    target: number;
    actual: number;
    pace: MentorPace;
  }[];
}

export interface MentorMonthSignals {
  /** ה-1 בחודש 00:00 שעון ישראל, כ-UTC */
  monthStart: Date;
  activity: MentorActivity;
  /** החודש שלפניו — חסר = אין השוואה */
  previousActivity?: MentorActivity;
  wins: MentorWin[];
  /** הסיכומים השבועיים של החודש, מהישן לחדש */
  weeks: MentorMonthWeek[];
  /** הסימונים של החודש — „עזר לי” / „לא בשבילי” */
  marks: MentorIdeaMark[];
  /**
   * מה נמדד על „עזר לי” של החודש (§7.2) — לפי **יום הסימון**, לא לפי
   * השבוע שהמדידה נרשמה בו: סימון מסוף החודש נמדד בשבוע של החודש
   * הבא, ועדיין שייך לכאן (ביקורת Codex). מה שטרם נמדד נספר ונאמר.
   */
  ideaOutcomes: MentorIdeaOutcome[];
  feedback?: MentorIdeaFeedback;
  /** מה הוכיח את עצמו במשרד — הטיפ למיקוד מעדיף אותו (§7.4) */
  office?: OfficeProvenLookup;
  firstName?: string;
  persona?: MentorPersona;
}

export interface MentorMonthlyReview {
  headline: string;
  greeting: string | null;
  paragraphs: string[];
  /** המדד למיקוד בחודש הבא — `null` כשאין פיגור לדבר עליו */
  focus: MentorGoalMetric | null;
}

/** מה שנשמר על הסיכום החודשי — כפי שנאמר, ועם המספרים שמאחוריו. */
export interface MentorMonthlyBody {
  greeting: string | null;
  paragraphs: string[];
  focus: MentorGoalMetric | null;
  activity: MentorActivity;
  previousActivity?: MentorActivity;
  ideaOutcomes: MentorIdeaOutcome[];
}

const HEBREW_MONTH = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  month: "long",
});

/** „ספטמבר” — שם החודש של ה-1 בחודש הישראלי שהתאריך נופל בו. */
export function mentorMonthLabel(monthStart: Date): string {
  return HEBREW_MONTH.format(monthStart);
}

interface GoalTally {
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
  weeks: number;
  done: number;
  behind: number;
}

/** כל יעד שהופיע בסיכומים — כמה שבועות, כמה הושג, כמה היה מאחור. */
function tallyGoals(weeks: readonly MentorMonthWeek[]): GoalTally[] {
  const tallies = new Map<string, GoalTally>();
  for (const week of weeks) {
    for (const goal of week.goals) {
      const key = `${goal.period}:${goal.metric}:${goal.target}`;
      const tally = tallies.get(key) ?? {
        metric: goal.metric,
        period: goal.period,
        target: goal.target,
        weeks: 0,
        done: 0,
        behind: 0,
      };
      tally.weeks += 1;
      if (goal.pace === "done") tally.done += 1;
      if (goal.pace === "behind") tally.behind += 1;
      tallies.set(key, tally);
    }
  }
  return [...tallies.values()];
}

function joinHebrew(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  const last = parts[parts.length - 1]!;
  const glue = /^\d/u.test(last) ? "ו-" : "ו";
  return `${parts.slice(0, -1).join(", ")} ${glue}${last}`;
}

const WIN_LABEL: Record<string, (n: number) => string> = {
  deal_closed: (n) => (n === 1 ? "עסקה אחת" : `${n} עסקאות`),
  coop_deal: (n) => (n === 1 ? "עסקת שת״פ אחת" : `${n} עסקאות שת״פ`),
  exclusivity_signed: (n) => (n === 1 ? "בלעדיות אחת" : `${n} בלעדיויות`),
  offer_interested: (n) =>
    n === 1 ? "קונה אחד שאמר „מעוניין”" : `${n} קונים שאמרו „מעוניין”`,
};

function winsSentence(wins: readonly MentorWin[]): string | null {
  const counts = new Map<string, number>();
  for (const win of wins)
    if (win.kind in WIN_LABEL)
      counts.set(win.kind, (counts.get(win.kind) ?? 0) + 1);
  if (counts.size === 0) return null;
  const parts = Object.keys(WIN_LABEL)
    .filter((kind) => counts.has(kind))
    .map((kind) => WIN_LABEL[kind]!(counts.get(kind)!));
  return `החודש: ${joinHebrew(parts)}.`;
}

function totalsSentence(
  month: string,
  activity: MentorActivity,
): string | null {
  const parts = MENTOR_METRICS.filter((m) => activity[m.code] > 0)
    .slice(0, 6)
    .map((m) => mentorQuantity(m.code, activity[m.code]));
  return parts.length === 0
    ? null
    : `המספרים של ${month}: ${parts.join(" · ")}.`;
}

function weeksWord(n: number): string {
  return n === 1 ? "שבוע אחד" : n === 2 ? "שני שבועות" : `${n} שבועות`;
}

function goalSentences(
  tallies: readonly GoalTally[],
  activity: MentorActivity,
): string[] {
  const out: string[] = [];
  for (const t of tallies) {
    const label = mentorGoalLabel(t.metric, t.target, t.period);
    if (t.period === "month") {
      // יעד חודשי נמדד על החודש כולו — לא על השבוע האחרון שדיווח עליו
      const actual = activity[t.metric];
      out.push(
        actual >= t.target
          ? `היעד החודשי „${label}” — הושג.`
          : `היעד החודשי „${label}” — ${mentorQuantity(t.metric, actual)} מתוך ${t.target}. לא הפעם, והיעד עדיין שלך.`,
      );
      continue;
    }
    if (t.done === t.weeks)
      out.push(
        t.weeks === 1
          ? `„${label}” — הושג בשבוע היחיד שנמדד.`
          : `„${label}” — הושג בכל ${weeksWord(t.weeks)}. כל הכבוד לך.`,
      );
    else if (t.done === 0)
      out.push(
        `„${label}” — לא הושג באף אחד מ-${weeksWord(t.weeks)}. זה לא על היכולת שלך — זה על הסדר של השבוע, ועל זה נעבוד.`,
      );
    else out.push(`„${label}” — הושג ב-${t.done} מתוך ${weeksWord(t.weeks)}.`);
  }
  return out;
}

function ideaGist(text: string): string {
  const cut = text.search(/ — |[:.]/u);
  const gist = (cut < 0 ? text : text.slice(0, cut)).trim();
  return gist.length > 60 ? `${gist.slice(0, 59).trimEnd()}…` : gist;
}

function metricPlural(metric: MentorGoalMetric): string {
  return MENTOR_METRICS.find((m) => m.code === metric)?.many ?? metric;
}

function ideaSentences(
  marks: readonly MentorIdeaMark[],
  outcomes: readonly MentorIdeaOutcome[],
): string[] {
  const out: string[] = [];
  // אותו רעיון באותו יום — הסימון האחרון קובע
  const last = new Map<string, MentorIdeaMark>();
  for (const mark of marks) last.set(`${mark.key}@${mark.date}`, mark);
  const helpedMarks = [...last.values()].filter((m) => m.verdict === "helped");
  const helped = helpedMarks.length;
  const dismissed = last.size - helped;
  // „עזר לי” מסוף החודש שחלונו טרם נסגר כשהסיכום נכתב
  const measured = new Set(outcomes.map((o) => `${o.key}@${o.date}`));
  const pending = helpedMarks.filter(
    (m) => !measured.has(`${m.key}@${m.date}`),
  ).length;
  if (last.size === 0) {
    out.push(
      "לא סימנת רעיונות החודש. „עזר לי” ו„לא בשבילי” בבוקר הם איך שאני לומד מה עובד אצלך.",
    );
    return out;
  }
  const parts = [
    ...(helped > 0 ? [helped === 1 ? "אחד עזר" : `${helped} עזרו`] : []),
    ...(dismissed > 0
      ? [dismissed === 1 ? "אחד לא בשבילך" : `${dismissed} לא בשבילך`]
      : []),
  ];
  out.push(
    `סימנת ${last.size === 1 ? "רעיון אחד" : `${last.size} רעיונות`} החודש: ${parts.join(", ")}.`,
  );
  const best = outcomes
    .filter((o) => o.change === "up")
    .sort((a, b) => b.after - b.before - (a.after - a.before))[0];
  if (best !== undefined)
    out.push(
      `הרעיון שהזיז הכי הרבה: „${ideaGist(best.text)}” — ${metricPlural(best.metric)} ${best.before} ⟵ ${best.after} בשבוע שאחריו.`,
    );
  const unmoved = outcomes.filter((o) => o.change !== "up").length;
  if (unmoved > 0)
    out.push(
      unmoved === 1
        ? "רעיון אחד שסימנת „עזר לי” לא הזיז את המספר — התחושה נכונה, המספר עוד לא. שווה לשאול מה חסם."
        : `${unmoved} רעיונות שסימנת „עזר לי” לא הזיזו את המספר — התחושה נכונה, המספר עוד לא. שווה לשאול מה חסם.`,
    );
  if (pending > 0)
    out.push(
      pending === 1
        ? "רעיון אחד מסוף החודש עוד נמדד — התשובה בסיכום השבועי הקרוב."
        : `${pending} רעיונות מסוף החודש עוד נמדדים — התשובות בסיכומים השבועיים הקרובים.`,
    );
  return out;
}

function isEmptyActivity(activity: MentorActivity): boolean {
  return MENTOR_METRICS.every((m) => activity[m.code] === 0);
}

/**
 * הסיכום החודשי. ‎`null` = אין מה לומר: חודש בלי פעילות, בלי הצלחות,
 * בלי סיכומים שבועיים ובלי סימונים.
 */
export function mentorMonthlyReview(
  signals: MentorMonthSignals,
): MentorMonthlyReview | null {
  const { activity, wins, weeks, marks } = signals;
  if (
    isEmptyActivity(activity) &&
    wins.length === 0 &&
    weeks.length === 0 &&
    marks.length === 0
  )
    return null;

  const month = mentorMonthLabel(signals.monthStart);
  const previousMonth =
    signals.previousActivity === undefined
      ? null
      : mentorMonthLabel(new Date(signals.monthStart.getTime() - 1));
  const tallies = tallyGoals(weeks);
  const outcomes = signals.ideaOutcomes;

  const paragraphs: string[] = [];
  const said = winsSentence(wins);
  if (said !== null) paragraphs.push(said);
  const totals = totalsSentence(month, activity);
  if (totals !== null) paragraphs.push(totals);
  const trend =
    previousMonth === null
      ? null
      : mentorTrendSentence(activity, signals.previousActivity, previousMonth);
  if (trend !== null) paragraphs.push(trend);
  paragraphs.push(...goalSentences(tallies, activity));
  paragraphs.push(...ideaSentences(marks, outcomes));

  /*
   * מיקוד אחד לחודש הבא: היעד השבועי שהיה מאחור הכי הרבה שבועות. עם
   * טיפ מספר המשחק, מתחלף לפי החודש ובלי מה שנדחה. בלי פיגור — אותם
   * יעדים או גבוה יותר; בלי יעדים — הזמנה ליעד אחד.
   */
  const weekly = tallies.filter((t) => t.period === "week");
  const lagging = weekly
    .filter((t) => t.behind > 0)
    .sort((a, b) => b.behind - a.behind)[0];
  let focus: MentorGoalMetric | null = null;
  if (lagging !== undefined) {
    focus = lagging.metric;
    const seed =
      signals.monthStart.getUTCFullYear() * 12 +
      signals.monthStart.getUTCMonth();
    const tip = playbookIdeaPick(
      lagging.metric,
      seed,
      signals.feedback,
      signals.office,
    );
    paragraphs.push(
      `המיקוד לחודש הבא: ${metricPlural(lagging.metric)}. היעד היה מאחור ב-${lagging.behind} מתוך ${weeksWord(lagging.weeks)}. טיפ${tip.proven ? " (עבד אצל אחרים במשרד)" : ""}: ${tip.text}`,
    );
  } else if (weekly.length > 0) {
    paragraphs.push(
      "לחודש הבא: אותם יעדים — או אחד גבוה יותר. ההחלטה שלך, ואני איתך.",
    );
  } else {
    paragraphs.push("לחודש הבא: יעד שבועי אחד במסך היעדים — ואני אעקוב איתך.");
  }

  const deals = wins.filter(
    (w) => w.kind === "deal_closed" || w.kind === "coop_deal",
  ).length;
  const allMet = weekly.length > 0 && weekly.every((t) => t.done === t.weeks);
  const headline =
    deals > 0
      ? `${month}: ${mentorQuantity("deals_closed", deals)} — חודש שלך`
      : allMet
        ? `${month}: כל היעדים הושגו, שבוע אחרי שבוע`
        : tallies.length > 0
          ? `${month}: מה עבד ומה עוד לא`
          : `הסיכום של ${month}`;

  const firstName = (signals.firstName ?? "").trim();
  const greeting =
    firstName === ""
      ? null
      : `${mentorSalutation("היי", firstName, signals.persona ?? DEFAULT_MENTOR_PERSONA)} חודש שלם מאחוריך — הנה מה שראיתי.`;

  return { headline, greeting, paragraphs, focus };
}

export function mentorMonthlyBody(
  signals: MentorMonthSignals,
  review: MentorMonthlyReview,
): MentorMonthlyBody {
  return {
    greeting: review.greeting,
    paragraphs: review.paragraphs,
    focus: review.focus,
    activity: signals.activity,
    ...(signals.previousActivity === undefined
      ? {}
      : { previousActivity: signals.previousActivity }),
    ideaOutcomes: signals.ideaOutcomes,
  };
}
