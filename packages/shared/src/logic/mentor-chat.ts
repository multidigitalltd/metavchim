import {
  MENTOR_GOAL_METRICS,
  MENTOR_GOAL_PERIODS,
  MENTOR_GOAL_TARGET_MAX,
  MENTOR_METRICS,
  mentorGoalLabel,
  type MentorGoalMetric,
  type MentorGoalPeriod,
  mentorInsightSentences,
  type MentorActivity,
  type MentorInsights,
  mentorPatternLine,
  mentorQuantity,
  type MentorGoalProgress,
  type MentorPattern,
  type MentorReview,
} from "./mentor.js";
import { mentorAdviceBlock, type MentorAdvice } from "./mentor-advice.js";
import {
  officePlaybookBlock,
  type MentorOfficePlaybook,
} from "./mentor-office.js";
import {
  DEFAULT_MENTOR_PERSONA,
  mentorNameLine,
  mentorStyleGuidance,
  type MentorPersona,
} from "./mentor-persona.js";

/**
 * השיחה עם המנטור — הפרומפט, הסכמה, והתשובה כשאין מודל (docs/14 §7).
 *
 * ## מה המודל מקבל, ומה לא
 *
 * ההקשר הוא של המנטור בלבד: יעדים עם מצבם, הסיכום האחרון, מה
 * שהמתווך ענה לשאלת הרפלקציה, והתורים האחרונים. **אין כאן כרטיסי
 * לקוחות, שמות או טלפונים** — שאלה על ליד ספציפי מופנית לסוכן
 * האישי, שמחזיק את ההרשאות לזה. ואין נתוני עמיתים, ולכן המודל
 * אינו יכול לענות „איך אני מול דני” גם אם יישאל.
 *
 * ## למה יש תשובת גיבוי דטרמיניסטית
 *
 * בלי מפתח, בתקלה או בזמן קצוב, המסך לא מציג „לא זמין” ותו לא:
 * המנטור עדיין יודע לומר איפה עומדים — מהיעדים ומהסיכום, שאינם
 * תלויים במודל. זה פחות מהשיחה, והרבה יותר מקיר.
 */

export interface MentorChatContext {
  /** שם פרטי, לפנייה — או ריק */
  firstName: string;
  nowText: string;
  goals: MentorGoalProgress[];
  lastReview:
    | (MentorReview & {
        weekLabel: string;
        reflectionAnswer: string | null;
        plan?: string | null;
      })
    | null;
  /** מהירות המענה ושיחות שלא חזרת אליהן — השבוע */
  insights?: MentorInsights;
  /** דפוסים מהסיכומים הקודמים — הזיכרון הארוך */
  patterns?: MentorPattern[];
  /**
   * מה שהמנטור צריך כדי לייעץ (docs/14 §7.1): הפעילות השבוע ומול שבוע
   * שעבר, המשפך של המתווך, והניתוח שכבר נעשה בקוד (`mentorAdvice`).
   * חסר = השיחה עונה מהיעדים ומהסיכום בלבד.
   */
  activity?: MentorActivity;
  previousActivity?: MentorActivity | null;
  funnel?: { history: MentorActivity; weeks: number } | null;
  advice?: MentorAdvice[];
  /** השם והסגנון שהמתווך בחר — הטון של התשובה (docs/14 §4.1) */
  persona?: MentorPersona;
  /** התרגול האחרון — מה לנסות בשיחה האמיתית (§7.3); חסר = לא תרגל */
  lastPractice?: {
    scenarioLabel: string;
    score: number;
    tryNext: string;
  } | null;
  /** מה הוכיח את עצמו במשרד — ידע משותף, ספירות בלבד (§7.4) */
  office?: MentorOfficePlaybook;
  /** מהישן לחדש */
  history: { role: "user" | "mentor"; text: string }[];
  question: string;
}

/**
 * יעד שהמנטור מציע לקבוע — **הצעה, לא פעולה** (docs/14 §7): המודל
 * ממלא אותה כשהמתווך ביקש יעד במפורש, המסך מציג כפתור „לקבוע יעד”,
 * והמתווך הוא שלוחץ. הקוד כותב. אותו כלל כמו בסוכן: המודל מציע,
 * הקוד מכריע.
 */
