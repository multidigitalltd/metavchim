"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatJerusalemDate,
  MENTOR_GOAL_TARGET_MAX,
  MENTOR_INTENTION_MAX,
  MENTOR_METRICS,
  type MentorActivity,
  MentorGoalInputSchema,
  mentorGoalLabel,
  type MentorGoalMetric,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  mentorPatternLine,
  type MentorMood,
  type MentorPace,
  type MentorPattern,
  mentorQuantity,
  type MentorWin,
  type ProcessGoalSuggestion,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiList, apiPost } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import {
  useFeature,
  useFeaturesFailed,
  useFeaturesReady,
} from "@/lib/use-features";
import { Celebration, type CelebrationEvent } from "../celebration";
import { ConfirmDialog } from "../confirm-dialog";
import {
  IconCheck,
  IconChat,
  IconFlame,
  IconSparkle,
  IconTarget,
} from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/*
 * המנטור האישי (docs/13) — המסך שמאחורי ההבטחה שהייתה כאן כ„בקרוב”.
 *
 * ארבעה חלקים, בסדר שבו מנטור מדבר: מה קרה השבוע (המונים והצלחות),
 * מול מה שביקשתם מעצמכם (היעדים והקצב), מה אמרתי לכם במוצאי שבת
 * (הסיכום והשאלה), ומה תרצו לשאול (השיחה). כל טקסט שהמנטור אומר
 * מגיע מהשרת — הניסוח חי בחבילה המשותפת, לא כאן.
 */

/* ---------- צורות התשובה, כפי שה-API מחזיר (תאריכים כמחרוזות) ---------- */

interface GoalDto {
  id: string;
  metric: MentorGoalMetric;
  period: MentorGoalPeriod;
  target: number;
  why: string | null;
  intention: string | null;
  createdAt: string;
  progress: MentorGoalProgress;
}

interface ReviewDto {
  id: string;
  weekStart: string;
  mood: MentorMood;
  headline: string;
  paragraphs: string[];
  askNextWeek: string | null;
  ask: {
    metric: MentorGoalMetric;
    period: MentorGoalPeriod;
    target: number;
  } | null;
  commitment: "accepted" | "declined" | null;
  committedAt: string | null;
  commitmentNote: string | null;
  plan: string | null;
  planSuggestions: string[];
  reflection: string | null;
  reflectionAnswer: string | null;
  allGoalsMet: boolean;
  wins: MentorWin[];
  createdAt: string;
}

interface Overview {
  weekStart: string;
  weekEnd: string;
  activity: MentorActivity;
  previousActivity: MentorActivity | null;
  wins: MentorWin[];
  goals: GoalDto[];
  latestReview: ReviewDto | null;
  streakWeeks: number;
  chatAvailable: boolean;
  patterns: MentorPattern[];
}

interface Turn {
  id: string;
  role: "user" | "mentor";
  text: string;
  createdAt: string;
}

const PACE_LABEL: Record<MentorPace, string> = {
  done: "הושג",
  ahead: "מעל הקצב",
  on_track: "בקצב",
  behind: "מאחור",
};

/** צבע הקצב — טוקנים בלבד, שני המצבים נגזרים מהם. */
const PACE_COLOR: Record<MentorPace, string> = {
  done: "var(--color-success)",
  ahead: "var(--color-primary)",
  on_track: "var(--color-text-muted)",
  behind: "var(--color-warning)",
};

const MOOD_ICON: Record<MentorMood, string> = {
  celebrate: "🎉",
  steady: "📈",
  encourage: "💪",
};

const EXAMPLE_QUESTIONS = [
  "איך היה השבוע שלי?",
  "מה כדאי לי לשפר קודם?",
  "תעזור לי לבחור יעד לשבוע הבא",
];

/** מה יש לחגוג — יעדים שהושגו והצלחות השבוע, במפתחות יציבים לתקופה. */
function celebrationEvents(overview: Overview): CelebrationEvent[] {
  const goals = overview.goals
    .filter((g) => g.progress.pace === "done")
    .map((g) => ({
      key: `goal:${g.id}:${g.period === "week" ? overview.weekStart : overview.weekStart.slice(0, 7)}`,
      label: `היעד הושג: ${mentorGoalLabel(g.metric, g.target, g.period)}`,
    }));
  const wins = overview.wins.map((w, i) => ({
    key: `win:${overview.weekStart}:${w.kind}:${w.title}:${i}`,
    label: winLabel(w),
  }));
  return [...goals, ...wins];
}

