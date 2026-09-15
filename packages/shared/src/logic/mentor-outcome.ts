import { jerusalemWallIsoToUtc } from "./israel-time.js";
import type { MentorActivity, MentorGoalMetric } from "./mentor.js";
import { ideaByKey, type MentorIdeaMark } from "./mentor-playbook.js";

/**
 * האם הרעיון באמת עבד — המדידה שמאחורי „עזר לי” (docs/14 §7.2).
 *
 * „עזר לי” הוא תחושה; המנטור בודק גם את המספר. רעיון להצעות שסומן
 * ב-3.9 נמדד על **המדד של הרעיון**: כמה הצעות היו בשבעת הימים
 * מיום הסימון (כולל), מול שבעת הימים שלפניו. השוואה של המתווך לעצמו,
 * לא לאחרים, ועל חלון קצר בכוונה — מה שזז אחרי שבוע הוא מה שהרעיון
 * הזיז; אחרי חודש כבר קרו עוד דברים.
 *
 * הלוגיקה כאן טהורה: חלונות, מי בשל למדידה, והשוואה. הספירה עצמה
 * היא של ה-API (`MentorSignalsService.activity`), והמשפט — ב-`mentor.ts`
 * לצד הסיכום.
 */

/** כמה ימים אחרי הסימון נמדדים — שבוע, כולל יום הסימון. */
export const IDEA_OUTCOME_DAYS = 7;

export interface MentorIdeaOutcome {
  key: string;
  metric: MentorGoalMetric;
  /** הרעיון במילים — כדי שהמשפט יזכיר על מה מדובר */
  text: string;
  /** יום הסימון — „2026-09-03” */
  date: string;
  /** המדד בשבוע שלפני הסימון */
  before: number;
  /** המדד בשבוע מהסימון */
  after: number;
  change: "up" | "flat" | "down";
}

interface Range {
  start: Date;
  end: Date;
}

const DAY_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** „2026-09-03” + 7 ⟵ „2026-09-10”, בלוח בלבד — בלי שעון המכשיר. */
export function shiftDayLabel(label: string, days: number): string {
  const match = DAY_LABEL.exec(label);
  if (match === null) return label;
  const at = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return at.toISOString().slice(0, 10);
}

/**
 * חלונות המדידה של סימון: „אחרי” — מחצות ישראל של יום הסימון, שבעה
 * ימים; „לפני” — שבעת הימים שקדמו לו. שניהם בגבולות UTC לשאילתה.
 */
export function ideaOutcomeWindows(mark: MentorIdeaMark): {
  before: Range;
  after: Range;
} {
  const midnight = (label: string): Date =>
    jerusalemWallIsoToUtc(`${label}T00:00:00.000`);
  const start = midnight(mark.date);
  return {
    before: {
      start: midnight(shiftDayLabel(mark.date, -IDEA_OUTCOME_DAYS)),
      end: start,
    },
    after: {
      start,
      end: midnight(shiftDayLabel(mark.date, IDEA_OUTCOME_DAYS)),
    },
  };
}

/**
 * הסימונים שבשלים למדידה בטווח: „עזר לי” שחלון ה„אחרי” שלו נסגר
 * בתוך הטווח — מתחילתו (ועד בכלל) ועד סופו (לא ועד בכלל). הסיכום
 * השבועי קורא עם השבוע שהסתיים — וכך כל סימון נמדד **פעם אחת**, בשבוע
 * שאחרי זה שסומן בו.
 *
 * הגבול העליון פתוח בכוונה: סימון של יום ראשון נסגר בדיוק בסוף אותו
 * שבוע, אבל הסיכום נכתב במוצאי שבת 20:00 — ארבע שעות לפני שהחלון
 * נסגר. מדידה אז הייתה מחסירה את הערב האחרון לתמיד (ביקורת Codex);
 * הוא נמדד בשבוע הבא, כשהחלון סגור כולו.
 *
 * אותו רעיון שסומן פעמיים באותו יום — הסימון האחרון קובע; „עזר לי”
 * ואחריו „לא בשבילי” באותו יום אינו נמדד.
 */
export function ideaMarksDue(
  marks: readonly MentorIdeaMark[],
  range: Range,
): MentorIdeaMark[] {
  const last = new Map<string, MentorIdeaMark>();
  for (const mark of marks) last.set(`${mark.key}@${mark.date}`, mark);
  return [...last.values()].filter((mark) => {
    if (mark.verdict !== "helped") return false;
    const { after } = ideaOutcomeWindows(mark);
    return after.end >= range.start && after.end < range.end;
  });
}

/** התוצאה של סימון אחד מול הספירות — `null` למפתח שאינו רעיון. */
export function mentorIdeaOutcome(
  mark: MentorIdeaMark,
  before: MentorActivity,
  after: MentorActivity,
): MentorIdeaOutcome | null {
  const idea = ideaByKey(mark.key);
  if (idea === null) return null;
  const was = before[idea.metric];
  const now = after[idea.metric];
  return {
    key: mark.key,
    metric: idea.metric,
    text: idea.text,
    date: mark.date,
    before: was,
    after: now,
    change: now > was ? "up" : now < was ? "down" : "flat",
  };
}