export interface MentorGoalProposal {
  metric: MentorGoalMetric;
  target: number;
  period: MentorGoalPeriod;
}

/** מה המודל מחזיר — משפט אחד או שניים, בעברית; ויעד מוצע כשהתבקש. */
export const MENTOR_REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "התשובה למתווך, בעברית, בפנייה אישית בגוף שני יחיד",
    },
    proposedGoal: {
      type: "object",
      description:
        "רק כשהמתווך ביקש במפורש לקבוע יעד (או אישר יעד שהצעתם): היעד לקביעה בלחיצה. אחרת — להשמיט.",
      properties: {
        metric: { type: "string", enum: [...MENTOR_GOAL_METRICS] },
        target: { type: "integer" },
        period: { type: "string", enum: [...MENTOR_GOAL_PERIODS] },
      },
      required: ["metric", "target", "period"],
    },
  },
  required: ["reply"],
};

/* ---------- בקשת יעד — פענוח דטרמיניסטי ---------- */

/**
 * מילות המדד כפי שמתווך כותב אותן. הסדר חשוב: „שיחות נכנסות” לפני
 * „שיחות”, „תוך שעה” לפני „לידים” — הספציפי קודם.
 */
const METRIC_WORDS: readonly { metric: MentorGoalMetric; pattern: RegExp }[] = [
  { metric: "leads_answered_fast", pattern: /תוך שעה/u },
  { metric: "calls_answered", pattern: /שיח(ה|ות) נכנס(ת|ות)/u },
  { metric: "calls_made", pattern: /שיח(ה|ות)( יוצא(ת|ות))?/u },
  { metric: "owner_updates_sent", pattern: /עדכו(ן|נים)/u },
  { metric: "followups_done", pattern: /מעקב(ים)?/u },
  { metric: "offers_sent", pattern: /הצע(ה|ות)/u },
  { metric: "viewings_held", pattern: /סיור(ים)?/u },
  { metric: "leads_answered", pattern: /ליד(ים)?/u },
  { metric: "new_buyers", pattern: /קונ(ה|ים)/u },
  { metric: "new_properties", pattern: /נכס(ים)?/u },
  { metric: "deals_closed", pattern: /עסק(ה|אות)/u },
];

const HEBREW_NUMBERS: Readonly<Record<string, number>> = {
  אחד: 1,
  אחת: 1,
  שניים: 2,
  שתיים: 2,
  שני: 2,
  שתי: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
  עשרים: 20,
  שלושים: 30,
};

/**
 * „תקבע לי יעד”, „רוצה יעד”, „היעד שלי” — בקשה, לא שאלה על יעדים.
 *
 * מילים שלמות, עם גבול משלנו: ‎`\b` של JS מכיר אותיות לטיניות בלבד,
 * ו„קבע” כתת-מחרוזת היה תופס „שקבעתי” — ושאלה על יעד קיים („כמה
 * השגתי מהיעד שקבעתי?”) הייתה מקבלת כפתור שמחליף אותו (ביקורת Codex).
 */
const WORD_START = "(^|[\\s,:;.!?„”\"'(-])";
const WORD_END = "(?=$|[\\s,:;.!?„”\"')-])";
const GOAL_REQUEST = new RegExp(
  `${WORD_START}(תקבע|לקבוע|קבע|תגדיר|להגדיר|רוצה|היעד שלי|יעד חדש)${WORD_END}|^יעד[:\\s]`,
  "u",
);
/** שאלה — „כמה”, „מה”, „איך”, או סימן שאלה — אינה בקשה לקבוע. */
const QUESTION = /\?|^(כמה|מה|איך|למה|האם|מתי)(\s|$)/u;
const WEEK_WORDS = /(בשבוע|לשבוע|שבועי|שבועית|כל שבוע)/u;
const MONTH_WORDS = /(בחודש|לחודש|חודשי|חודשית|כל חודש|החודש)/u;
/** תקופה שאינה נתמכת — „ביום”, „בשנה” — נדחית, לא הופכת לשבוע בשקט. */
const OTHER_PERIOD = /(ביום|יומי|יומית|כל יום|בשנה|שנתי|לשנה|ברבעון|רבעוני)/u;

