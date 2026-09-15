import { jerusalemDayLabel } from "./israel-time.js";
import type { MentorGoalProposal } from "./mentor-chat.js";
import { mentorGoalLabel, type MentorGoalProgress } from "./mentor.js";

/**
 * 30 הימים הראשונים — הליווי של מתווך חדש (docs/14 §7.5).
 *
 * מתווך חדש מגיע בלי נתונים, ולמנטור אין על מה לדבר כמה שבועות —
 * בדיוק בתקופה שבה מחליטים אם המערכת שווה. התוכנית נותנת לכל שבוע
 * מיקוד אחד וצעד אחד, בסדר שבו מנטור בונה הרגל: יעד קטן אחד, ואז
 * שני, ואז תרגול, ואז יעד תוצאה — ובסוף החודש הסיכום החודשי הראשון.
 *
 * הלוגיקה טהורה: היום נספר בלוח הישראלי מיום ההצטרפות (יום ההצטרפות
 * הוא יום 1), והצעד נגזר ממה שכבר יש — מי שכבר קבע יעד אינו מתבקש
 * לקבוע אותו שוב.
 */

export const ONBOARDING_DAYS = 30;

export type OnboardingWeek = 1 | 2 | 3 | 4;

export interface MentorOnboardingStep {
  /** `goal` — יעד לקביעה בלחיצה; `practice` — לתרגול; `chat` — שאלה למנטור; `keep` — להמשיך */
  kind: "goal" | "practice" | "chat" | "keep";
  title: string;
  body: string;
  /** מה כתוב על הכפתור */
  cta: string;
  goal?: MentorGoalProposal;
  question?: string;
}

export interface MentorOnboarding {
  /** 1 עד 30 */
  day: number;
  week: OnboardingWeek;
  weekTitle: string;
  weekFocus: string;
  step: MentorOnboardingStep;
}

export interface OnboardingInput {
  userCreatedAt: Date;
  now: Date;
  goals: readonly MentorGoalProgress[];
  /** כמה תרגולי שיחה נגמרו מאז ההצטרפות */
  practices: number;
}

const WEEKS: Record<OnboardingWeek, { title: string; focus: string }> = {
  1: {
    title: "להכיר",
    focus: "יעד אחד קטן, ובוקר טוב כל יום. לא יותר מזה.",
  },
  2: {
    title: "להוסיף",
    focus:
      "יעד שני, על שלב אחר במשפך. הסיכום השבועי הראשון כבר מאחוריך — כדאי לענות למנטור על השאלה שלו.",
  },
  3: {
    title: "להתייצב",
    focus: "לשמור על הקצב, ולתרגל שיחה אחת לפני שהיא קורית.",
  },
  4: {
    title: "לסכם",
    focus: "יעד תוצאה לחודש, מתורגם לתהליך. הסיכום החודשי הראשון בדרך.",
  },
};

