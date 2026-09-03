"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GOAL_HORIZON_LABELS,
  GOAL_HORIZONS,
  GOAL_UNIT_LABELS,
  formatIsraeliNumber,
  formatJerusalemDate,
  LEAD_MEASURE_LABELS,
  mentorLine,
  mentorOpeningLine,
  ON_TRACK_THRESHOLD,
  type BackwardPlan,
  type ConversionRatios,
  type GoalHorizon,
  type GoalUnit,
  type LeadMeasure,
  type MentorLine,
  type MentorMoment,
  type WeeklyCommitment,
  type WeeklyScore,
} from "@metavchim/shared";
import { apiDelete, apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { IconCheck, IconSparkle, IconTarget, IconBolt, IconPhone } from "../icons";
import { Notice } from "../notice";
import { GoalForm } from "./goal-form";
import { QuotesSection } from "./quotes-section";
import { TeamFeedback } from "./team-feedback";
import { WeeklyTrend, type WeekPoint } from "./weekly-trend";

/**
 * ‎**המנטור האישי.**
 *
 * ## למה זה לא עוד דוח
 *
 * ‏המערכת כבר מלאה במספרים. מה שלא היה בה הוא מישהו שאומר משפט
 * אחד: „נשארו לך שלוש שיחות והשבוע סגור”. לכן הכרטיס הראשון במסך
 * אינו טבלה אלא **משפט**, והמספרים יושבים מתחתיו — לא להפך.
 *
 * ## ארבע רמות, ולמה כולן במסך אחד
 *
 * ‏יעד שנתי בלי שבוע הוא משאלה; שבוע בלי יעד שנתי הוא רשימת מטלות.
 * הערך נמצא בקו שמחבר ביניהם — „ארבעים שיחות השבוע” הוא מספר שנגזר
 * מ„חצי מיליון השנה”, וזה מה שהחישוב לאחור מראה במפורש.
 *
 * ## מה המסך **לא** מבקש
 *
 * ‎**דיווח.** ארבעת המדדים נספרים מהמערכת: שיחות יוצאות מהמרכזייה,
 * פגישות ביומן, הצעות שנשלחו, נכסים שנקלטו. הדבר היחיד שהמתווך
 * מזין הוא היעד. אפליקציית יעדים מבקשת „סמן שעשית”; מנטור כבר יודע.
 */

interface GoalDto {
  horizon: GoalHorizon;
  unit: GoalUnit;
  target: number;
  averageCommissionAgorot?: number;
  ratios: ConversionRatios;
  commitment: WeeklyCommitment;
  obstacle?: string;
  ifThenPlan?: string;
  periodStart: string;
  periodEnd: string;
}

interface Comparison {
  measure: LeadMeasure;
  current: number;
  previous: number;
  changePercent: number | null;
  direction: "up" | "down" | "same";
}

interface Overview {
  goals: GoalDto[];
  plan: BackwardPlan | null;
  suggested: { horizon: GoalHorizon; target: number }[];
  week: {
    weekKey: string;
    weekday: number;
    committed: WeeklyCommitment;
    actual: Partial<Record<LeadMeasure, number>>;
    score: WeeklyScore;
    previousPercent?: number;
  };
  moments: MentorMoment[];
  weekOverWeek: Comparison[];
  cycleOverCycle: Comparison[];
  weeklyTrend: WeekPoint[];
  derivedRatios: ConversionRatios | null;
  usingDefaultRatios: boolean;
  unattributedCalls: number;
}

/**
 * ‏‎`YYYY-MM-DD` ⇒ „01.01.2026”.
 *
 * ‏השרת מחזיר תווית יום בשעון ישראל, והיא נקראת כאן **כמחרוזת**
 * ולא כרגע בזמן: `new Date("2026-01-01")` הוא חצות UTC, ובאזור זמן
 * שמערבה לו הוא מוצג כ-31 בדצמבר. חצות בצהריים מרחיקה מכל גבול יום.
 */
function dayLabel(iso: string): string {
  return formatJerusalemDate(new Date(`${iso}T12:00:00.000Z`));
}

/** ‏אגורות ⇒ „‎₪512,000”. שקלים שלמים: אגורות ביעד שנתי הן רעש. */
function money(agorot: number): string {
  return `₪${formatIsraeliNumber(Math.round(agorot / 100))}`;
}

/*
 * ‏השם מגיע מ-`GOAL_UNIT_LABELS` המשותפת ולא משלישייה מקומית: ברגע
 * שנוספו יעדי פעילות, „אם עסקאות אחרת בלעדיות” היה מציג יעד של
 * 1,000 שיחות בתור „1,000 בלעדיות”.
 */
function goalText(goal: GoalDto): string {
  if (goal.unit === "commission") return money(goal.target);
  return `${formatIsraeliNumber(goal.target)} ${GOAL_UNIT_LABELS[goal.unit]}`;
}

/**
 * ‏כמה עמודות לפי כמה משבצות נשארו. יעד פעילות מייצר משבצת אחת,
 * ורשת של ארבע הייתה משאירה אותה לבד עם שלושה רבעים ריקים.
 */
const PLAN_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

/** ‏הטון של המנטור ⇒ צבע הדומיין. אחד לכרטיס, כמו בכל המערכת. */
const TONE_DOMAIN: Record<MentorLine["tone"], string> = {
  celebrate: "mv-domain-green",
  push: "mv-domain-amber",
  steady: "mv-domain-blue",
  ask: "mv-domain-violet",
};

export default function MentorPage(): React.JSX.Element | null {
  const { loading } = useRequireAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GoalHorizon | null>(null);

  /*
   * ‎**הכפתור נראה שבור, והוא לא היה — הטופס נפתח מחוץ למסך.**
   *
   * ‏„קביעת יעד לשבוע” בכרטיס העליון קבע `editing`, והטופס עצמו
   * מוצג ברשימת היעדים שהרבה מתחת לקיפול. מבחינת מי שלחץ, הלחיצה
   * לא עשתה כלום — וזה גרוע מכפתור שמושבת, כי הוא מלמד שהמסך לא
   * מגיב. אחרי שהטופס נרנדר אנחנו גוללים אליו וממקדים בשדה הראשון,
   * כך שכל כפתור „קביעת יעד” במסך מוביל לאותו מקום גלוי.
   */
  useEffect(() => {
    if (editing === null) return;
    const node = document.getElementById(`goal-${editing}`);
    if (node === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    node.querySelector<HTMLElement>("select, input")?.focus({ preventScroll: true });
  }, [editing]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await apiGet<Overview>("/mentor/overview"));
      setError(null);
    } catch {
      setError("לא הצלחתי לטעון את המנטור");
    }
  }, []);

  useEffect(() => {
    if (!loading) void load();
  }, [loading, load]);

  if (loading) return null;

  if (error !== null) {
    return (
      <div className="mv-page">
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mv-page">
        <p aria-live="polite">טוען את המנטור…</p>
      </div>
    );
  }

  const byHorizon = new Map(data.goals.map((g) => [g.horizon, g]));
  const yearGoal = byHorizon.get("year");
  const weekGoal = byHorizon.get("week");

  /*
   * ‎**משפט אחד, וזה מה שנקרא.** כשיש רגע — הוא מנצח. כשאין —
   * פתיחה שמציעה את הצעד הבא, ולא „אין נתונים”.
   */
  const first = data.moments[0];
  const line =
    first === undefined
      ? mentorOpeningLine(yearGoal !== undefined, weekGoal !== undefined)
      : mentorLine(first);

  const suggestedFor = new Map(data.suggested.map((s) => [s.horizon, s.target]));

  const plan = data.plan;
  const planRows: { label: string; value: number | null }[] =
    plan === null
      ? []
      : [
          { label: "עסקאות בשנה", value: plan.dealsPerYear },
          { label: "הצעות בשנה", value: plan.offersPerYear },
          { label: "לידים בשבוע", value: plan.leadsPerWeek },
          { label: "פגישות בשבוע", value: plan.appointmentsPerWeek },
          { label: "שיחות ביום עבודה", value: plan.callsPerWorkday },
        ];
  const planCells = planRows.flatMap((cell) =>
    cell.value === null ? [] : [{ label: cell.label, value: cell.value }],
  );

  return (
    <div className="mv-page">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-extrabold">המנטור האישי שלך</h1>
        {/*
           ‏הכפתור מוביל אל תחתית המסך ולא פותח משהו: משפט מעורר
           השראה בראש העמוד היה הדבר הראשון שנקרא, במקום המספרים.
           מי שמחפש חיזוק יודע לחפש אותו — ובשבילו הכפתור כאן.
        */}
        <button
          type="button"
          className="mv-btn-plain"
          onClick={() => {
            const node = document.getElementById("mentor-quotes");
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            node?.scrollIntoView({
              behavior: reduced ? "auto" : "smooth",
              block: "start",
            });
          }}
        >
          משפטי מוטבציה
        </button>
      </div>
      <p
        className="m-0 mb-4 text-[length:var(--type-caption-lg)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        היעדים שלך, ומה שבאמת קרה השבוע — נספר מהמערכת, בלי שתדווח כלום.
      </p>

      {/* ================= המשפט ================= */}
      <section
        className={`mv-card mv-card--pad mb-[18px] ${TONE_DOMAIN[line.tone]}`}
        style={{ background: "var(--d-bg)", borderColor: "var(--d-line)" }}
        aria-labelledby="mentor-line-heading"
      >
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44" aria-hidden="true">
            <IconSparkle s={20} />
          </span>
          <h2 id="mentor-line-heading" className="mv-card-head__title">
            {line.title}
          </h2>
        </div>
        <p className="m-0 text-[length:var(--type-body)] leading-relaxed">{line.body}</p>
        {/*
           ‏הכרטיס הפותח *שואל* — „כמה אתה רוצה להרוויח השנה?” — ולא
           היה בו במה לענות. שאלה בלי כפתור היא כותרת, לא התחלה.
           הכפתור מופיע רק כשבאמת חסר יעד, כדי שלא יהפוך לרעש קבוע.
        */}
        {yearGoal !== undefined && weekGoal !== undefined ? null : (
          <button
            type="button"
            className="mv-btn-action mt-3"
            onClick={() => setEditing(yearGoal === undefined ? "year" : "week")}
          >
            <IconTarget s={15} />{" "}
            {yearGoal === undefined ? "קביעת היעד השנתי" : "קביעת יעד לשבוע"}
          </button>
        )}
        {weekGoal?.ifThenPlan === undefined || first?.kind !== "midweek_behind" ? null : (
          /*
             ‏תוכנית „אם-אז” מוחזרת אליו **ברגע שהיא רלוונטית** ולא
             כשהוא כתב אותה. זו כל הנקודה שלה.
          */
          <p
            className="m-0 mt-3 rounded-lg px-3 py-2 text-[length:var(--type-caption-lg)] font-bold"
            /* ‏טוקן מפורש ולא `--d-fg`: הוא נגזר ממחלקת הדומיין שעל
               הכרטיס, ושער הניגודיות אינו יודע לפתור אותו כאן —
               כלומר הצמד לא היה **נמדד**, לא „עובר”. */
            style={{ background: "var(--color-surface)", color: "var(--color-text)" }}
          >
            מה שכתבת לעצמך: {weekGoal.ifThenPlan}
          </p>
        )}
      </section>

      {/* ================= השבוע ================= */}
      <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="week-heading">
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44 mv-domain-green" aria-hidden="true">
            <IconBolt s={20} />
          </span>
          <h2 id="week-heading" className="mv-card-head__title">
            השבוע שלך
          </h2>
          <span
            className="mv-card-head__link"
            style={{ color: data.week.score.onTrack ? "var(--domain-green-fg)" : "var(--color-text-muted)" }}
          >
            {data.week.score.lines.length === 0 ? "טרם נקבע" : `${data.week.score.percent}% ביצוע`}
          </span>
        </div>

        {data.week.score.lines.length === 0 ? (
          <div>
            <p className="m-0 text-[length:var(--type-body)]">
              עוד לא קבעת מה אתה לוקח על עצמך השבוע. בלי זה אני יכול לספור,
              אבל אין למה להשוות.
            </p>
            <button type="button" className="mv-btn-action mt-3" onClick={() => setEditing("week")}>
              <IconTarget s={15} /> קביעת יעד לשבוע
            </button>
          </div>
        ) : (
          <>
            {/*
              ‎**סרגל ולא טבעת.** הסף הוא 85%, וסימון סף על סרגל הוא
              קו — על טבעת הוא זווית שאיש אינו מודד בעין.
            */}
            <div
              className="relative h-3 w-full overflow-hidden rounded-full"
              style={{ background: "var(--color-field)" }}
              role="img"
              aria-label={`ביצוע ${data.week.score.percent} אחוז מתוך יעד השבוע, הסף הוא ${ON_TRACK_THRESHOLD} אחוז`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${data.week.score.percent}%`,
                  background: data.week.score.onTrack
                    ? "var(--domain-green-fg)"
                    : "var(--domain-amber-fg)",
                }}
              />
              <span
                className="absolute top-0 h-full"
                style={{
                  insetInlineStart: `${ON_TRACK_THRESHOLD}%`,
                  width: 2,
                  background: "var(--color-text)",
                  opacity: 0.45,
                }}
              />
            </div>
            <p
              className="m-0 mt-1.5 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              הקו הוא {ON_TRACK_THRESHOLD}% — הסף שמנבא עמידה ביעד. מודדים
              ביצוע ולא תוצאה, כי על התוצאה אי אפשר להשפיע השבוע.
            </p>

            <ul className="mt-3 grid list-none gap-2 p-0 sm:grid-cols-2">
              {data.week.score.lines.map((row) => (
                <li
                  key={row.measure}
                  className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
                  style={{ borderColor: "var(--color-input-border)" }}
                >
                  <span className="font-bold">{LEAD_MEASURE_LABELS[row.measure]}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="text-[length:var(--type-metric)] font-extrabold"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {row.actual}
                      <span
                        className="text-[length:var(--type-caption-lg)] font-bold"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {" / "}
                        {row.committed}
                      </span>
                    </span>
                    {row.remaining === 0 ? (
                      <span style={{ color: "var(--domain-green-fg)" }} aria-label="הושלם">
                        <IconCheck s={16} />
                      </span>
                    ) : (
                      <span
                        className="text-[length:var(--type-caption)] font-bold"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        עוד {row.remaining}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {/*
              ‎**כשהספירה חלקית, אומרים את זה.**

              ‏המרכזייה אינה מדווחת איזו שלוחה חייגה, ושיחה יוצאת
              שאינה קשורה לליד נשארת בלי עוגן לאדם. בלי המשפט הזה
              המסך היה מציג „3 / 40” לסוכן שהתקשר ארבעים פעם, והוא
              היה מסיק שלא עבד — כלומר המנטור היה מאשים אותו במגבלה
              של האינטגרציה.
            */}
            {data.unattributedCalls === 0 ? null : (
              <p
                className="m-0 mt-3 rounded-lg px-3 py-2 text-[length:var(--type-caption-lg)]"
                style={{
                  background: "var(--color-field)",
                  color: "var(--color-text-muted)",
                }}
              >
                ‏{formatIsraeliNumber(data.unattributedCalls)} שיחות יוצאות מהמרכזייה
                השבוע לא שויכו לאף סוכן — המרכזייה אינה מדווחת מי חייג. ייתכן
                שספרתי לך פחות ממה שעשית.
              </p>
            )}
            <button type="button" className="mv-btn-plain mt-3" onClick={() => setEditing("week")}>
              שינוי היעד השבועי
            </button>
          </>
        )}
      </section>

      {/* ================= החישוב לאחור ================= */}
      {data.plan === null || data.plan.incomplete ? null : (
        <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="plan-heading">
          <div className="mv-card-head">
            <span className="mv-tile mv-tile--44 mv-domain-blue" aria-hidden="true">
              <IconPhone s={20} />
            </span>
            <h2 id="plan-heading" className="mv-card-head__title">
              מה זה אומר על מחר בבוקר
            </h2>
          </div>
          <p className="m-0 mb-3 text-[length:var(--type-body)]">
            כדי להגיע ל־{yearGoal === undefined ? "היעד" : goalText(yearGoal)} השנה:
          </p>
          {/*
             ‎`null` אינו אפס. יעד פעילות („1,000 שיחות השנה”) יודע את
             שורת השיחות ואינו יודע כמה עסקאות ייסגרו ממנה — ו„0
             עסקאות” לצידה היה אומר למתווך שהתוכנית שלו לא מובילה
             לכלום. שורה שלא חושבה פשוט אינה מוצגת, ומספר העמודות
             נגזר ממה שנשאר כדי שלא תיווצר משבצת בודדת בשורה של ארבע.
          */}
          <div className={`grid gap-2 ${PLAN_COLUMNS[planCells.length] ?? "sm:grid-cols-4"}`}>
            {planCells.map((cell) => (
              <div
                key={cell.label}
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: "var(--color-input-border)" }}
              >
                <div
                  className="text-[length:var(--type-counter)] font-extrabold leading-none"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatIsraeliNumber(cell.value)}
                </div>
                <div
                  className="mt-1 text-[length:var(--type-caption)] font-bold"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {cell.label}
                </div>
              </div>
            ))}
          </div>
          {/*
             ‏ההערה על יחסי ההמרה נאמרת רק כשהם באמת שימשו. יעד
             פעילות אינו עובר במשפך כלל, ו„החשבון על יחסי המרה
             ממוצעים בענף” מתחת ל„4 שיחות ביום עבודה” שנוצרו מחלוקה
             ב-260 הוא בדיוק סוג השקר השקט שהמנטור הזה נמנע ממנו.
          */}
          <p
            className="m-0 mt-2 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {plan !== null && plan.dealsPerYear === null
              ? "היעד הזה הוא פעולה שאתה שולט בה, ולכן אין כאן חישוב המרה — רק חלוקה על ימי העבודה בשנה."
              : data.usingDefaultRatios
                ? "החשבון על יחסי המרה ממוצעים בענף — עוד מחזור של עבודה, ואחליף אותם ביחסים שלך."
                : "החשבון על יחסי ההמרה שלך, מהמחזור האחרון. לא ממוצע של מישהו אחר."}
          </p>
        </section>
      )}

      {/* ================= ארבע הרמות ================= */}
      <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="goals-heading">
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44 mv-domain-violet" aria-hidden="true">
            <IconTarget s={20} />
          </span>
          <h2 id="goals-heading" className="mv-card-head__title">
            היעדים שלך
          </h2>
        </div>
        <p
          className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          המטרה הגדולה, והחלקים שבתוכה. כל רמה היא חלוקה של זו שמעליה —
          והשבוע הוא היחיד שאפשר לפעול לפיו היום.
        </p>

        <ul className="grid list-none gap-2 p-0">
          {GOAL_HORIZONS.map((horizon) => {
            const goal = byHorizon.get(horizon);
            const hint = suggestedFor.get(horizon);
            return (
              <li
                key={horizon}
                id={`goal-${horizon}`}
                className="rounded-xl border p-3"
                style={{ borderColor: "var(--color-input-border)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-extrabold">{GOAL_HORIZON_LABELS[horizon]}</div>
                    <div
                      className="text-[length:var(--type-caption)]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {goal === undefined
                        ? hint === undefined
                          ? "עוד לא נקבע"
                          : `לפי היעד השנתי: ${
                              yearGoal?.unit === "commission"
                                ? money(hint)
                                : formatIsraeliNumber(hint)
                            }`
                        : `${dayLabel(goal.periodStart)} — ${dayLabel(goal.periodEnd)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {goal === undefined ? null : (
                      <span
                        className="text-[length:var(--type-metric)] font-extrabold"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {goalText(goal)}
                      </span>
                    )}
                    <button
                      type="button"
                      className={goal === undefined ? "mv-btn-action" : "mv-btn-plain"}
                      onClick={() => setEditing(editing === horizon ? null : horizon)}
                    >
                      {goal === undefined ? "קביעת יעד" : "שינוי"}
                    </button>
                    {goal === undefined ? null : (
                      <button
                        type="button"
                        className="mv-btn-plain"
                        onClick={() => {
                          void apiDelete(`/mentor/goals/${horizon}`).then(load);
                        }}
                      >
                        מחיקה
                      </button>
                    )}
                  </div>
                </div>
                {goal?.obstacle === undefined ? null : (
                  <p
                    className="m-0 mt-2 text-[length:var(--type-caption-lg)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    מה שעוצר: {goal.obstacle}
                  </p>
                )}
                {editing !== horizon ? null : (
                  <GoalForm
                    horizon={horizon}
                    {...(goal === undefined ? {} : { initial: goal })}
                    onSaved={() => {
                      setEditing(null);
                      void load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/*
         ‏הצוות יושב מעל הגרף האישי ומתחת לשבוע שלו: מנהל שנכנס
         מחפש קודם את עצמו, ומיד אחר כך את מי שמחכה למילה ממנו.
         הקטע כולו נעלם אצל מי שאינו מנהל — הוא מחזיר רשימה ריקה.
      */}
      <TeamFeedback />

      {/* ================= השרשרת ================= */}
      <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="trend-heading">
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44 mv-domain-green" aria-hidden="true">
            <IconBolt s={20} />
          </span>
          <h2 id="trend-heading" className="mv-card-head__title">
            השרשרת שלך
          </h2>
        </div>
        <p
          className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          שלושה-עשר שבועות, וכמה מכל התחייבות באמת נעשה. לא כדי לשפוט —
          כדי שתראה שזה מצטבר.
        </p>
        <WeeklyTrend weeks={data.weeklyTrend} />
      </section>

      {/* ================= איפה היית ================= */}
      <section className="mv-card mv-card--pad" aria-labelledby="progress-heading">
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44 mv-domain-peach" aria-hidden="true">
            <IconSparkle s={20} />
          </span>
          <h2 id="progress-heading" className="mv-card-head__title">
            איפה היית, ואיפה אתה
          </h2>
        </div>
        <p
          className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          שלושה-עשר השבועות האחרונים מול אלה שלפניהם. לא הרגשה — מה שבאמת
          עשית.
        </p>
        <ul className="grid list-none gap-2 p-0 sm:grid-cols-2">
          {data.cycleOverCycle.map((row) => (
            <li
              key={row.measure}
              className="rounded-xl border px-3 py-2.5"
              style={{ borderColor: "var(--color-input-border)" }}
            >
              <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{LEAD_MEASURE_LABELS[row.measure]}</span>
              <span className="flex items-baseline gap-2">
                <span
                  className="text-[length:var(--type-metric)] font-extrabold"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatIsraeliNumber(row.current)}
                </span>
                <span
                  className="text-[length:var(--type-caption)] font-bold"
                  style={{
                    color:
                      row.direction === "up"
                        ? "var(--domain-green-fg)"
                        : row.direction === "down"
                          ? "var(--color-text-muted)"
                          : "var(--color-text-muted)",
                  }}
                >
                  {/*
                    ‎**„התחלת” ולא „עלייה של 100%”.** מי שעשה אפס
                    ואז שלוש לא השתפר באחוזים — הוא התחיל, וזה משפט
                    אחר לגמרי.
                  */}
                  {row.previous === 0
                    ? row.current === 0
                      ? "עוד לא התחלת"
                      : "התחלת"
                    : row.changePercent === null
                      ? ""
                      : `${row.changePercent > 0 ? "+" : ""}${row.changePercent}% מול ${row.previous}`}
                </span>
              </span>
              </div>
              {/*
                 ‎**שני פסים על אותו סולם — זה כל מה שההשוואה צריכה.**
                 המספרים כבר כתובים למעלה; מה שחסר היה לראות את ההפרש
                 בלי לחשב אותו. הסולם הוא הגדול מבין השניים, ולכן
                 הפס הארוך הוא תמיד התקופה החזקה — ולא „100%” לשתיהן.
              */}
              {row.current === 0 && row.previous === 0 ? null : (
                <div
                  className="mt-2 grid gap-1"
                  aria-hidden="true"
                >
                  {(
                    [
                      { key: "now", value: row.current, tone: "var(--domain-green-fg)" },
                      { key: "was", value: row.previous, tone: "var(--color-input-border)" },
                    ] as const
                  ).map((bar) => (
                    <div key={bar.key} className="flex items-center gap-2">
                      <span
                        className="text-[length:var(--type-caption)]"
                        style={{ color: "var(--color-text-muted)", minWidth: "3.2em" }}
                      >
                        {bar.key === "now" ? "עכשיו" : "קודם"}
                      </span>
                      <span
                        className="h-2 flex-1 overflow-hidden rounded-full"
                        style={{ background: "var(--color-field)" }}
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.round(
                              (bar.value / Math.max(row.current, row.previous, 1)) * 100,
                            )}%`,
                            background: bar.tone,
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <QuotesSection />
    </div>
  );
}