/**
 * „תקבע לי יעד של 5 הצעות בשבוע” ⟵ `{ offers_sent, 5, week }`.
 *
 * דטרמיניסטי — כדי שהכפתור יופיע גם בלי מודל, וכדי שמודל שהחזיר
 * תשובה בלי `proposedGoal` על בקשה מפורשת לא ישאיר את המתווך בלי
 * דרך. ‎`null` = לא בקשת יעד (שאלה, „כמה הצעות שלחתי?”), או שחסר
 * מספר או מדד. תקופה חסרה = שבוע; יעד של „עסקה” בלי מספר = 1.
 */
export function parseGoalRequest(text: string): MentorGoalProposal | null {
  const t = text.trim();
  if (QUESTION.test(t) || !GOAL_REQUEST.test(t)) return null;
  /*
   * בלי המילה „יעד” — רק כשיש תקופה מפורשת: „רוצה 3 סיורים בשבוע” הוא
   * יעד (וכך גם הפרומפט אומר למודל); „רוצה 3 סיורים” לבד הוא משאלה.
   */
  const explicitPeriod = WEEK_WORDS.test(t) || MONTH_WORDS.test(t);
  if (!/יעד/u.test(t) && !explicitPeriod) return null;
  if (OTHER_PERIOD.test(t) && !explicitPeriod) return null;
  const found = METRIC_WORDS.find((m) => m.pattern.test(t));
  if (found === undefined) return null;
  const digits = /(\d{1,3})/u.exec(t);
  let target = digits === null ? 0 : Number(digits[1]);
  if (target === 0) {
    const word = Object.keys(HEBREW_NUMBERS).find((w) =>
      new RegExp(`(^|\\s)${w}(\\s|$)`, "u").test(t),
    );
    if (word !== undefined) target = HEBREW_NUMBERS[word]!;
    // „יעד של עסקה בחודש” — יחיד בלי מספר הוא אחד. לא `\b`: גבול מילה
    // ב-JS הוא של אותיות לטיניות, ובעברית אינו נמצא לעולם
    else if (/(עסקה|נכס|סיור|הצעה|ליד|קונה|מעקב|עדכון)(\s|$|[.,!?:])/u.test(t))
      target = 1;
  }
  if (target < 1 || target > MENTOR_GOAL_TARGET_MAX) return null;
  // תקופה חסרה = שבוע; חודש כשנאמר; אחרת כבר נדחה למעלה
  const period: MentorGoalPeriod = MONTH_WORDS.test(t) ? "month" : "week";
  return { metric: found.metric, target, period };
}

const PACE_LABEL: Record<MentorGoalProgress["pace"], string> = {
  done: "הושג",
  ahead: "מעל הקצב",
  on_track: "בקצב",
  behind: "מאחור",
};

function goalsBlock(goals: MentorGoalProgress[]): string {
  if (goals.length === 0) return "אין יעדים פעילים.";
  return goals
    .map((g) => {
      const label = mentorGoalLabel(g.metric, g.target, g.period);
      const line = `- ${label}: ${mentorQuantity(g.metric, g.actual)} עד עכשיו — ${PACE_LABEL[g.pace]}`;
      const why =
        g.why === undefined || g.why.trim() === ""
          ? ""
          : ` · הלמה: „${g.why.trim()}”`;
      const intention =
        g.intention === undefined || g.intention.trim() === ""
          ? ""
          : ` · התוכנית: „${g.intention.trim()}”`;
      return `${line}${why}${intention}`;
    })
    .join("\n");
}

/**
 * הפרומפט. הכללים כתובים למודל באותן מילים שכתובות למפתח ב-docs/14
 * ‎§4 — כלל שיש לו שני ניסוחים מתפצל.
 */
