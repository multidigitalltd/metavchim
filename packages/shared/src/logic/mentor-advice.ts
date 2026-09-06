import { jerusalemDayLabel } from "./israel-time.js";
import {
  MENTOR_METRICS,
  mentorGoalLabel,
  mentorMinutesLabel,
  mentorQuantity,
  mentorTrendSentence,
  type MentorActivity,
  type MentorGoalMetric,
  type MentorGoalProgress,
  type MentorInsights,
} from "./mentor.js";
import {
  EMPTY_IDEA_FEEDBACK,
  FUNNEL_STAGES,
  MENTOR_PLAYBOOK,
  funnelBottleneck,
  funnelReadingLabel,
  funnelReadings,
  ideaByKey,
  playbookIdeaPick,
  type MentorIdeaFeedback,
  type PlaybookIdea,
} from "./mentor-playbook.js";

/**
 * העצה של המנטור — מה הוא מציע **עכשיו**, מתוך המספרים (docs/14 §7.1).
 *
 * מנטור לא נותן עשר עצות; הוא מצביע על הדבר האחד או השניים שהכי
 * שווה לעשות היום, ואומר למה. הסדר כאן הוא סדר של מנטור:
 *
 * 1. **שיחה שמחכה** — לקוח שהתקשר ולא קיבל טלפון חוזר. לפני כל יעד.
 * 2. **יעד שבועי מאחור** — מה שהמתווך ביקש מעצמו ולא בקצב.
 * 3. **צוואר בקבוק במשפך** — השלב שבו הולך לאיבוד הכי הרבה, ביחס
 *    למקובל (לא לעמיתים).
 * 4. **זמן מענה** — לידים שנענים, אבל אחרי שעה.
 * 5. **רעיון להיום** — כשהכול בקצב: רעיון אחד מספר המשחק, על המדד
 *    שהכי רלוונטי, מתחלף כל יום.
 *
 * עד שלוש עצות, מדד אחד לכל עצה. כל עצה נושאת גם שאלה — מה לשאול
 * את המנטור כדי להעמיק בה — כדי שהמסך יוכל לפתוח את השיחה ממנה.
 */

export type MentorAdviceKind =
  "missed_calls" | "behind_goal" | "bottleneck" | "response_time" | "idea";

export interface MentorAdvice {
  kind: MentorAdviceKind;
  metric: MentorGoalMetric;
  /** מה ראה המנטור — עובדה, במשפט */
  title: string;
  /** מה לעשות — רעיון אחד קונקרטי */
  body: string;
  /** מה לשאול את המנטור כדי להעמיק */
  question: string;
  /** מפתח הרעיון מספר המשחק שבגוף — למשוב „עזר לי” / „לא בשבילי”; חסר כשהגוף אינו רעיון */
  ideaKey?: string;
}

export interface MentorAdviceInput {
  goals: readonly MentorGoalProgress[];
  activity: MentorActivity;
  previousActivity?: MentorActivity | null;
  insights?: MentorInsights;
  /** המשפך של המתווך — הפעילות המצטברת בחלון ההיסטוריה */
  funnel?: { history: MentorActivity; weeks: number } | null;
  /** מה המתווך אמר על רעיונות — „לא בשבילי” אינו חוזר (docs/14 §7.2) */
  feedback?: MentorIdeaFeedback;
  now: Date;
}

const MAX_ADVICE = 3;
/** מעל שעה — המענה מגיע, אבל אחרי שהלקוח כבר דיבר עם מישהו אחר */
const SLOW_RESPONSE_MINUTES = 60;

