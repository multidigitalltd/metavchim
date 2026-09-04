import {
  MENTOR_METRICS,
  mentorGoalLabel,
  mentorQuantity,
  type MentorGoalProgress,
  type MentorReview,
} from "./mentor.js";

/**
 * השיחה עם המנטור — הפרומפט, הסכמה, והתשובה כשאין מודל (docs/13 §7).
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
  /** מהישן לחדש */
  history: { role: "user" | "mentor"; text: string }[];
  question: string;
}

/** מה המודל מחזיר — משפט אחד או שניים, בעברית. */
export const MENTOR_REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "התשובה למתווך, בעברית, בפנייה ברבים",
    },
  },
  required: ["reply"],
};

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
 * הפרומפט. הכללים כתובים למודל באותן מילים שכתובות למפתח ב-docs/13
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
    "7. אינכם מבצעים פעולות ואינכם קובעים יעדים בעצמכם — מציעים, והמתווך קובע במסך.",
    "8. פנייה ברבים („אתם”). עברית טבעית, קצרה: משפט עד שלושה. בלי כותרות, בלי רשימות ארוכות, בלי אימוג'י.",
    "9. אם השאלה אינה קשורה לעבודת התיווך או ליעדים — עונים בקצרה שזה מחוץ לתחום המנטור.",
    "",
    `עכשיו: ${ctx.nowText}.`,
    ctx.firstName === "" ? "" : `שם המתווך/ת: ${ctx.firstName}.`,
    "",
    "היעדים והמצב:",
    goalsBlock(ctx.goals),
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
  const unavailable = "השיחה החופשית אינה זמינה כרגע, אבל זה מה שאני יודע:";
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
    return `${unavailable} ${status}.${focus}`;
  }
  if (ctx.lastReview !== null) {
    return `${unavailable} בסיכום האחרון — „${ctx.lastReview.headline}”. ${ctx.lastReview.paragraphs[0] ?? ""}`.trim();
  }
  return `${unavailable} עדיין אין יעדים. קבעו יעד אחד למסך — ומשם נתחיל.`;
}
