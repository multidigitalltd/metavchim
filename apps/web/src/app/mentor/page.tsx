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
  jerusalemDayLabel,
  mentorGoalLabel,
  MENTOR_NAME_MAX,
  MENTOR_STYLE_INFO,
  mentorHasName,
  type MentorAdvice,
  type MentorGoalMetric,
  type MentorGoalProposal,
  type MentorPersona,
  type MentorStyle,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  type MentorInsights,
  mentorInsightSentences,
  mentorMonthLabel,
  type MentorMood,
  type MentorPace,
  type MentorPattern,
  mentorPatternLine,
  mentorQuantity,
  type MentorWin,
  type ProcessGoalSuggestion,
  PRACTICE_MAX_AGENT_TURNS,
  PRACTICE_SCENARIO_INFO,
  PRACTICE_TEXT_MAX,
  practiceScoreLabel,
  ONBOARDING_DAYS,
  type MentorOnboarding,
  type MentorPracticeFeedback,
  type PracticeScenario,
  type PracticeTurn,
} from "@metavchim/shared";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiList,
  apiPatch,
  apiPost,
} from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import {
  useFeature,
  useFeaturesFailed,
  useFeaturesReady,
} from "@/lib/use-features";
import { Celebration, type CelebrationEvent } from "../celebration";
import { ConfirmDialog } from "../confirm-dialog";
import {
  IconBolt,
  IconCalendar,
  IconChat,
  IconCheck,
  IconClock,
  IconFlame,
  IconHandshake,
  IconHeadphones,
  IconHome,
  IconKey,
  IconMail,
  IconPhone,
  IconSend,
  IconSparkle,
  IconStar,
  IconTarget,
  IconUsers,
} from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";
import { MentorPageMenu } from "./page-menu";

/*
 * המנטור האישי (docs/14) — המסך שמאחורי ההבטחה שהייתה כאן כ„בקרוב”.
 *
 * ארבעה חלקים, בסדר שבו מנטור מדבר: מה קרה השבוע (המונים והצלחות),
 * מול מה שביקשת מעצמך (היעדים והקצב), מה אמרתי במוצאי שבת (הסיכום
 * והשאלה), ומה תרצה לשאול (השיחה). כל טקסט שהמנטור אומר מגיע
 * מהשרת — הניסוח חי בחבילה המשותפת, לא כאן.
 *
 * ## למה המסך שקט
 *
 * המסך הזה מדבר בשם המנטור, ומנטור לא מסביר את עצמו: הוא אומר את
 * מה שיש ושותק. לכן אין כאן פסקאות הסבר — הכותרת אומרת מה החלק,
 * המספרים אומרים מה קרה, וכל מה שדורש הסבר יושב במדריך. אותה
 * שפה עיצובית כמו הדשבורד: אריחי KPI צבועים לפי תחום, אריח אייקון
 * לכל כותרת, ואפס שעובר לניטרלי מהנתון.
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

/** הסיכום החודשי כפי שה-API מחזיר אותו (`MentorMonthlyDto`) */
interface MonthlyDto {
  id: string;
  monthStart: string;
  headline: string;
  greeting: string | null;
  paragraphs: string[];
  focus: MentorGoalMetric | null;
  createdAt: string;
}

interface ReviewDto {
  id: string;
  weekStart: string;
  mood: MentorMood;
  headline: string;
  greeting: string | null;
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
  insights: MentorInsights;
  wins: MentorWin[];
  goals: GoalDto[];
  latestReview: ReviewDto | null;
  streakWeeks: number;
  chatAvailable: boolean;
  patterns: MentorPattern[];
  advice: MentorAdvice[];
  persona: MentorPersona;
  /** 30 הימים הראשונים — `null` למי שכבר עבר אותם (docs/14 §7.5) */
  onboarding: MentorOnboarding | null;
}

interface Turn {
  id: string;
  role: "user" | "mentor";
  text: string;
  createdAt: string;
}