/** מספר היום — זרע יציב לרעיון היומי; שני בקרים באותו יום, אותו רעיון. */
export function mentorDaySeed(now: Date): number {
  // תווית היום הישראלי ⟵ מספר יום — בלי שעון המכשיר ובלי אזור זמן
  const [year, month, day] = jerusalemDayLabel(now).split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

/**
 * המדד שהמנטור היה בוחר לדבר עליו היום: יעד שבועי מאחור (הרחוק
 * ביותר מהקצב), אחרת היעד השבועי שהכי פחות התקדם, אחרת הצעות —
 * הצעד שבשליטה מלאה ושממנו מתחיל כל משפך.
 */
export function mentorFocusMetric(
  goals: readonly MentorGoalProgress[],
): MentorGoalMetric {
  const weekly = goals.filter((g) => g.period === "week" && g.pace !== "done");
  const behind = weekly
    .filter((g) => g.pace === "behind")
    .sort((a, b) => a.ratio - b.ratio)[0];
  if (behind !== undefined) return behind.metric;
  const least = [...weekly].sort((a, b) => a.ratio - b.ratio)[0];
  if (least !== undefined) return least.metric;
  const monthly = goals.find((g) => g.pace === "behind");
  return monthly?.metric ?? "offers_sent";
}

/** רעיון אחד להיום — מספר המשחק, על מדד המיקוד, מתחלף כל יום, בלי מה שנדחה. */
export function mentorDailyIdeaPick(
  goals: readonly MentorGoalProgress[],
  now: Date,
  feedback: MentorIdeaFeedback = EMPTY_IDEA_FEEDBACK,
): PlaybookIdea {
  return playbookIdeaPick(
    mentorFocusMetric(goals),
    mentorDaySeed(now),
    feedback,
  );
}

export function mentorDailyIdea(
  goals: readonly MentorGoalProgress[],
  now: Date,
  feedback?: MentorIdeaFeedback,
): string {
  return mentorDailyIdeaPick(goals, now, feedback).text;
}

function metricLabel(metric: MentorGoalMetric): string {
  return MENTOR_METRICS.find((m) => m.code === metric)?.label ?? metric;
}

export function mentorAdvice(input: MentorAdviceInput): MentorAdvice[] {
  const seed = mentorDaySeed(input.now);
  const feedback = input.feedback ?? EMPTY_IDEA_FEEDBACK;
  const pick = (metric: MentorGoalMetric): PlaybookIdea =>
    playbookIdeaPick(metric, seed, feedback);
  const advice: MentorAdvice[] = [];
  const taken = new Set<MentorGoalMetric>();
  const push = (item: MentorAdvice): void => {
    if (taken.has(item.metric) || advice.length >= MAX_ADVICE) return;
    taken.add(item.metric);
    advice.push(item);
  };

  const missed = input.insights?.missedUnreturned ?? 0;
  if (missed > 0) {
    push({
      kind: "missed_calls",
      metric: "calls_answered",
      title:
        missed === 1
          ? "שיחה נכנסת אחת מחכה לטלפון חוזר"
          : `${missed} שיחות נכנסות מחכות לטלפון חוזר`,
      body: `להתחיל את היום מהן — כל אחת היא לקוח שכבר בחר להתקשר. ${MENTOR_PLAYBOOK.calls_answered.ideas[0]!}`,
      question: "איך לא לפספס שיחות נכנסות?",
    });
  }

  const behind = input.goals
    .filter((g) => g.period === "week" && g.pace === "behind")
    .sort((a, b) => a.ratio - b.ratio);
  for (const goal of behind) {
    const label = mentorGoalLabel(goal.metric, goal.target, goal.period);
    const idea = pick(goal.metric);
    push({
      kind: "behind_goal",
      metric: goal.metric,
      title: `${label}: ${mentorQuantity(goal.metric, goal.actual)} עד עכשיו — מאחור`,
      body: idea.text,
      question: `איך להגיע ל${label}?`,
      ideaKey: idea.key,
    });
  }

  const funnel = input.funnel ?? null;
  const bottleneck = funnel === null ? null : funnelBottleneck(funnel.history);
  if (bottleneck !== null && funnel !== null) {
    const idea = pick(bottleneck.stage.to);
    push({
      kind: "bottleneck",
      metric: bottleneck.stage.to,
      title: `צוואר הבקבוק שלך: ${bottleneck.stage.label}`,
      body: `${funnelReadingLabel(bottleneck)} ב-${funnel.weeks} השבועות האחרונים. ${idea.text}`,
      question: `איך לשפר את ההמרה ${bottleneck.stage.label}?`,
      ideaKey: idea.key,
    });
  }

  const median = input.insights?.responseMedianMinutes ?? null;
  if (median !== null && median > SLOW_RESPONSE_MINUTES) {
    const idea = pick("leads_answered_fast");
    push({
      kind: "response_time",
      metric: "leads_answered_fast",
      title: `זמן המענה החציוני ללידים חדשים השבוע: ${mentorMinutesLabel(median)}`,
      body: idea.text,
      question: "איך לענות ללידים חדשים מהר יותר?",
      ideaKey: idea.key,
    });
  }

  if (advice.length === 0) {
    const focus = mentorFocusMetric(input.goals);
    const idea = pick(focus);
    push({
      kind: "idea",
      metric: focus,
      title: `רעיון להיום — ${metricLabel(focus)}`,
      body: idea.text,
      question: "תן לי עוד רעיון להיום",
      ideaKey: idea.key,
    });
  }
  return advice;
}

/** „3 הצעות, 2 סיורים ו-4 שיחות יוצאות” — רק מה שאינו אפס. */
function activityLine(activity: MentorActivity): string | null {
  const parts = MENTOR_METRICS.filter((m) => activity[m.code] > 0).map((m) =>
    mentorQuantity(m.code, activity[m.code]),
  );
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * מה המודל מקבל כדי לייעץ — הפעילות, המגמה, המשפך, הניתוח, ורעיונות
 * מספר המשחק על שני מדדי המיקוד. חומר גלם, לא תשובה: המודל מתאים
 * אותו למספרים ולשאלה. בלי מודל — אותם נתונים הם תשובת הגיבוי.
 */
export function mentorAdviceBlock(
  input: MentorAdviceInput,
  advice: readonly MentorAdvice[],
): string[] {
  const lines: string[] = [];
  const week = activityLine(input.activity);
  lines.push(`השבוע עד עכשיו: ${week ?? "עדיין בלי פעילות שנספרה"}.`);
  const trend = mentorTrendSentence(
    input.activity,
    input.previousActivity ?? undefined,
  );
  if (trend !== null) lines.push(trend);
  const funnel = input.funnel ?? null;
  if (funnel !== null) {
    const readings = funnelReadings(funnel.history).filter(
      (r) => r.ratio !== null,
    );
    if (readings.length > 0) {
      lines.push(
        `המשפך של המתווך ב-${funnel.weeks} השבועות האחרונים (יחס בפועל מול המקובל — לא מול עמיתים): ${readings.map(funnelReadingLabel).join(" · ")}.`,
      );
    }
  }
  if (advice.length > 0) {
    lines.push("", "הניתוח של המנטור — מה הכי שווה לעשות עכשיו:");
    for (const item of advice) lines.push(`- ${item.title}. ${item.body}`);
  }
  const feedback = input.feedback ?? EMPTY_IDEA_FEEDBACK;
  const liked = feedback.liked
    .map(ideaByKey)
    .filter((i) => i !== null)
    .slice(-3);
  const dismissed = feedback.dismissed
    .map(ideaByKey)
    .filter((i) => i !== null)
    .slice(-5);
  if (liked.length > 0) {
    lines.push(
      "",
      "רעיונות שהמתווך סימן שעזרו לו (לבנות עליהם, לא לחזור עליהם מילה במילה):",
      ...liked.map((i) => `  • ${i.text}`),
    );
  }
  if (dismissed.length > 0) {
    lines.push(
      "",
      "רעיונות שהמתווך סימן „לא בשבילי” — לא להציע שוב, גם לא בניסוח אחר:",
      ...dismissed.map((i) => `  • ${i.text}`),
    );
  }
  const focus = [
    ...new Set([
      mentorFocusMetric(input.goals),
      ...advice.map((a) => a.metric),
    ]),
  ].slice(0, 2);
  lines.push(
    "",
    "רעיונות מספר המשחק (להתאים למספרים של המתווך ולשאלה; לא לצטט כרשימה):",
  );
  const skip = new Set(feedback.dismissed);
  for (const metric of focus) {
    const entry = MENTOR_PLAYBOOK[metric];
    lines.push(`${metricLabel(metric)} — ${entry.diagnosis}`);
    const open = entry.ideas.filter((_, i) => !skip.has(`${metric}:${i}`));
    for (const idea of open.slice(0, 3)) lines.push(`  • ${idea}`);
  }
  return lines;
}

/** שלבי המשפך — לתיעוד ולמסך; מיוצא כדי שמקור אחד יאמר מה נמדד. */
export const MENTOR_FUNNEL_STAGES = FUNNEL_STAGES;