export function buildMentorPrompt(ctx: MentorChatContext): string {
  const lines: string[] = [];
  lines.push(
    'אתם המנטור האישי של מתווך/ת נדל"ן במערכת „מתווכים”. תפקידכם ללוות, לא לדווח.',
    "כללים מחייבים:",
    "1. עובדה, לא שיפוט. אין „מעט”, „רק”, „חבל”. אומרים מה קרה ומה היעד.",
    "2. השוואה רק לעצמו — מול היעד שקבע ומול השבוע הקודם שלו. לעולם לא מול עמיתים; אין לכם נתוני עמיתים ואם שואלים — אומרים שהמנטור אינו משווה בין סוכנים.",
    "3. כל הצלחה נאמרת בשמה. ייחוס למאמץ ולתהליך, לא ליכולת.",
    "4. שבוע חלש מקבל תזכורת ליעד שהמתווך ביקש מעצמו, ושאלה אחת — לא הרצאה.",
    "5. יעדי תהליך לפני יעדי תוצאה: כשמבקשים לשפר תוצאה, מציעים פעולה שבשליטה (סיורים, הצעות, מענה ללידים).",
    "6. אין לכם גישה ללקוחות, לידים או נכסים ספציפיים. שאלה כזו — מפנים לסוכן האישי במסך „הסוכן”.",
    "7. אינכם מבצעים פעולות ואינכם קובעים יעדים בעצמכם. כשהמתווך מבקש במפורש לקבוע יעד („תקבע לי יעד של 5 הצעות בשבוע”, „רוצה 3 סיורים בשבוע”) או מאשר יעד שהצעתם — ממלאים proposedGoal (metric מהרשימה, target, period; שבוע כברירת מחדל) ואומרים במשפט שהיעד מוכן לקביעה בלחיצה על הכפתור שמתחת לתשובה. יעד שהמתווך רק שוקל או שואל עליו — בלי proposedGoal; אפשר להציע מספר, והמתווך יבקש.",
    `קודי המדדים ל-proposedGoal: ${MENTOR_METRICS.map((m) => `${m.code} = ${m.label}`).join(", ")}.`,
    "8. פנייה אישית וידידותית, בגוף שני יחיד — כמו מנטור שמכיר את המתווך, לא כמו טופס. פונים בשם הפרטי כשידוע. כדי לא לטעות במין: פעלים בעבר בגוף שני (סגרת, כתבת, עמדת — כתיבם זהה) וצורות „שלך” / „לך”; לא „אתה/את” ולא פועל בהווה או בעתיד בגוף שני. עברית טבעית, חמה וקצרה: משפט עד שלושה. בלי כותרות, בלי רשימות ארוכות, בלי אימוג'י.",
    "9. אם השאלה אינה קשורה לעבודת התיווך או ליעדים — עונים בקצרה שזה מחוץ לתחום המנטור.",
    "10. כשמבקשים עצה, רעיון, טיפ, „מה לשפר” או „מה לעשות” — נותנים רעיון אחד או שניים קונקרטיים לביצוע היום או השבוע, מתוך הניתוח ורעיונות ספר המשחק שלמטה, מותאמים למספרים של המתווך ובמילים של המנטור (לא ציטוט). אומרים גם למה דווקא זה, במשפט. עד ארבעה משפטים. רעיון שכבר ניתן בשיחה — לא לחזור עליו, לתת אחר.",
    "11. כששואלים על המשפך או על המרה — עונים מהמספרים של המתווך עצמו מול המקובל, ומצביעים על שלב אחד לשפר.",
    `12. ${mentorStyleGuidance((ctx.persona ?? DEFAULT_MENTOR_PERSONA).style)} הכללים 1–11 חלים בכל סגנון.`,
    mentorNameLine(ctx.persona ?? DEFAULT_MENTOR_PERSONA),
    "",
    `עכשיו: ${ctx.nowText}.`,
    ctx.firstName === "" ? "" : `שם המתווך/ת: ${ctx.firstName}.`,
    "",
    "היעדים והמצב:",
    goalsBlock(ctx.goals),
    ...mentorInsightSentences(ctx.insights),
  );
  if (ctx.lastReview !== null) {
    lines.push(
      "",
      `הסיכום השבועי האחרון (${ctx.lastReview.weekLabel}) — „${ctx.lastReview.headline}”:`,
      ...ctx.lastReview.paragraphs.map((p) => `- ${p}`),
    );
    if (ctx.lastReview.reflection !== null) {
      lines.push(`שאלת המנטור: ${ctx.lastReview.reflection}`);
      lines.push(
        ctx.lastReview.reflectionAnswer === null
          ? "המתווך טרם ענה."
          : `תשובת המתווך: „${ctx.lastReview.reflectionAnswer}”`,
      );
      if (ctx.lastReview.plan) {
        lines.push(
          `התוכנית שהמתווך קבע למקרה שזה יקרה שוב: „${ctx.lastReview.plan}”`,
        );
      }
    }
  }
  if (ctx.activity !== undefined) {
    lines.push(
      "",
      ...mentorAdviceBlock(
        {
          goals: ctx.goals,
          activity: ctx.activity,
          previousActivity: ctx.previousActivity ?? null,
          ...(ctx.insights === undefined ? {} : { insights: ctx.insights }),
          funnel: ctx.funnel ?? null,
          now: new Date(),
        },
        ctx.advice ?? [],
      ),
    );
  }
  if (ctx.lastPractice) {
    lines.push(
      "",
      `התרגול האחרון של המתווך (${ctx.lastPractice.scenarioLabel}, ציון ${ctx.lastPractice.score} מתוך 5). מה שהמנטור אמר לנסות בשיחה האמיתית: ${ctx.lastPractice.tryNext} — כשרלוונטי, אפשר לשאול אם ניסה.`,
    );
  }
  const officeLines = officePlaybookBlock(ctx.office);
  if (officeLines.length > 0) lines.push("", ...officeLines);
  if (ctx.patterns !== undefined && ctx.patterns.length > 0) {
    lines.push("", "מה שהמנטור זוכר מהחודשיים האחרונים (דפוסים מהסיכומים):");
    for (const pattern of ctx.patterns)
      lines.push(`- ${mentorPatternLine(pattern)}`);
  }
  if (ctx.history.length > 0) {
    lines.push("", "השיחה עד כה:");
    for (const turn of ctx.history) {
      lines.push(`${turn.role === "user" ? "המתווך" : "המנטור"}: ${turn.text}`);
    }
  }
  lines.push(
    "",
    `המתווך שואל עכשיו: „${ctx.question}”`,
    "",
    "ענו ב-JSON עם שדה reply בלבד.",
  );
  return lines
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

/**
 * תשובה בלי מודל — מהיעדים ומהסיכום. דטרמיניסטית ונבדקת.
 *
 * שלוש תשובות: מצב היעדים כשיש, הסיכום האחרון כשאין יעדים אבל יש
 * סיכום, והזמנה לקבוע יעד כשאין כלום. תמיד נאמר שהשיחה החופשית
 * אינה זמינה כרגע — לא מעמידים פנים.
 */
export function mentorFallbackReply(
  ctx: Omit<MentorChatContext, "question" | "history">,
): string {
  const hi = ctx.firstName === "" ? "" : `${ctx.firstName}, `;
  const unavailable = `${hi}השיחה החופשית אינה זמינה כרגע, אבל זה מה שאני יודע:`;
  // העצה הראשונה — גם בלי מודל המנטור אומר מה הכי שווה לעשות, ולמה
  const first = ctx.advice?.[0];
  const tip = first === undefined ? "" : ` ${first.title}. ${first.body}`;
  if (ctx.goals.length > 0) {
    const status = ctx.goals
      .map(
        (g) =>
          `${mentorGoalLabel(g.metric, g.target, g.period)} — ${mentorQuantity(g.metric, g.actual)}, ${PACE_LABEL[g.pace]}`,
      )
      .join(" · ");
    const behind = ctx.goals.find((g) => g.pace === "behind");
    const focus =
      behind === undefined
        ? ""
        : ` המיקוד עכשיו: ${MENTOR_METRICS.find((m) => m.code === behind.metric)?.label ?? behind.metric}.`;
    return `${unavailable} ${status}.${focus}${tip}`;
  }
  if (first !== undefined) return `${unavailable}${tip}`;
  if (ctx.lastReview !== null) {
    return `${unavailable} בסיכום האחרון — „${ctx.lastReview.headline}”. ${ctx.lastReview.paragraphs[0] ?? ""}`.trim();
  }
  return `${unavailable} עדיין אין לך יעדים. כדאי לקבוע יעד אחד במסך — ומשם נתחיל ביחד.`;
}