/** תרגול שיחה כפי שהשרת מחזיר אותו (docs/14 §7.3) */
interface PracticeDto {
  id: string;
  scenario: PracticeScenario;
  scenarioLabel: string;
  counterpartName: string;
  turns: PracticeTurn[];
  agentTurns: number;
  /** הדמות סיימה — אין עוד תורים, רק משוב */
  closed: boolean;
  feedback: MentorPracticeFeedback | null;
  createdAt: string;
  endedAt: string | null;
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

/**
 * אריח לכל מדד — אייקון ותחום צבע, כמו מוני הדשבורד. אפס עובר
 * לניטרלי מהנתון (הכלל של §12), ולכן התחום כאן הוא של ערך חיובי.
 */
const METRIC_TILE: Record<
  MentorGoalMetric,
  { domain: string; icon: React.ReactNode }
> = {
  deals_closed: { domain: "green", icon: <IconHandshake s={16} /> },
  offers_sent: { domain: "blue", icon: <IconSend s={16} /> },
  viewings_held: { domain: "amber", icon: <IconKey s={16} /> },
  leads_answered: { domain: "peach", icon: <IconBolt s={16} /> },
  new_buyers: { domain: "violet", icon: <IconUsers s={16} /> },
  new_properties: { domain: "green", icon: <IconHome s={16} /> },
  calls_made: { domain: "blue", icon: <IconPhone s={16} /> },
  calls_answered: { domain: "blue", icon: <IconHeadphones s={16} /> },
  leads_answered_fast: { domain: "peach", icon: <IconClock s={16} /> },
  followups_done: { domain: "amber", icon: <IconCheck s={16} /> },
  owner_updates_sent: { domain: "violet", icon: <IconMail s={16} /> },
};

const EXAMPLE_QUESTIONS = [
  "תן לי רעיון להיום",
  "מה כדאי לי לשפר קודם?",
  "איפה המשפך שלי מאבד הכי הרבה?",
  "תעזור לי לבחור יעד לשבוע הבא",
];

/** מה יש לחגוג — יעדים שהושגו והצלחות השבוע, במפתחות יציבים לתקופה. */
function celebrationEvents(overview: Overview): CelebrationEvent[] {
  const done = overview.goals.filter((g) => g.progress.pace === "done");
  const goals = done.map((g) => ({
    // תחילת התקופה שנמדדה — לא השבוע: יעד חודשי שהושג בשבוע שחוצה חודש הוא אירוע חדש
    key: `goal:${g.id}:${g.progress.periodStart}`,
    label: `היעד הושג: ${mentorGoalLabel(g.metric, g.target, g.period)}`,
  }));
  // יעד שכבר נחגג מהיעדים למעלה — ההצלחה שנרשמה עליו אינה אירוע שני.
  // רק אותו יעד באותה תקופה: יעד שהופסק אחרי שהושג, או תקופה שהתחלפה,
  // נשארים בהצלחות — אחרת החגיגה נעלמת (ביקורת Codex)
  const celebrated = new Set(
    done.map(
      (g) => `${g.id}:${jerusalemDayLabel(new Date(g.progress.periodStart))}`,
    ),
  );
  // מזהה השורה ולא המיקום ברשימה — הסדר משתנה כשמצטרפת הצלחה חזקה יותר
  const wins = overview.wins
    .filter(
      (w) =>
        w.kind !== "goal_reached" ||
        !celebrated.has(`${w.goalId}:${w.periodKey}`),
    )
    .map((w, i) => ({
      key: `win:${w.id ?? `${overview.weekStart}:${w.kind}:${w.title}:${i}`}`,
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
  const { user, loading } = useRequireAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  const hasCoach = useFeature("ai_coach");
  const featuresReady = useFeaturesReady();
  const featuresFailed = useFeaturesFailed();

  const [overview, setOverview] = useState<Overview | null>(null);
  // שאלה שנפתחה מכרטיס העצות — נשלחת לשיחה ברגע שהיא מוכנה
  const [askMentor, setAskMentor] = useState<string | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [notInPlan, setNotInPlan] = useState(false);
  const [reviews, setReviews] = useState<ReviewDto[] | null>(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyDto[] | null>(null);
  const [monthlyFailed, setMonthlyFailed] = useState(false);

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
    setMonthlyFailed(false);
    apiGet<MonthlyDto[]>("/mentor/monthly")
      .then(setMonthly)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) return;
        setMonthlyFailed(true);
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
        <MentorHero streakWeeks={0} persona={null} />
        <section
          className="mv-card mv-card--pad mt-4"
          aria-labelledby="mentor-plan-heading"
        >
          <h2 id="mentor-plan-heading" className="mv-card-head__title m-0">
            המנטור נפתח יחד עם המאמן החכם
          </h2>
          <p className="mv-card-sub m-0">
            מנהל המשרד יכול לשדרג את המסלול במסך המנוי.
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
    <div className="mx-auto max-w-6xl py-6">
      <MentorHero
        streakWeeks={overview?.streakWeeks ?? 0}
        persona={overview?.persona ?? null}
      />


      {overviewFailed ? (
        <div className="mt-4">
          <LoadError message="לא הצלחנו לטעון את המנטור" onRetry={load} />
        </div>
      ) : overview === null ? (
        <p aria-live="polite" className="mt-4">
          טוען את השבוע שלך…
        </p>
      ) : (
        <>
          {/*
            ‎**התפריט הפנימי — מה יש בעמוד, בלי לגלול כדי לגלות.**

            ‏העמוד התארך עד שרוב מה שיש בו נמצא מתחת לקפל: מי שנכנס
            ‏רואה „השבוע” ומניח שזה העמוד.

            ‎**והוא יושב כאן, בתוך הענף שמרכיב את הסעיפים** (ביקורת
            ‏Codex, P2). כשהוא ישב מעל שלושת הענפים, טעינה חוזרת
            ‏שנכשלה (`onChanged`, `onFeedback`) החליפה את כל הסעיפים
            ‏ב-`LoadError` בלי לשנות את `overview` — ולכן התפריט
            ‏נשאר מלא בקישורים לעוגנים שאינם קיימים עוד. תלות
            ‏נוספת הייתה מטליאה את הסימפטום; מיקום שאינו יכול לשרוד
            ‏את הסעיפים מסלק את המצב.
          */}
          <div className="mt-4">
            <MentorPageMenu overview={overview} user={user} />
          </div>
          <div className="mt-6">
            <Celebration
              events={celebrationEvents(overview)}
              title="🎉 כל הכבוד — הושג"
            />
          </div>
          {overview.onboarding !== null ? (
            <OnboardingSection
              onboarding={overview.onboarding}
              onGoalSet={load}
              onAsk={setAskMentor}
            />
          ) : null}
          {/*
            ‎---- שני טורים: השיחה, ולידה הרייל ---- (חבילת העיצוב)

            ‏עד כה זה היה טור אחד ארוך שהשיחה יושבת בתחתיתו — כלומר
            ‏הדבר שהעמוד קרוי על שמו היה מתחת לכל השאר. בעיצוב
            ‏השיחה **היא** המסך, וכל מה שנמדד ונקבע יושב ברייל
            ‏שלצידה.

            ‎**הרייל דביק ולא גולל-בפנים.** קובץ העיצוב מבקש גלילה
            ‏פנימית בלי סקרולבר, כלומר עמוד בגובה קבוע. במערכת יש
            ‏סרגל נגישות שמגדיל טקסט, וגובה קבוע נשבר שם — ולכן
            ‏העמוד נשאר מסמך נגלל והרייל רק נדבק. אותה תחושה, בלי
            ‏להחליף התנהגות שלא אושרה.
          */}
          <div className="mv-mentor">
            <div className="mv-mentor__main">
              <AdviceSection
                advice={overview.advice}
                onAsk={setAskMentor}
                onFeedback={load}
              />
              <ChatSection
                available={overview.chatAvailable}
                firstName={firstName}
                mentorName={overview.persona.name}
                pending={askMentor}
                onConsumed={() => setAskMentor(null)}
                onGoalSet={load}
              />
            </div>

            <aside className="mv-mentor__rail" aria-label="הנתונים שלך">
              <WeekSection overview={overview} />
              <GoalsSection overview={overview} onChanged={load} />
          {overview.patterns.length > 0 ? (
            <section className="mt-8" aria-labelledby="mentor-memory-heading">
              <div className="mv-card-head mv-domain-violet mb-3">
                <span className="mv-tile" aria-hidden="true">
                  <IconStar s={19} />
                </span>
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
              <MonthlySection
                monthly={monthly}
                monthlyFailed={monthlyFailed}
                onRetry={load}
              />
              <PracticeSection mentorName={overview.persona.name} />
              {can(user, "analytics.view") ? <OfficeSection /> : null}
              <PersonaSection persona={overview.persona} onSaved={load} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/* ====================================================================== */
/* כותרת                                                                  */
/* ====================================================================== */

function MentorHero({
  streakWeeks,
  persona,
}: {
  streakWeeks: number;
  /** השם שהמתווך נתן — הכותרת; `null` עד שהסקירה נטענת */
  persona: MentorPersona | null;
}) {
  const named = persona !== null && mentorHasName(persona);
  return (
    <header className="mv-hero">
      <span className="mv-hero-icon" aria-hidden="true">
        <IconSparkle s={26} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-2xl font-extrabold">
          {named ? persona.name : "המנטור האישי שלך"}
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
          {named ? "המנטור האישי שלך — " : ""}מודד רק מולך, וחוגג כל הצלחה שלך.
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

/**
 * מה המנטור מציע עכשיו — עד שלוש עצות מהמספרים (docs/14 §7.1): שיחה
 * שמחכה, יעד מאחור, צוואר בקבוק במשפך, זמן מענה, או רעיון להיום.
 * כל עצה נפתחת לשיחה בלחיצה — השאלה כבר מנוסחת, המתווך רק לוחץ.
 */
function AdviceSection({
  advice,
  onAsk,
  onFeedback,
}: {
  advice: MentorAdvice[];
  onAsk: (question: string) => void;
  /** „לא בשבילי” החליף רעיון — המסך טוען מחדש */
  onFeedback: () => void;
}) {
  // משוב שנרשם — לפי מפתח הרעיון, כדי שהכפתור יגיד „נרשם” ולא יחזור
  const [noted, setNoted] = useState<Record<string, "helped" | "dismissed">>(
    {},
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function feedback(
    ideaKey: string,
    verdict: "helped" | "dismissed",
  ): Promise<void> {
    if (busyKey !== null) return;
    setBusyKey(ideaKey);
    setError(null);
    try {
      await apiPost("/mentor/ideas/feedback", { ideaKey, verdict });
      setNoted((prev) => ({ ...prev, [ideaKey]: verdict }));
      // רעיון שנדחה מתחלף — הסקירה נטענת מחדש עם הזיכרון החדש
      if (verdict === "dismissed") onFeedback();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "המשוב לא נשמר — כדאי לנסות שוב",
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (advice.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby="mentor-advice-heading">
      <div className="mv-card-head mv-domain-amber mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconBolt s={19} />
        </span>
        <h2 id="mentor-advice-heading" className="mv-card-head__title m-0">
          מה המנטור מציע עכשיו
        </h2>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {advice.map((item) => (
          <li
            key={`${item.kind}-${item.metric}`}
            className="mv-row mv-row--nested items-start"
          >
            <div className="min-w-0 flex-1">
              <div className="mv-row__title">{item.title}</div>
              <p
                className="mv-row__meta m-0 mt-1"
                style={{ whiteSpace: "normal" }}
              >
                {item.body}
              </p>
              {item.proven ? (
                <span className="mv-chip mt-1 inline-block">
                  עבד אצל אחרים במשרד
                </span>
              ) : null}
              {item.link !== undefined ? (
                <Link
                  href={item.link.href}
                  className="mv-link mt-1 inline-block"
                >
                  {item.link.label}
                </Link>
              ) : null}
              {item.ideaKey !== undefined ? (
                /*
                 * המשוב הוא הליווי: „עזר לי” — עוד מהסוג הזה; „לא בשבילי” —
                 * הרעיון לא חוזר, ומחליף אותו אחר (docs/14 §7.2).
                 */
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {noted[item.ideaKey] === undefined ? (
                    <>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        disabled={busyKey !== null}
                        onClick={() => void feedback(item.ideaKey!, "helped")}
                      >
                        👍 עזר לי
                      </button>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        disabled={busyKey !== null}
                        onClick={() =>
                          void feedback(item.ideaKey!, "dismissed")
                        }
                      >
                        👎 לא בשבילי
                      </button>
                    </>
                  ) : (
                    <span className="mv-card-sub" aria-live="polite">
                      {noted[item.ideaKey] === "helped"
                        ? "נרשם — עוד מהסוג הזה. בעוד שבוע אבדוק אם המספר זז."
                        : "נרשם — הרעיון הזה לא יחזור."}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="mv-btn-soft shrink-0"
              onClick={() => {
                onAsk(item.question);
                document
                  .getElementById("mentor-chat-heading")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              לשאול את המנטור
            </button>
          </li>
        ))}
      </ul>
      {error !== null ? (
        <div className="mt-2">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </section>
  );
}

/* ====================================================================== */
/* 30 הימים הראשונים — הליווי של מתווך חדש (docs/14 §7.5)                */
/* ====================================================================== */

function OnboardingSection({
  onboarding,
  onGoalSet,
  onAsk,
}: {
  onboarding: MentorOnboarding;
  onGoalSet: () => void;
  onAsk: (question: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { step } = onboarding;

  async function act(): Promise<void> {
    setError(null);
    if (step.kind === "goal" && step.goal !== undefined) {
      if (busy) return;
      setBusy(true);
      try {
        await apiPost("/mentor/goals", step.goal);
        onGoalSet();
      } catch (err: unknown) {
        setError(
          err instanceof ApiError
            ? err.message
            : "היעד לא נקבע — כדאי לנסות שוב",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step.kind === "chat" && step.question !== undefined) {
      onAsk(step.question);
      return;
    }
    if (step.kind === "practice") {
      document
        .getElementById("mentor-practice-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const weeks = [
    { n: 1, title: "להכיר" },
    { n: 2, title: "להוסיף" },
    { n: 3, title: "להתייצב" },
    { n: 4, title: "לסכם" },
  ];
  return (
    <section className="mt-6" aria-labelledby="mentor-onboarding-heading">
      <div className="mv-card-head mv-domain-peach mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconFlame s={19} />
        </span>
        <h2 id="mentor-onboarding-heading" className="mv-card-head__title m-0">
          30 הימים הראשונים
        </h2>
      </div>
      <div className="mv-card mv-card--pad">
        <p className="mv-card-sub m-0">
          יום {onboarding.day} מתוך {ONBOARDING_DAYS} · השבוע —{" "}
          {onboarding.weekTitle}
        </p>
        <ol
          className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0"
          aria-label="ארבעת השבועות"
        >
          {weeks.map((w) => (
            <li
              key={w.n}
              className="mv-chip"
              aria-current={w.n === onboarding.week ? "step" : undefined}
              style={
                w.n < onboarding.week
                  ? { color: "var(--color-text-muted)" }
                  : w.n === onboarding.week
                    ? { fontWeight: 700 }
                    : undefined
              }
            >
              {w.n < onboarding.week ? "✓ " : ""}
              {w.n}. {w.title}
            </li>
          ))}
        </ol>
        <p className="m-0 mt-3">{onboarding.weekFocus}</p>
        <div
          className="mt-3 rounded-xl p-4"
          style={{ background: "var(--color-surface-sunken)" }}
        >
          <p className="m-0 font-bold">{step.title}</p>
          <p className="m-0 mt-1">{step.body}</p>
          {step.kind !== "keep" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={
                  step.kind === "goal" ? "mv-control-go" : "mv-btn-soft"
                }
                disabled={busy}
                onClick={() => void act()}
              >
                {step.kind === "goal" ? "🎯 " : ""}
                {busy ? "קובע…" : step.cta}
              </button>
            </div>
          ) : null}
          {error !== null ? (
            <div className="mt-2">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function WeekSection({ overview }: { overview: Overview }) {
  const { activity, previousActivity, wins } = overview;
  const insightLines = mentorInsightSentences(overview.insights);
  return (
    <section className="mt-6" aria-labelledby="mentor-week-heading">
      <div className="mv-card-head mv-domain-neutral mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconCalendar s={19} />
        </span>
        <h2 id="mentor-week-heading" className="mv-card-head__title m-0">
          השבוע
        </h2>
        <span
          className="ms-auto text-[length:var(--type-caption-lg)] font-bold"
          style={{ color: "var(--color-text-muted)" }}
        >
          {weekLabel(overview.weekStart)}
        </span>
      </div>

      {/*
        אריחי ה-KPI של הדשבורד (§12), בגרסה שקטה: מציגים ולא מקשרים,
        ונמוכים יותר כי יש אחד-עשר. אפס עובר לניטרלי מהנתון — „אין
        עסקאות” לא אמור להיראות כמו התרעה.
      */}
      <dl className="m-0 grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MENTOR_METRICS.map((metric) => {
          const now = activity[metric.code];
          const before =
            previousActivity === null ? null : previousActivity[metric.code];
          const tile = METRIC_TILE[metric.code];
          return (
            <div
              key={metric.code}
              className={`mv-kpi mv-kpi--static mv-kpi--compact ${
                now === 0 ? "mv-domain-neutral" : `mv-domain-${tile.domain}`
              }`}
            >
              <dt className="mv-kpi__head">
                <span className="mv-kpi__label">{metric.label}</span>
                <span className="mv-tile" aria-hidden="true">
                  {tile.icon}
                </span>
              </dt>
              <dd className="mv-kpi__value mv-ltr m-0">{now}</dd>
              {/* השוואה רק לעצמו, ורק כשיש שבוע קודם — ולא כשהמספרים זהים */}
              {before !== null && before !== now ? (
                <dd className="mv-kpi__note m-0">שבוע שעבר: {before}</dd>
              ) : null}
            </div>
          );
        })}
      </dl>

      {/* מהירות המענה ושיחות שמחכות — עובדות, מול השבוע שעבר של המתווך עצמו */}
      {insightLines.length > 0 ? (
        <div className="mv-card mv-card--pad mt-3 flex items-start gap-3">
          <span className="mv-tile mv-domain-amber" aria-hidden="true">
            <IconClock s={19} />
          </span>
          <ul
            className="m-0 min-w-0 flex-1 list-none p-0"
            aria-label="מהירות המענה ושיחות שמחכות"
          >
            {insightLines.map((line) => (
              <li key={line} className="mt-1 leading-relaxed first:mt-0">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {wins.length > 0 ? (
        <div
          className="mv-card mv-card--pad mt-3"
          style={{ background: "var(--color-success-soft)" }}
        >
          <h3 className="m-0 text-[length:var(--type-row-title)] font-extrabold">
            🎉 ההצלחות שלך השבוע
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
      return `סגרת את ${win.title}`;
    case "exclusivity_signed":
      return `חתמת בלעדיות על ${win.title}`;
    case "offer_interested":
      return `קונה אמר „מעוניין” על ${win.title}`;
    case "coop_deal":
      return `עסקת שיתוף פעולה — ${win.title}`;
    case "goal_reached":
      return `היעד הושג: ${win.title}`;
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
  /*
   * הטופס מקופל כשיש יעדים: המסך אומר קודם איפה עומדים, ו„יעד חדש”
   * הוא כפתור בכותרת. בלי יעדים הטופס פתוח — זה הצעד הראשון.
   */
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  const showForm = formOpen ?? overview.goals.length === 0;

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
          היעדים שלך
        </h2>
        {!showForm ? (
          <button
            type="button"
            className="mv-btn-soft ms-auto"
            onClick={() => setFormOpen(true)}
          >
            + יעד חדש
          </button>
        ) : null}
      </div>

      {overview.goals.length === 0 ? null : (
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
                לסיים
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <GoalForm
          existing={overview.goals}
          onCreated={() => {
            setFormOpen(false);
            onChanged();
          }}
          onClose={
            overview.goals.length === 0 ? null : () => setFormOpen(false)
          }
        />
      ) : null}

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
          — ייסגר וייעלם מהמסך. הסיכומים נשארים.
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}

function GoalForm({
  existing,
  onCreated,
  onClose,
}: {
  existing: GoalDto[];
  onCreated: () => void;
  /** ריק כשאין יעדים — אז אין לאן לסגור */
  onClose: (() => void) | null;
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
        `יעד בין 1 ל-${MENTOR_GOAL_TARGET_MAX}, ו„בשביל מה” ותוכנית עד 200 תווים`,
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
      <div className="flex items-center gap-3">
        <h3
          id="mentor-goal-form-heading"
          className="m-0 text-[length:var(--type-row-title)] font-extrabold"
        >
          יעד חדש
        </h3>
        {onClose !== null ? (
          <button
            type="button"
            className="mv-btn-plain ms-auto"
            onClick={onClose}
          >
            לסגור
          </button>
        ) : null}
      </div>

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
            בשביל מה
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
            התוכנית
          </label>
          <input
            id="mentor-goal-intention"
            className="mv-control w-full"
            maxLength={MENTOR_INTENTION_MAX}
            value={intention}
            placeholder="כש… אז… — למשל: כל בוקר ב-11:00 ההצעות יוצאות"
            onChange={(e) => setIntention(e.target.value)}
          />
        </div>
      </div>

      {replacing ? (
        <p
          className="m-0 mt-3 text-[length:var(--type-body-sm)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          מחליף את היעד הקיים:{" "}
          {mentorGoalLabel(
            replacing.metric,
            replacing.target,
            replacing.period,
          )}
          .
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
            {suggesting ? "מחשב…" : "מה צריך לזה בשבוע?"}
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
            מה צריך בשבוע כדי להגיע לזה
          </h4>
          {suggestions.length === 0 ? (
            <p className="m-0 mt-2">כל יעדי התהליך כבר אצלך.</p>
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
          הסיכום הראשון מגיע במוצאי שבת — לכאן, לפעמון ולוואטסאפ.
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

/**
 * הסיכום החודשי — מה עבד ומה לא (docs/14 §3): המספרים מול החודש
 * שעבר, כמה שבועות היעד הושג, אילו רעיונות באמת הזיזו מספר, ומיקוד
 * אחד לחודש הבא. נכתב ב-1 בחודש; עד אז — מה יגיע.
 */
function MonthlySection({
  monthly,
  monthlyFailed,
  onRetry,
}: {
  monthly: MonthlyDto[] | null;
  monthlyFailed: boolean;
  onRetry: () => void;
}) {
  const [latest, ...older] = monthly ?? [];
  return (
    <section className="mt-8" aria-labelledby="mentor-monthly-heading">
      <div className="mv-card-head mv-domain-green mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconCalendar s={19} />
        </span>
        <h2 id="mentor-monthly-heading" className="mv-card-head__title m-0">
          הסיכום החודשי
        </h2>
      </div>
      {monthlyFailed ? (
        <LoadError
          message="לא הצלחנו לטעון את הסיכום החודשי"
          onRetry={onRetry}
        />
      ) : monthly === null ? (
        <p aria-live="polite" className="m-0">
          טוען…
        </p>
      ) : latest === undefined ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          הסיכום החודשי הראשון מגיע ביום ראשון אחרי סוף החודש — מה עבד, מה לא,
          ואיזה רעיון באמת הזיז מספר.
        </p>
      ) : (
        <>
          <MonthlyCard review={latest} />
          {older.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer font-bold">
                חודשים קודמים ({older.length})
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {older.map((r) => (
                  <MonthlyCard key={r.id} review={r} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function MonthlyCard({ review }: { review: MonthlyDto }) {
  return (
    <article className="mv-card mv-card--pad">
      <p className="mv-card-sub m-0">
        {mentorMonthLabel(new Date(review.monthStart))}
      </p>
      <h3 className="m-0 mt-1 text-lg font-bold">{review.headline}</h3>
      {review.greeting ? <p className="m-0 mt-2">{review.greeting}</p> : null}
      {review.paragraphs.map((p, i) => (
        <p key={i} className="m-0 mt-2">
          {p}
        </p>
      ))}
    </article>
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
      {review.greeting ? (
        <p className="m-0 mt-2 leading-relaxed font-bold">{review.greeting}</p>
      ) : null}
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
                ענית: „{review.reflectionAnswer}”
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
              בלי תשובה.
            </p>
          ) : (
            <div className="mt-2">
              <label
                htmlFor={`reflection-${review.id}`}
                className="mv-visually-hidden"
              >
                התשובה שלך למנטור
              </label>
              <textarea
                id={`reflection-${review.id}`}
                className="mv-input w-full"
                rows={2}
                maxLength={1000}
                value={answer}
                placeholder="כמה מילים — המנטור מקשיב"
                onChange={(e) => setAnswer(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="mv-control-go"
                  disabled={busy || answer.trim() === ""}
                  onClick={() => void send()}
                >
                  {busy ? "שומר…" : "לשלוח"}
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
      <label htmlFor={`plan-${review.id}`} className="mb-1 block font-bold">
        ואם זה יקרה שוב?
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
        placeholder="כש… אז… — במילים שלך"
        onChange={(e) => setPlan(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="mv-control-go"
          disabled={busy || plan.trim().length < 3}
          onClick={() => void save()}
        >
          {busy ? "שומר…" : "לשמור ליעד"}
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
          ? "התחייבת ✔"
          : review.commitment === "declined"
            ? "לא השבוע"
            : "בלי תשובה"}
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
          placeholder="מילה, אם בא לך"
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

/**
 * השם והסגנון של המנטור — של המשתמש, נשמרים בפרופיל (`preferences.mentor`)
 * ונוסעים איתו בין מכשירים (docs/14 §4.1). הבחירה כאן, במסך המנטור;
 * עמוד הפרופיל מציג אותה ומקשר לכאן.
 */
/* ====================================================================== */
/* תרגול שיחה — המנטור משחק את הצד השני (docs/14 §7.3)                    */
/* ====================================================================== */

function PracticeSection({ mentorName }: { mentorName: string }) {
  const [active, setActive] = useState<PracticeDto | null>(null);
  const [recent, setRecent] = useState<PracticeDto[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scenario, setScenario] = useState<PracticeScenario>(
    PRACTICE_SCENARIO_INFO[0]!.code,
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"start" | "reply" | "finish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    apiGet<{ active: PracticeDto | null; recent: PracticeDto[] }>(
      "/mentor/practice",
    )
      .then((res) => {
        setActive(res.active);
        setRecent(apiList(res.recent, "recent"));
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (active !== null && active.turns.length > 1) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [active?.turns.length, active]);

  const info = PRACTICE_SCENARIO_INFO.find((s) => s.code === scenario)!;

  async function start(): Promise<void> {
    if (busy !== null) return;
    setBusy("start");
    setError(null);
    try {
      const res = await apiPost<PracticeDto>("/mentor/practice", { scenario });
      setActive(res);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "התרגול לא התחיל — כדאי לנסות שוב",
      );
    } finally {
      setBusy(null);
    }
  }

  async function reply(): Promise<void> {
    const trimmed = text.trim();
    if (active === null || trimmed === "" || busy !== null) return;
    setBusy("reply");
    setError(null);
    const mine: PracticeTurn = { role: "agent", text: trimmed };
    setActive({ ...active, turns: [...active.turns, mine] });
    setText("");
    try {
      const res = await apiPost<{
        turn: PracticeTurn;
        closing: boolean;
        agentTurns: number;
      }>(`/mentor/practice/${active.id}/reply`, { text: trimmed });
      // הסגירה נשמרת בשרת — כך גם אחרי רענון אין עוד תורים, רק משוב
      setActive((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              turns: [...prev.turns, res.turn],
              agentTurns: res.agentTurns,
              closed: res.closing,
            },
      );
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "הצד השני לא ענה — כדאי לנסות שוב",
      );
    } finally {
      setBusy(null);
    }
  }

  async function finish(): Promise<void> {
    if (active === null || busy !== null) return;
    setBusy("finish");
    setError(null);
    try {
      const res = await apiPost<PracticeDto>(
        `/mentor/practice/${active.id}/finish`,
        {},
      );
      setActive(null);
      setRecent((prev) => [
        res,
        ...(prev ?? []).filter((p) => p.id !== res.id),
      ]);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "המשוב לא הגיע — כדאי לנסות שוב",
      );
    } finally {
      setBusy(null);
    }
  }

  const latest = recent?.[0];
  const closing = active?.closed === true;
  const canReply =
    active !== null &&
    !active.closed &&
    active.agentTurns < PRACTICE_MAX_AGENT_TURNS;

  return (
    <section className="mt-8" aria-labelledby="mentor-practice-heading">
      <div className="mv-card-head mv-domain-amber mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconHeadphones s={19} />
        </span>
        <h2 id="mentor-practice-heading" className="mv-card-head__title m-0">
          תרגול שיחה
        </h2>
      </div>
      <div className="mv-card mv-card--pad">
        {loadFailed ? (
          <LoadError message="לא הצלחנו לטעון את התרגול" onRetry={load} />
        ) : recent === null ? (
          <p aria-live="polite" className="m-0">
            טוען…
          </p>
        ) : active === null ? (
          <>
            <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
              {mentorName} משחק את הצד השני — מוכר, קונה או ליד — ובסוף אומר מה
              עבד, מה פספסת, ומשפט אחד לנסות בשיחה האמיתית.
            </p>
            <div
              className="mv-choices mt-3"
              role="group"
              aria-label="בחירת תרחיש לתרגול"
            >
              {PRACTICE_SCENARIO_INFO.map((s) => {
                const selected = s.code === scenario;
                return (
                  <button
                    key={s.code}
                    type="button"
                    aria-pressed={selected}
                    className="mv-choice"
                    onClick={() => setScenario(s.code)}
                  >
                    <span className="mv-choice__mark" aria-hidden="true" />
                    <span className="mv-choice__text">
                      <span className="mv-choice__title">{s.label}</span>
                      <span className="mv-choice__note">{s.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mv-card-sub m-0 mt-3">המטרה: {info.goal}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="mv-control-go"
                disabled={busy !== null}
                onClick={() => void start()}
              >
                {busy === "start"
                  ? "מתחיל…"
                  : `להתחיל — ${info.counterpart.name} על הקו`}
              </button>
            </div>
            {latest !== undefined && latest.feedback !== null ? (
              <PracticeFeedbackCard practice={latest} compact />
            ) : null}
            {recent.length > 1 ? (
              <details className="mt-3">
                <summary className="cursor-pointer font-bold">
                  תרגולים קודמים ({recent.length - 1})
                </summary>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {recent.slice(1).map((p) => (
                    <li key={p.id} className="mv-row">
                      <span className="mv-row__title">{p.scenarioLabel}</span>
                      <span className="mv-row__meta">
                        {p.endedAt === null
                          ? ""
                          : `${formatJerusalemDate(new Date(p.endedAt))} · `}
                        {p.feedback === null
                          ? "בלי משוב"
                          : `ציון ${practiceScoreLabel(p.feedback.score)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <>
            <p className="mv-card-sub m-0">
              {active.scenarioLabel} · {active.counterpartName} על הקו · תור{" "}
              {Math.min(active.agentTurns + 1, PRACTICE_MAX_AGENT_TURNS)} מתוך{" "}
              {PRACTICE_MAX_AGENT_TURNS}
            </p>
            <div className="mt-3 flex flex-col gap-3" aria-live="polite">
              {active.turns.map((turn, i) => (
                <div
                  key={i}
                  className={`mv-chat-bubble ${turn.role === "agent" ? "mv-chat-user" : "mv-chat-agent"}`}
                >
                  {turn.role === "counterpart" ? (
                    <span className="mv-card-sub block">
                      {active.counterpartName}
                    </span>
                  ) : null}
                  <span style={{ whiteSpace: "pre-line" }}>{turn.text}</span>
                </div>
              ))}
              {busy === "reply" ? (
                <div className="mv-chat-bubble mv-chat-agent">
                  <span aria-live="polite">{active.counterpartName} חושב…</span>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
            {closing ? (
              <Notice tone="info">
                {active.counterpartName} סיים את השיחה — עכשיו המשוב.
              </Notice>
            ) : null}
            {canReply && !closing ? (
              <form
                className="mt-3 flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void reply();
                }}
              >
                <label
                  htmlFor="mentor-practice-text"
                  className="mv-visually-hidden"
                >
                  מה אומרים ל{active.counterpartName}
                </label>
                <textarea
                  id="mentor-practice-text"
                  className="mv-input w-full"
                  rows={2}
                  maxLength={PRACTICE_TEXT_MAX}
                  value={text}
                  placeholder={`מה אומרים ל${active.counterpartName}?`}
                  disabled={busy !== null}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void reply();
                    }
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    className="mv-control-go"
                    disabled={busy !== null || text.trim() === ""}
                  >
                    לענות
                  </button>
                  <button
                    type="button"
                    className="mv-btn-soft"
                    disabled={busy !== null || active.agentTurns === 0}
                    onClick={() => void finish()}
                  >
                    {busy === "finish" ? "המנטור קורא…" : "לסיים ולקבל משוב"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="mv-control-go"
                  disabled={busy !== null || active.agentTurns === 0}
                  onClick={() => void finish()}
                >
                  {busy === "finish" ? "המנטור קורא…" : "לקבל משוב"}
                </button>
              </div>
            )}
            {error !== null ? (
              <div className="mt-2">
                <Notice tone="danger">{error}</Notice>
              </div>
            ) : null}
          </>
        )}
        {active === null && error !== null ? (
          <div className="mt-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** המשוב של המנטור על תרגול — מה עבד, מה פספסת, מה לנסות, והרשימה. */
function PracticeFeedbackCard({
  practice,
  compact,
}: {
  practice: PracticeDto;
  compact?: boolean;
}) {
  const fb = practice.feedback;
  if (fb === null) return null;
  return (
    <article
      className="mt-4 rounded-xl p-4"
      style={{ background: "var(--color-surface-sunken)" }}
      aria-label={`המשוב על ${practice.scenarioLabel}`}
    >
      <p className="m-0 font-bold">
        {compact ? "המשוב האחרון — " : ""}
        {practice.scenarioLabel}: ציון {practiceScoreLabel(fb.score)}
        {fb.source === "checklist"
          ? " (לפי הרשימה בלבד — מנוע השיחה אינו זמין)"
          : ""}
      </p>
      {fb.worked.length > 0 ? (
        <ul className="m-0 mt-2 list-none p-0">
          {fb.worked.map((w, i) => (
            <li key={i}>✓ {w}</li>
          ))}
        </ul>
      ) : null}
      {fb.missed.length > 0 ? (
        <ul className="m-0 mt-2 list-none p-0">
          {fb.missed.map((m, i) => (
            <li key={i}>✗ {m}</li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-3 font-bold">{fb.tryNext}</p>
      {/* הרשימה כשבבים — רק כשהמודל דיבר; בלי מודל היא כבר ה-✓/✗ שלמעלה */}
      {fb.source === "model" ? (
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
          {fb.checklist.map((c) => (
            <li
              key={c.key}
              className="mv-chip"
              style={
                c.met
                  ? undefined
                  : {
                      color: "var(--color-text-muted)",
                      textDecoration: "line-through",
                    }
              }
            >
              {c.label}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/* ====================================================================== */
/* מה עובד אצלנו — למנהל, ספירות בלבד (docs/14 §7.4)                      */
/* ====================================================================== */

interface OfficeDto {
  agents: number;
  proven: {
    key: string;
    metric: MentorGoalMetric;
    metricLabel: string;
    text: string;
    helped: number;
    dismissed: number;
    up: number;
    measured: number;
    evidence: string;
  }[];
}

function OfficeSection() {
  const [office, setOffice] = useState<OfficeDto | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    apiGet<OfficeDto>("/mentor/office")
      .then((res) =>
        setOffice({ ...res, proven: apiList(res.proven, "proven") }),
      )
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <section className="mt-8" aria-labelledby="mentor-office-heading">
      <div className="mv-card-head mv-domain-violet mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconUsers s={19} />
        </span>
        <h2 id="mentor-office-heading" className="mv-card-head__title m-0">
          מה עובד אצלנו
        </h2>
      </div>
      <div className="mv-card mv-card--pad">
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          מה המתווכים במשרד סימנו שעזר, ואצל כמה המספר באמת עלה בשבוע שאחרי —
          ספירות בלבד, בלי שמות. רעיון שהוכיח את עצמו כאן מוצע ראשון לכולם.
        </p>
        {failed ? (
          <div className="mt-3">
            <LoadError
              message="לא הצלחנו לטעון את מה שעובד אצלנו"
              onRetry={load}
            />
          </div>
        ) : office === null ? (
          <p aria-live="polite" className="m-0 mt-3">
            טוען…
          </p>
        ) : office.proven.length === 0 ? (
          <p className="m-0 mt-3">
            עוד אין רעיון שהוכיח את עצמו — הספירה מתחילה מ„עזר לי” הראשון של
            מישהו במשרד.
          </p>
        ) : (
          <>
            <p className="mv-card-sub m-0 mt-3">
              {office.agents === 1
                ? "מתווך אחד תרם עד עכשיו"
                : `${office.agents} מתווכים תרמו עד עכשיו`}
            </p>
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {office.proven.slice(0, 8).map((e) => (
                <li key={e.key} className="mv-row">
                  <span className="mv-row__title">
                    <span className="mv-chip me-2">{e.metricLabel}</span>
                    {e.text}
                  </span>
                  <span className="mv-row__meta">{e.evidence}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function PersonaSection({
  persona,
  onSaved,
}: {
  persona: MentorPersona;
  onSaved: () => void;
}) {
  const [name, setName] = useState(persona.name);
  const [style, setStyle] = useState<MentorStyle>(persona.style);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(persona.name);
    setStyle(persona.style);
  }, [persona.name, persona.style]);
  const dirty = name.trim() !== persona.name || style !== persona.style;

  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "" || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch("/auth/profile", {
        preferences: { mentor: { name: trimmed, style } },
      });
      setSaved(true);
      onSaved();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "לא נשמר — כדאי לנסות שוב",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="mentor-persona"
      className="mt-8"
      aria-labelledby="mentor-persona-heading"
    >
      <div className="mv-card-head mv-domain-violet mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconSparkle s={19} />
        </span>
        <h2 id="mentor-persona-heading" className="mv-card-head__title m-0">
          השם והסגנון של המנטור
        </h2>
      </div>
      <div className="mv-card mv-card--pad">
        <p className="mv-card-sub m-0">
          איך לקרוא למנטור, ובאיזה קול הוא מדבר. הבחירה שלך בלבד — נשמרת בפרופיל
          ונוסעת איתך בין מכשירים.
        </p>
        <label
          htmlFor="mentor-name"
          className="mt-4 mb-1.5 block text-sm font-semibold"
        >
          שם
        </label>
        <input
          id="mentor-name"
          className="mv-input w-full max-w-xs"
          value={name}
          maxLength={MENTOR_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="המנטור"
        />
        <p
          id="mentor-style-label"
          className="mt-4 mb-1.5 text-sm font-semibold"
        >
          סגנון ליווי
        </p>
        {/* שורת בחירה של המערכת — עיגול, כותרת והערה: קומפקטית, לא כרטיס */}
        <div
          className="mv-choices"
          role="group"
          aria-labelledby="mentor-style-label"
        >
          {MENTOR_STYLE_INFO.map((info) => {
            const selected = info.code === style;
            return (
              <button
                key={info.code}
                type="button"
                aria-pressed={selected}
                className="mv-choice"
                onClick={() => setStyle(info.code)}
              >
                <span className="mv-choice__mark" aria-hidden="true" />
                <span className="mv-choice__text">
                  <span className="mv-choice__title">
                    {info.label}
                    <span className="mx-1.5 font-medium">— {info.blurb}</span>
                  </span>
                  <span className="mv-choice__note">„{info.sample}”</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="mv-control-go"
            disabled={saving || !dirty || name.trim() === ""}
            onClick={() => void save()}
          >
            שמירה
          </button>
          {saved && !dirty ? (
            <span className="mv-card-sub" aria-live="polite">
              נשמר — מהודעה הבאה המנטור מדבר ככה.
            </span>
          ) : null}
        </div>
        {error !== null ? (
          <div className="mt-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ChatSection({
  available,
  firstName,
  mentorName,
  pending,
  onConsumed,
  onGoalSet,
}: {
  available: boolean;
  firstName: string;
  /** השם שהמתווך נתן למנטור — כותרת השיחה */
  mentorName: string;
  /** שאלה שנפתחה מכרטיס העצות — נשלחת ברגע שהשיחה פנויה */
  pending: string | null;
  onConsumed: () => void;
  /** יעד נקבע מהשיחה — המסך טוען מחדש את היעדים */
  onGoalSet: () => void;
}) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  /*
   * יעד שהמנטור הציע לקבוע — כפתור מתחת לתשובה שלו. המודל מציע,
   * המתווך לוחץ, הקוד כותב (docs/14 §7). לא נשמר: מי שלא לחץ יכול
   * לבקש שוב.
   */
  const [proposal, setProposal] = useState<{
    goal: MentorGoalProposal;
    afterTurnId: string;
  } | null>(null);
  const [settingGoal, setSettingGoal] = useState(false);
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

  // השאלה מכרטיס העצות — פעם אחת, כשהשיחה טעונה ופנויה
  const sendRef = useRef<(q: string) => Promise<void>>(async () => {});
  useEffect(() => {
    if (pending === null || turns === null || busy) return;
    onConsumed();
    void sendRef.current(pending);
  }, [pending, turns, busy, onConsumed]);

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
    setProposal(null);
    try {
      const res = await apiPost<{
        turn: Turn;
        source: "model" | "fallback";
        proposedGoal?: MentorGoalProposal;
      }>("/mentor/messages", {
        text: trimmed,
      });
      setTurns((prev) => [...(prev ?? []), res.turn]);
      if (res.proposedGoal !== undefined) {
        setProposal({ goal: res.proposedGoal, afterTurnId: res.turn.id });
      }
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? err.message
          : "המנטור לא הצליח לענות — כדאי לנסות שוב",
      );
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = send;

  async function setGoal(goal: MentorGoalProposal): Promise<void> {
    if (settingGoal) return;
    setSettingGoal(true);
    setError(null);
    const label = mentorGoalLabel(goal.metric, goal.target, goal.period);
    try {
      await apiPost("/mentor/goals", goal);
      setProposal(null);
      setTurns((prev) => [
        ...(prev ?? []),
        {
          id: `local-goal-${Date.now()}`,
          role: "mentor",
          text: `🎯 היעד נקבע: ${label}. מכאן אני עוקב — ובבוקר נדבר על מה היום שווה.`,
          createdAt: new Date().toISOString(),
        },
      ]);
      onGoalSet();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "היעד לא נקבע — כדאי לנסות שוב",
      );
    } finally {
      setSettingGoal(false);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="mentor-chat-heading">
      <div className="mv-card-head mv-domain-blue mb-3">
        <span className="mv-tile" aria-hidden="true">
          <IconChat s={19} />
        </span>
        <h2 id="mentor-chat-heading" className="mv-card-head__title m-0">
          לדבר עם {mentorName}
        </h2>
      </div>

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
                  היי{firstName === "" ? "" : ` ${firstName}`} 👋 על מה נדבר?
                </span>
              </div>
            ) : null}
            {turns.map((turn) => (
              <div key={turn.id} className="contents">
                <div
                  className={`mv-chat-bubble ${turn.role === "user" ? "mv-chat-user" : "mv-chat-agent"}`}
                >
                  <span style={{ whiteSpace: "pre-line" }}>{turn.text}</span>
                </div>
                {proposal !== null && proposal.afterTurnId === turn.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="mv-btn-soft"
                      disabled={settingGoal}
                      onClick={() => void setGoal(proposal.goal)}
                    >
                      🎯 לקבוע יעד:{" "}
                      {mentorGoalLabel(
                        proposal.goal.metric,
                        proposal.goal.target,
                        proposal.goal.period,
                      )}
                    </button>
                    <button
                      type="button"
                      className="mv-btn-plain"
                      disabled={settingGoal}
                      onClick={() => setProposal(null)}
                    >
                      לא עכשיו
                    </button>
                  </div>
                ) : null}
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

        {/*
          ‎**שורת השאלות המוכנות — תמיד, ולא רק בשיחה ריקה.**

          ‏עד כה הן נעלמו אחרי ההודעה הראשונה, כלומר בדיוק כשאדם
          ‏כבר יודע שיש עם מי לדבר ומחפש על מה. בקובץ העיצוב הן
          ‏שורה קבועה מעל תיבת הכתיבה (החלטת בעל המוצר).

          ‎`overflow-x-auto` ו-`mv-noscrollbar`: במובייל הן שורה
          ‏שנגללת לרוחב ולא ערימה שדוחפת את תיבת הכתיבה מהמסך.
        */}
        {turns !== null ? (
          <div className="mv-noscrollbar mt-3 flex gap-2 overflow-x-auto lg:flex-wrap">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="mv-example-chip flex-none"
                disabled={busy}
                onClick={() => void send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          <label htmlFor="mentor-chat-input" className="mv-visually-hidden">
            שאלה למנטור
          </label>
          <textarea
            id="mentor-chat-input"
            className="mv-input w-full"
            rows={2}
            maxLength={1000}
            value={text}
            placeholder="שאלה למנטור… Enter שולח"
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

      {/* שורה אחת מתחת לכרטיס, רק כשיש מה לומר: השיחה החופשית אינה מוגדרת */}
      {available ? null : (
        <p
          className="m-0 mt-2 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          השיחה החופשית לא מוגדרת כרגע, והמנטור עונה מהיעדים ומהסיכום.
        </p>
      )}
    </section>
  );
}