function metricLabel(metric: MentorGoalMetric): string {
  return MENTOR_METRICS.find((m) => m.code === metric)?.label ?? metric;
}

function weekLabel(iso: string): string {
  return `שבוע ${formatJerusalemDate(new Date(iso))}`;
}

export default function MentorPage() {
  const { loading } = useRequireAuth();
  const hasCoach = useFeature("ai_coach");
  const featuresReady = useFeaturesReady();
  const featuresFailed = useFeaturesFailed();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [notInPlan, setNotInPlan] = useState(false);
  const [reviews, setReviews] = useState<ReviewDto[] | null>(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);

  const load = useCallback(() => {
    setOverviewFailed(false);
    setReviewsFailed(false);
    apiGet<Overview>("/mentor/overview")
      .then((data) => {
        setOverview(data);
        setNotInPlan(false);
      })
      .catch((err: unknown) => {
        /* 403 = המנטור אינו במסלול. תשובה, לא תקלה. */
        if (err instanceof ApiError && err.status === 403) {
          setNotInPlan(true);
          return;
        }
        setOverviewFailed(true);
      });
    apiGet<ReviewDto[]>("/mentor/reviews")
      .then(setReviews)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) return;
        setReviewsFailed(true);
      });
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!featuresReady && !featuresFailed) return;
    if (featuresReady && !hasCoach) {
      setNotInPlan(true);
      return;
    }
    load();
  }, [loading, featuresReady, featuresFailed, hasCoach, load]);

  if (loading) return null;

  if (notInPlan) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <MentorHero streakWeeks={0} />
        <section
          className="mv-card mv-card--pad mt-4"
          aria-labelledby="mentor-plan-heading"
        >
          <h2 id="mentor-plan-heading" className="mv-card-head__title m-0">
            המנטור כלול במסלול עם המאמן החכם
          </h2>
          <p className="mv-card-sub m-0">
            המנטור האישי הוא הרחבה של המאמן החכם, ונפתח יחד איתו. מנהל המשרד
            יכול לשדרג את המסלול במסך המנוי.
          </p>
          <Link
            href="/settings/billing"
            className="mv-btn-plain mt-4 inline-flex no-underline"
          >
            למסך המנוי
          </Link>
        </section>
      </div>
    );
  }

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mx-auto max-w-3xl py-6">
      <MentorHero streakWeeks={overview?.streakWeeks ?? 0} />

      {overviewFailed ? (
        <div className="mt-4">
          <LoadError message="לא הצלחנו לטעון את המנטור" onRetry={load} />
        </div>
      ) : overview === null ? (
        <p aria-live="polite" className="mt-4">
          טוען את השבוע שלכם…
        </p>
      ) : (
        <>
          <div className="mt-6">
            <Celebration
              events={celebrationEvents(overview)}
              title="🎉 כל הכבוד — הושג"
            />
          </div>
          <WeekSection overview={overview} />
          <GoalsSection overview={overview} onChanged={load} />
          {overview.patterns.length > 0 ? (
            <section className="mt-8" aria-labelledby="mentor-memory-heading">
              <div className="mv-card-head mb-3">
                <h2
                  id="mentor-memory-heading"
                  className="mv-card-head__title m-0"
                >
                  מה המנטור זוכר
                </h2>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {overview.patterns.map((p, i) => (
                  <li
                    key={i}
                    className="mv-card mv-card--pad"
                    style={
                      p.kind === "recurring_behind"
                        ? { borderColor: "var(--color-warning)" }
                        : undefined
                    }
                  >
                    {mentorPatternLine(p)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ReviewSection
            latest={overview.latestReview}
            reviews={reviews}
            reviewsFailed={reviewsFailed}
            onRetry={load}
            onAnswered={load}
          />
          <ChatSection available={overview.chatAvailable} />
        </>
      )}
    </div>
  );
}

/* ====================================================================== */
/* כותרת                                                                  */
/* ====================================================================== */

function MentorHero({ streakWeeks }: { streakWeeks: number }) {
  return (
    <header className="mv-hero">
      <span className="mv-hero-icon" aria-hidden="true">
        <IconSparkle s={26} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-2xl font-extrabold">
          המנטור האישי שלך
          <span
            className="mx-2 inline-block rounded-full px-2.5 py-0.5 align-middle text-[length:var(--type-body-sm)] font-extrabold"
            style={{
              background: "var(--color-primary-soft)",
              color: "var(--color-primary)",
            }}
          >
            AI
          </span>
        </h1>
        <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
          מודד את השבוע מול מה שביקשתם מעצמכם, חוגג כל הצלחה בשמה, ומזכיר את
          היעד כשקשה. אף פעם לא מול עמיתים — רק מולכם.
        </p>
        {streakWeeks >= 2 ? (
          <p
            className="m-0 mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[length:var(--type-body-sm)] font-bold"
            style={{
              background: "var(--color-success-soft)",
              color: "var(--color-success)",
            }}
          >
            <IconFlame s={16} /> {streakWeeks} שבועות רצופים שכל היעדים מושגים
          </p>
        ) : null}
      </div>
    </header>
  );
}

/* ====================================================================== */
/* השבוע                                                                  */
/* ====================================================================== */

function WeekSection({ overview }: { overview: Overview }) {
  const { activity, previousActivity, wins } = overview;
  return (
    <section className="mt-6" aria-labelledby="mentor-week-heading">
      <div className="mv-card-head mb-3">
        <h2 id="mentor-week-heading" className="mv-card-head__title m-0">
          השבוע — {weekLabel(overview.weekStart)}
        </h2>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {MENTOR_METRICS.map((metric) => {
          const now = activity[metric.code];
          const before =
            previousActivity === null ? null : previousActivity[metric.code];
          return (
            <li
              key={metric.code}
              className="mv-card mv-card--pad flex flex-col"
              style={{ minHeight: 110 }}
            >
              <span
                className="text-[length:var(--type-body-sm)] font-bold"
                style={{ color: "var(--color-text-muted)" }}
              >
                {metric.label}
              </span>
              <span
                className="mt-auto text-[length:var(--type-kpi)] font-black leading-none"
                style={{
                  color:
                    metric.kind === "outcome"
                      ? "var(--color-primary)"
                      : "var(--color-text)",
                }}
              >
                {now}
              </span>
              {/* השוואה רק לעצמו, ורק כשיש שבוע קודם — ולא כשהמספרים זהים */}
              {before !== null && before !== now ? (
                <span
                  className="mt-1 text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  שבוע שעבר: {before}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {wins.length > 0 ? (
        <div
          className="mv-card mv-card--pad mt-3"
          style={{ background: "var(--color-success-soft)" }}
        >
          <h3 className="m-0 text-[length:var(--type-row-title)] font-extrabold">
            🎉 הצלחות השבוע
          </h3>
          <ul className="m-0 mt-2 list-none p-0">
            {wins.map((win, i) => (
              <li key={`${win.kind}-${i}`} className="mv-zero-line py-1">
                <IconCheck s={18} /> {winLabel(win)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function winLabel(win: MentorWin): string {
  switch (win.kind) {
    case "deal_closed":
      return `סגרתם את ${win.title}`;
    case "exclusivity_signed":
      return `חתמתם בלעדיות על ${win.title}`;
    case "offer_interested":
      return `קונה אמר „מעוניין” על ${win.title}`;
    case "coop_deal":
      return `עסקת שיתוף פעולה — ${win.title}`;
  }
}

/* ====================================================================== */
/* יעדים                                                                  */
/* ====================================================================== */

function GoalsSection({
  overview,
  onChanged,
}: {
  overview: Overview;
  onChanged: () => void;
}) {
  const [ending, setEnding] = useState<GoalDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endGoal(): Promise<void> {
    if (ending === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/mentor/goals/${encodeURIComponent(ending.id)}`);
      setEnding(null);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "סיום היעד נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="mentor-goals-heading">
      <div className="mv-card-head mv-domain-green mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconTarget s={19} />
        </span>
        <h2 id="mentor-goals-heading" className="mv-card-head__title m-0">
          היעדים שביקשתם מעצמכם
        </h2>
      </div>

      {overview.goals.length === 0 ? (
        <p className="m-0 mb-3" style={{ color: "var(--color-text-muted)" }}>
          עדיין אין יעדים. יעד אחד ברור — „5 הצעות בשבוע” — שווה יותר משלושה
          כלליים.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {overview.goals.map((goal) => (
            <li key={goal.id} className="mv-row mv-row--nested items-start">
              <div className="min-w-0 flex-1">
                <div className="mv-row__title">
                  {mentorGoalLabel(goal.metric, goal.target, goal.period)}
                  <span
                    className="mx-2 text-[length:var(--type-body-sm)] font-bold"
                    style={{ color: PACE_COLOR[goal.progress.pace] }}
                  >
                    {PACE_LABEL[goal.progress.pace]}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="mv-progress"
                    style={{ maxWidth: 220 }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={goal.target}
                    aria-valuenow={goal.progress.actual}
                    aria-label={`${metricLabel(goal.metric)}: ${goal.progress.actual} מתוך ${goal.target}`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, Math.round(goal.progress.ratio * 100))}%`,
                        background: PACE_COLOR[goal.progress.pace],
                      }}
                    />
                  </span>
                  <span className="text-[length:var(--type-body-sm)] font-bold">
                    {mentorQuantity(goal.metric, goal.progress.actual)} מתוך{" "}
                    {goal.target}
                  </span>
                </div>
                {goal.why ? (
                  <p className="mv-row__why m-0">בשביל: {goal.why}</p>
                ) : null}
                {goal.intention ? (
                  <p className="mv-row__why m-0">התוכנית: „{goal.intention}”</p>
                ) : null}
              </div>
              <button
                type="button"
                className="mv-btn-plain mv-row__action"
                onClick={() => setEnding(goal)}
              >
                לסיים יעד
              </button>
            </li>
          ))}
        </ul>
      )}

      <GoalForm existing={overview.goals} onCreated={onChanged} />

      <ConfirmDialog
        open={ending !== null}
        title="לסיים את היעד?"
        tone="danger"
        confirmLabel="לסיים"
        busy={busy}
        busyLabel="מסיים…"
        onConfirm={() => void endGoal()}
        onClose={() => setEnding(null)}
      >
        <p className="m-0">
          {ending === null
            ? ""
            : mentorGoalLabel(ending.metric, ending.target, ending.period)}{" "}
          — היעד ייסגר וייעלם מהמסך. הסיכומים שכבר נאמרו עליו נשארים.
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}

function GoalForm({
  existing,
  onCreated,
}: {
  existing: GoalDto[];
  onCreated: () => void;
}) {
  const [metric, setMetric] = useState<MentorGoalMetric>("offers_sent");
  const [period, setPeriod] = useState<MentorGoalPeriod>("week");
  const [target, setTarget] = useState("5");
  const [why, setWhy] = useState("");
  const [intention, setIntention] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    ProcessGoalSuggestion[] | null
  >(null);
  const [suggesting, setSuggesting] = useState(false);

  const replacing = existing.find(
    (g) => g.metric === metric && g.period === period,
  );
  const isOutcome =
    MENTOR_METRICS.find((m) => m.code === metric)?.kind === "outcome";

  function payload(): Record<string, unknown> | null {
    const parsed = MentorGoalInputSchema.safeParse({
      metric,
      period,
      target: Number(target),
      ...(why.trim() === "" ? {} : { why: why.trim() }),
      ...(intention.trim() === "" ? {} : { intention: intention.trim() }),
    });
    if (!parsed.success) {
      setError(
        `יעד בין 1 ל-${MENTOR_GOAL_TARGET_MAX}, ו„למה” ותוכנית עד 200 תווים`,
      );
      return null;
    }
    return parsed.data;
  }

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const body = payload();
    if (body === null) return;
    setBusy(true);
    try {
      await apiPost("/mentor/goals", body);
      setWhy("");
      setIntention("");
      setSuggestions(null);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קביעת היעד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function suggest(): Promise<void> {
    setError(null);
    const parsed = MentorGoalInputSchema.pick({
      target: true,
      period: true,
    }).safeParse({
      target: Number(target),
      period,
    });
    if (!parsed.success) {
      setError(`יעד בין 1 ל-${MENTOR_GOAL_TARGET_MAX}`);
      return;
    }
    setSuggesting(true);
    try {
      const plan = await apiGet<ProcessGoalSuggestion[]>(
        `/mentor/suggestions?target=${encodeURIComponent(parsed.data.target)}&period=${encodeURIComponent(parsed.data.period)}`,
      );
      setSuggestions(plan);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "לא הצלחנו לחשב יעדי תהליך",
      );
    } finally {
      setSuggesting(false);
    }
  }

  async function adopt(suggestion: ProcessGoalSuggestion): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/mentor/goals", {
        metric: suggestion.metric,
        period: suggestion.period,
        target: suggestion.target,
      });
      setSuggestions((prev) =>
        prev === null ? null : prev.filter((s) => s !== suggestion),
      );
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קביעת היעד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void create(e)}
      noValidate
      className="mv-card mv-card--pad mt-4"
      aria-labelledby="mentor-goal-form-heading"
      aria-describedby={error ? "mentor-goal-error" : undefined}
    >
      <h3
        id="mentor-goal-form-heading"
        className="m-0 text-[length:var(--type-row-title)] font-extrabold"
      >
        יעד חדש
      </h3>
      <p className="mv-card-sub m-0">
        היעד שלכם, לא של המשרד. „למה” הוא העוגן שהמנטור יזכיר כשקשה; „התוכנית”
        היא „כש… אז…” — למשל „כל בוקר ב-11:00 שולח הצעות”.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="mentor-goal-metric"
            className="mb-1 block text-sm font-medium"
          >
            מה מודדים
          </label>
          <select
            id="mentor-goal-metric"
            className="mv-control"
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value as MentorGoalMetric);
              setSuggestions(null);
            }}
          >
            {MENTOR_METRICS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
                {m.kind === "outcome" ? " (תוצאה)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="mentor-goal-target"
            className="mb-1 block text-sm font-medium"
          >
            כמה
          </label>
          <input
            id="mentor-goal-target"
            type="number"
            inputMode="numeric"
            min={1}
            max={MENTOR_GOAL_TARGET_MAX}
            className="mv-control"
            style={{ width: 96 }}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div>
          <span
            className="mb-1 block text-sm font-medium"
            id="mentor-goal-period-label"
          >
            בכל
          </span>
          <div
            className="mv-seg"
            role="group"
            aria-labelledby="mentor-goal-period-label"
          >
            <button
              type="button"
              aria-pressed={period === "week"}
              onClick={() => {
                setPeriod("week");
                setSuggestions(null);
              }}
            >
              שבוע
            </button>
            <button
              type="button"
              aria-pressed={period === "month"}
              onClick={() => {
                setPeriod("month");
                setSuggestions(null);
              }}
            >
              חודש
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="mentor-goal-why"
            className="mb-1 block text-sm font-medium"
          >
            בשביל מה (רשות)
          </label>
          <input
            id="mentor-goal-why"
            className="mv-control w-full"
            maxLength={200}
            value={why}
            placeholder="למשל: הדירה של הילדים"
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="mentor-goal-intention"
            className="mb-1 block text-sm font-medium"
          >
            התוכנית — „כש… אז…” (רשות)
          </label>
          <input
            id="mentor-goal-intention"
            className="mv-control w-full"
            maxLength={MENTOR_INTENTION_MAX}
            value={intention}
            placeholder="למשל: כל בוקר ב-11:00 שולח הצעות"
            onChange={(e) => setIntention(e.target.value)}
          />
        </div>
      </div>

      {replacing ? (
        <p
          className="m-0 mt-3 text-[length:var(--type-body-sm)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          יש כבר יעד על {metricLabel(metric)}{" "}
          {period === "week" ? "בשבוע" : "בחודש"} (
          {mentorGoalLabel(
            replacing.metric,
            replacing.target,
            replacing.period,
          )}
          ). יעד חדש מחליף אותו.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="mv-control-go"
          disabled={busy || target.trim() === ""}
        >
          {busy ? "שומר…" : "לקבוע יעד"}
        </button>
        {isOutcome ? (
          <button
            type="button"
            className="mv-btn-soft"
            disabled={suggesting || target.trim() === ""}
            onClick={() => void suggest()}
          >
            {suggesting ? "מחשב…" : "מה צריך לעשות בשבוע כדי להגיע לזה?"}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <Notice tone="danger" id="mentor-goal-error">
            {error}
          </Notice>
        </div>
      ) : null}

      {suggestions !== null ? (
        <div
          className="mt-4 rounded-xl border p-4"
          style={{ borderColor: "var(--color-row-border)" }}
        >
          <h4 className="m-0 text-[length:var(--type-row-title)] font-extrabold">
            יעדי תהליך לשבוע — לפי משפך ההמרה שלכם
          </h4>
          <p
            className="m-0 mt-1 text-[length:var(--type-body-sm)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            תוצאה אינה בשליטה; מה שלפניה במשפך — כן. אלה המספרים שבשליטתכם.
          </p>
          {suggestions.length === 0 ? (
            <p className="m-0 mt-2">כל יעדי התהליך כבר נקבעו.</p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {suggestions.map((s) => (
                <li key={s.metric} className="mv-row mv-row--flush">
                  <div className="min-w-0 flex-1">
                    <div className="mv-row__title">
                      {mentorGoalLabel(s.metric, s.target, s.period)}
                    </div>
                    <p className="mv-row__why m-0">{s.reason}</p>
                  </div>
                  <button
                    type="button"
                    className="mv-btn-soft mv-row__action"
                    disabled={busy}
                    onClick={() => void adopt(s)}
                  >
                    לקבוע
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </form>
  );
}

/* ====================================================================== */
/* הסיכום השבועי                                                          */
/* ====================================================================== */

function ReviewSection({
  latest,
  reviews,
  reviewsFailed,
  onRetry,
  onAnswered,
}: {
  latest: ReviewDto | null;
  reviews: ReviewDto[] | null;
  reviewsFailed: boolean;
  onRetry: () => void;
  onAnswered: () => void;
}) {
  const older =
    reviews === null ? [] : reviews.filter((r) => r.id !== latest?.id);
  return (
    <section className="mt-8" aria-labelledby="mentor-review-heading">
      <div className="mv-card-head mv-domain-amber mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconSparkle s={19} />
        </span>
        <h2 id="mentor-review-heading" className="mv-card-head__title m-0">
          הסיכום השבועי
        </h2>
      </div>

      {latest === null ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          הסיכום הראשון מגיע במוצאי שבת — לפעמון ולוואטסאפ, וגם לכאן. עם יעד אחד
          לפחות תמיד יש מה לומר.
        </p>
      ) : (
        <ReviewCard review={latest} onAnswered={onAnswered} />
      )}

      {reviewsFailed ? (
        <div className="mt-3">
          <LoadError
            message="לא הצלחנו לטעון סיכומים קודמים"
            onRetry={onRetry}
          />
        </div>
      ) : older.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-bold">
            סיכומים קודמים ({older.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {older.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                onAnswered={onAnswered}
                compact
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ReviewCard({
  review,
  onAnswered,
  compact = false,
}: {
  review: ReviewDto;
  onAnswered: () => void;
  compact?: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    if (answer.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(
        `/mentor/reviews/${encodeURIComponent(review.id)}/reflection`,
        {
          answer: answer.trim(),
        },
      );
      setAnswer("");
      onAnswered();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת התשובה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="mv-card mv-card--pad"
      aria-label={`${review.headline} — ${weekLabel(review.weekStart)}`}
    >
      <p
        className="m-0 text-[length:var(--type-caption-lg)] font-bold"
        style={{ color: "var(--color-text-muted)" }}
      >
        {weekLabel(review.weekStart)}
      </p>
      <h3 className="m-0 mt-1 text-[length:var(--type-card-title)] font-black">
        <span aria-hidden="true">{MOOD_ICON[review.mood]} </span>
        {review.headline}
      </h3>
      {review.paragraphs.map((p, i) => (
        <p key={i} className="m-0 mt-2 leading-relaxed">
          {p}
        </p>
      ))}
      {review.askNextWeek ? (
        <p
          className="m-0 mt-3 font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {review.askNextWeek}
        </p>
      ) : null}
      {review.ask ? (
        <Commitment review={review} onChanged={onAnswered} compact={compact} />
      ) : null}

      {review.reflection ? (
        <div
          className="mt-4 rounded-xl p-4"
          style={{ background: "var(--color-surface-sunken)" }}
        >
          <p className="m-0 font-bold">{review.reflection}</p>
          {review.reflectionAnswer !== null ? (
            <>
              <p className="m-0 mt-2" style={{ whiteSpace: "pre-line" }}>
                עניתם: „{review.reflectionAnswer}”
              </p>
              <ObstaclePlan
                review={review}
                onSaved={onAnswered}
                compact={compact}
              />
            </>
          ) : compact ? (
            <p
              className="m-0 mt-2"
              style={{ color: "var(--color-text-muted)" }}
            >
              לא ענו.
            </p>
          ) : (
            <div className="mt-2">
              <label
                htmlFor={`reflection-${review.id}`}
                className="mb-1 block text-sm font-medium"
              >
                מה עצר, לדעתכם? המנטור מקשיב, ומביא את זה לשיחה.
              </label>
              <textarea
                id={`reflection-${review.id}`}
                className="mv-input w-full"
                rows={2}
                maxLength={1000}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="mv-control-go"
                  disabled={busy || answer.trim() === ""}
                  onClick={() => void send()}
                >
                  {busy ? "שומר…" : "לשמור תשובה"}
                </button>
              </div>
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

/**
 * מהמכשול לתוכנית — החצי השני של WOOP. אחרי „מה עצר?” המנטור שואל
 * „ואם זה יקרה שוב?”, מציע שלוש תוכניות „כש… אז…” לפי המדד, והמתווך
 * כותב את שלו. התוכנית נכנסת ליעד ככוונת יישום, ולכן הדחיפה של
 * אמצע השבוע והבקשה לשבוע הבא יזכירו אותה.
 */
function ObstaclePlan({
  review,
  onSaved,
  compact,
}: {
  review: ReviewDto;
  onSaved: () => void;
  compact: boolean;
}) {
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (plan.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/mentor/reviews/${encodeURIComponent(review.id)}/plan`, {
        plan: plan.trim(),
      });
      setPlan("");
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת התוכנית נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (review.plan !== null) {
    return (
      <p
        className="m-0 mt-2 font-bold"
        style={{ color: "var(--color-primary)" }}
      >
        ואם זה יקרה שוב: „{review.plan}” — נכנס ליעד.
      </p>
    );
  }
  if (compact) return null;

  return (
    <div className="mt-3">
      <label
        htmlFor={`plan-${review.id}`}
        className="mb-1 block text-sm font-medium"
      >
        ואם זה יקרה שוב? כתבו תוכנית בצורת „כש… אז…” — היא תיכנס ליעד.
      </label>
      {review.planSuggestions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {review.planSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="mv-example-chip"
              disabled={busy}
              onClick={() => setPlan(s)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <input
        id={`plan-${review.id}`}
        className="mv-control w-full"
        maxLength={MENTOR_INTENTION_MAX}
        value={plan}
        placeholder="למשל: כשלא נשאר זמן — אז ההצעות ראשונות בבוקר"
        onChange={(e) => setPlan(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="mv-control-go"
          disabled={busy || plan.trim().length < 3}
          onClick={() => void save()}
        >
          {busy ? "שומר…" : "לשמור את התוכנית ליעד"}
        </button>
      </div>
      {error ? (
        <div className="mt-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </div>
  );
}

/**
 * המחויבות — „מתחייב” או „לא השבוע”. מנטורים חיים על התשובה הזאת:
 * בקשה שנאמרה ונעלמה אינה עסקה בין שניים. אפשר לשנות את הדעת עד
 * הסיכום הבא, ולכן הכפתורים נשארים גם אחרי הבחירה.
 */
function Commitment({
  review,
  onChanged,
  compact,
}: {
  review: ReviewDto;
  onChanged: () => void;
  compact: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function decide(decision: "accepted" | "declined"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost(
        `/mentor/reviews/${encodeURIComponent(review.id)}/commitment`,
        {
          decision,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      );
      setNote("");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת ההתחייבות נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (compact || review.commitment !== null) {
    return (
      <p
        className="m-0 mt-2 text-[length:var(--type-body-sm)] font-bold"
        style={{
          color:
            review.commitment === "accepted"
              ? "var(--color-success)"
              : "var(--color-text-muted)",
        }}
      >
        {review.commitment === "accepted"
          ? "התחייבתם ✔"
          : review.commitment === "declined"
            ? "לא השבוע"
            : "לא ענו"}
        {review.commitmentNote ? ` — „${review.commitmentNote}”` : ""}
        {!compact ? (
          <button
            type="button"
            className="mv-btn-plain mx-2"
            disabled={busy}
            onClick={() =>
              void decide(
                review.commitment === "accepted" ? "declined" : "accepted",
              )
            }
          >
            לשנות
          </button>
        ) : null}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy}
          onClick={() => void decide("accepted")}
        >
          מתחייב 💪
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          disabled={busy}
          onClick={() => void decide("declined")}
        >
          לא השבוע
        </button>
        <input
          className="mv-control"
          style={{ flex: "1 1 200px" }}
          maxLength={300}
          value={note}
          placeholder="מילה, אם רוצים (למשל: רק 4 השבוע, יש מילואים)"
          aria-label="הערה להתחייבות"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <div className="mt-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </div>
  );
}

/* ====================================================================== */
/* השיחה                                                                  */
/* ====================================================================== */

function ChatSection({ available }: { available: boolean }) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    apiGet<{ turns: Turn[] }>("/mentor/messages")
      .then((res) => setTurns(apiList(res.turns, "turns")))
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if ((turns?.length ?? 0) > 0 || busy) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [turns?.length, busy]);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    const optimistic: Turn = {
      id: `local-${Date.now()}`,
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setTurns((prev) => [...(prev ?? []), optimistic]);
    setText("");
    try {
      const res = await apiPost<{ turn: Turn; source: "model" | "fallback" }>(
        "/mentor/messages",
        {
          text: trimmed,
        },
      );
      setTurns((prev) => [...(prev ?? []), res.turn]);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "המנטור לא הצליח לענות — נסו שוב",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="mentor-chat-heading">
      <div className="mv-card-head mv-domain-blue mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconChat s={19} />
        </span>
        <h2 id="mentor-chat-heading" className="mv-card-head__title m-0">
          לדבר עם המנטור
        </h2>
      </div>
      <p
        className="m-0 mb-3 text-[length:var(--type-body-sm)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        על השבוע, על היעדים ועל מה לשפר. שאלות על לקוח או נכס ספציפי —{" "}
        <Link href="/voice">לסוכן האישי</Link>.
        {available
          ? ""
          : " השיחה החופשית אינה מוגדרת כרגע; המנטור עונה מהיעדים ומהסיכום."}
      </p>

      <div className="mv-card mv-card--pad">
        {loadFailed ? (
          <LoadError message="לא הצלחנו לטעון את השיחה" onRetry={load} />
        ) : turns === null ? (
          <p aria-live="polite" className="m-0">
            טוען את השיחה…
          </p>
        ) : (
          <div className="flex flex-col gap-3" aria-live="polite">
            {turns.length === 0 ? (
              <div className="mv-chat-bubble mv-chat-agent">
                <span>
                  שלום. אני מודד רק מולכם — לא מול אף אחד אחר. על מה נדבר?
                </span>
              </div>
            ) : null}
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`mv-chat-bubble ${turn.role === "user" ? "mv-chat-user" : "mv-chat-agent"}`}
              >
                <span style={{ whiteSpace: "pre-line" }}>{turn.text}</span>
              </div>
            ))}
            {busy ? (
              <div
                className="mv-chat-bubble mv-chat-agent"
                aria-label="המנטור חושב"
              >
                <span className="mv-chat-typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}

        {turns !== null && turns.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="mv-example-chip"
                disabled={busy}
                onClick={() => void send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          <label
            htmlFor="mentor-chat-input"
            className="mb-1 block text-sm font-medium"
          >
            מה תרצו לשאול?
          </label>
          <textarea
            id="mentor-chat-input"
            className="mv-input w-full"
            rows={2}
            maxLength={1000}
            value={text}
            placeholder="למשל: „מה כדאי לי לשפר קודם?” · Enter שולח, Shift+Enter יורד שורה"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="mv-control-go"
              disabled={busy || text.trim().length < 2}
              onClick={() => void send(text)}
            >
              {busy ? "חושב…" : "שליחה"}
            </button>
          </div>
          {error ? (
            <div className="mt-2">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