/** „2026-09-06” ⟵ מספר יום בלוח — בלי שעון המכשיר */
function dayNumber(label: string): number {
  const [y, m, d] = label.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** יום ההצטרפות הוא יום 1, בלוח הישראלי. */
export function onboardingDay(userCreatedAt: Date, now: Date): number {
  return (
    dayNumber(jerusalemDayLabel(now)) -
    dayNumber(jerusalemDayLabel(userCreatedAt)) +
    1
  );
}

const FIRST_GOAL: MentorGoalProposal = {
  metric: "offers_sent",
  target: 3,
  period: "week",
};

function firstGoalStep(): MentorOnboardingStep {
  return {
    kind: "goal",
    title: "היעד הראשון",
    body: "3 הצעות השבוע. מספר שאפשר לעשות ביום אחד — הנקודה היא ההרגל, לא המספר. מהרגע שיש יעד, הבוקר של המנטור אומר כל יום מה היום שווה.",
    cta: `לקבוע ${mentorGoalLabel(FIRST_GOAL.metric, FIRST_GOAL.target, FIRST_GOAL.period)}`,
    goal: FIRST_GOAL,
  };
}

function secondGoalStep(
  goals: readonly MentorGoalProgress[],
): MentorOnboardingStep {
  const hasOffers = goals.some((g) => g.metric === "offers_sent");
  const goal: MentorGoalProposal = hasOffers
    ? { metric: "viewings_held", target: 2, period: "week" }
    : FIRST_GOAL;
  return {
    kind: "goal",
    title: "היעד השני",
    body: hasOffers
      ? "2 סיורים בשבוע — שלב אחר במשפך. הצעות מביאות סיורים, סיורים מביאים עסקאות; שני יעדים על שני שלבים מראים איפה המשפך מאבד."
      : "3 הצעות בשבוע — השלב שבשליטה מלאה שלך. משם המשפך מתחיל.",
    cta: `לקבוע ${mentorGoalLabel(goal.metric, goal.target, goal.period)}`,
    goal,
  };
}

export function mentorOnboarding(
  input: OnboardingInput,
): MentorOnboarding | null {
  const day = onboardingDay(input.userCreatedAt, input.now);
  if (day < 1 || day > ONBOARDING_DAYS) return null;
  const week = Math.min(4, Math.ceil(day / 7)) as OnboardingWeek;
  const weekly = input.goals.filter((g) => g.period === "week");
  const monthly = input.goals.filter((g) => g.period === "month");

  let step: MentorOnboardingStep;
  if (week === 1) {
    step =
      weekly.length === 0
        ? firstGoalStep()
        : {
            kind: "chat",
            title: "יש יעד — עכשיו הבוקר",
            body: "היעד במקום. מכאן, בכל בוקר בין 08:00 ל-11:00 המנטור אומר כמה יש וכמה היום שווה. אפשר גם לשאול אותו עכשיו.",
            cta: "מה שווה לעשות היום?",
            question: "מה שווה לעשות היום?",
          };
  } else if (week === 2) {
    step =
      weekly.length === 0
        ? firstGoalStep()
        : weekly.length === 1
          ? secondGoalStep(weekly)
          : {
              kind: "chat",
              title: "שני יעדים במקום",
              body: "השבוע: לעמוד בשניהם. במוצאי שבת מגיע הסיכום — ואם המנטור שאל שאלה, התשובה שלך היא מה שהוא לומד ממנו.",
              cta: "מה המצב ביעדים שלי?",
              question: "מה המצב ביעדים שלי?",
            };
  } else if (week === 3) {
    step =
      input.practices === 0
        ? {
            kind: "practice",
            title: "לתרגל שיחה אחת",
            body: "מוכר על המחיר, או קונה שמתלבט — חמש דקות עם המנטור לפני שזה קורה באמת. בסוף הוא אומר מה עבד ומה לנסות.",
            cta: "לתרגל עכשיו",
          }
        : {
            kind: "chat",
            title: "מהתרגול לשיחה האמיתית",
            body: "תרגלת. השבוע: להשתמש במשפט שהמנטור אמר לנסות בשיחה אמיתית, ולסמן „עזר לי” על רעיון אחד מהבוקר — ככה הוא לומד מה עובד אצלך.",
            cta: "מה הרעיון להיום?",
            question: "תן לי רעיון להיום",
          };
  } else {
    step =
      monthly.length === 0
        ? {
            kind: "goal",
            title: "יעד תוצאה ראשון",
            body: "עסקה אחת החודש. במסך היעדים הכפתור „מה צריך לעשות בשבוע כדי להגיע לזה?” מתרגם אותה למספרים שבשליטה — לפי המשפך שלך מהחודש הזה.",
            cta: "לקבוע עסקה אחת בחודש",
            goal: { metric: "deals_closed", target: 1, period: "month" },
          }
        : {
            kind: "keep",
            title: "הסיכום החודשי הראשון בדרך",
            body: "מגיע ביום ראשון אחרי סוף החודש: מה עבד, מה לא, ואיזה רעיון באמת הזיז מספר. עד אז — אותם יעדים, אותו קצב.",
            cta: "להמשיך",
          };
  }
  const info = WEEKS[week];
  return { day, week, weekTitle: info.title, weekFocus: info.focus, step };
}

/** השורה לבוקר — ביום הראשון ובתחילת כל שבוע; `null` בשאר הימים. */
export function onboardingMorningLine(
  onboarding: MentorOnboarding | null | undefined,
): string | null {
  if (!onboarding) return null;
  if (onboarding.day === 1)
    return `היום הראשון שלנו ביחד. השבוע — ${onboarding.weekTitle}: ${onboarding.weekFocus}`;
  if ((onboarding.day - 1) % 7 === 0)
    return `יום ${onboarding.day} מתוך ${ONBOARDING_DAYS} — ${onboarding.weekTitle}: ${onboarding.weekFocus}`;
  return null;
}

/** הבלוק לפרומפט השיחה — המתווך חדש, ואיפה הוא בתוכנית. */
export function onboardingPromptLines(
  onboarding: MentorOnboarding | null | undefined,
): string[] {
  if (!onboarding) return [];
  return [
    `המתווך חדש במערכת — יום ${onboarding.day} מתוך ${ONBOARDING_DAYS} של הליווי הראשון. השבוע: ${onboarding.weekTitle} — ${onboarding.weekFocus} הצעד הנוכחי: ${onboarding.step.title} — ${onboarding.step.body} עדיין אין הרבה נתונים — לדבר על הצעד, לא על מספרים שאין.`,
  ];
}
