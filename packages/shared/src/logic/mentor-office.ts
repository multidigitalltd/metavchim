import { MENTOR_METRICS, type MentorGoalMetric } from "./mentor.js";
import type { MentorIdeaOutcome } from "./mentor-outcome.js";
import { ideaByKey, type MentorIdeaFeedback } from "./mentor-playbook.js";

/**
 * ספר המשחק שלומד מהמשרד (docs/14 §7.4).
 *
 * כל מתווך מלמד את המנטור לבד: „עזר לי”, „לא בשבילי”, ומה נמדד שבוע
 * אחרי. במשרד של שמונה מתווכים זה ידע שנשאר בשמונה איים. כאן הוא
 * מתאחד — **ספירות בלבד, בלי שמות**: כמה סימנו שרעיון עזר, אצל כמה
 * המספר באמת עלה. רעיון שהוכיח את עצמו כאן מוצע ראשון, ומתווך חדש
 * מתחיל ממה שעובד במשרד הזה ולא מרשימה כללית.
 *
 * ## למה ספירות ולא שמות
 *
 * הכלל של המנטור (§4): השוואה רק לעצמו, לעולם לא מול עמיתים. „עבד
 * אצל שלושה במשרד” אינו השוואה — זה ידע משותף; „עבד אצל דני” כבר
 * היה מדרג. לכן המבנה כאן אינו מחזיק מזהה משתמש בכלל: הקלט הוא
 * רשימת עדויות אנונימיות, והפלט מספרים לכל רעיון.
 *
 * ## הציון
 *
 * מדידה שווה יותר מתחושה: המספר שעלה אצל מתווך (§7.2) שווה שתיים,
 * „עזר לי” שווה אחת, ו„לא בשבילי” מוריד אחת. רעיון „מוכח” הוא רעיון
 * עם ציון חיובי — ולכן רעיון שאחד אהב ושניים דחו אינו מוכח.
 */

export interface OfficeIdeaEvidence {
  key: string;
  metric: MentorGoalMetric;
  text: string;
  /** כמה מתווכים סימנו „עזר לי” */
  helped: number;
  /** כמה סימנו „לא בשבילי” */
  dismissed: number;
  /** אצל כמה נמדד — והמספר עלה */
  up: number;
  /** כמה מדידות בסך הכול */
  measured: number;
  score: number;
}

export interface MentorOfficePlaybook {
  /** הרעיונות המוכחים — מהחזק לחלש */
  proven: OfficeIdeaEvidence[];
  /** כמה מתווכים תרמו עדות כלשהי */
  agents: number;
}

export const EMPTY_OFFICE_PLAYBOOK: Readonly<MentorOfficePlaybook> = {
  proven: [],
  agents: 0,
};

/**
 * עדות של מתווך אחד. ‎`id` הוא רק כדי להוציא את המתווך עצמו מהספר
 * שמוצג **לו** (`officePlaybookFor`) — הוא אינו נכנס לפלט לעולם.
 */
export interface OfficeEvidenceEntry {
  id?: string;
  feedback: MentorIdeaFeedback;
  outcomes: readonly MentorIdeaOutcome[];
}

export function officePlaybook(
  entries: readonly OfficeEvidenceEntry[],
): MentorOfficePlaybook {
  const byKey = new Map<string, OfficeIdeaEvidence>();
  const evidence = (key: string): OfficeIdeaEvidence | null => {
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const idea = ideaByKey(key);
    if (idea === null) return null;
    const fresh: OfficeIdeaEvidence = {
      key,
      metric: idea.metric,
      text: idea.text,
      helped: 0,
      dismissed: 0,
      up: 0,
      measured: 0,
      score: 0,
    };
    byKey.set(key, fresh);
    return fresh;
  };
  let agents = 0;
  for (const entry of entries) {
    const { liked, dismissed } = entry.feedback;
    if (
      liked.length === 0 &&
      dismissed.length === 0 &&
      entry.outcomes.length === 0
    )
      continue;
    agents += 1;
    // מתווך נספר פעם אחת לכל רעיון — גם אם סימן אותו בכמה בקרים
    for (const key of new Set(liked)) {
      const e = evidence(key);
      if (e !== null) e.helped += 1;
    }
    for (const key of new Set(dismissed)) {
      const e = evidence(key);
      if (e !== null) e.dismissed += 1;
    }
    /*
     * מתווך נספר פעם אחת לכל רעיון גם במדידות: מי שסימן „עזר לי” על
     * אותו רעיון בשלושה בקרים נמדד שלוש פעמים, אבל „המספר עלה אצל 2”
     * חייב להיות שני מתווכים (ביקורת Codex). עלה אצלו אם עלה פעם אחת.
     */
    const byIdea = new Map<string, boolean>();
    for (const outcome of entry.outcomes)
      byIdea.set(
        outcome.key,
        (byIdea.get(outcome.key) ?? false) || outcome.change === "up",
      );
    for (const [key, up] of byIdea) {
      const e = evidence(key);
      if (e === null) continue;
      e.measured += 1;
      if (up) e.up += 1;
    }
  }
  for (const e of byKey.values()) e.score = 2 * e.up + e.helped - e.dismissed;
  const proven = [...byKey.values()]
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return { proven, agents };
}

/**
 * הספר כפי שמתווך אחד רואה אותו — **בלי העדות שלו**: „עבד אצל אחרים
 * במשרד” חייב להיות אחרים. במשרד של אחד אין „אחרים”, ואין ספר
 * (ביקורת Codex). למנהל — `officePlaybook` על כולם.
 */
export function officePlaybookFor(
  entries: readonly OfficeEvidenceEntry[],
  userId: string,
): MentorOfficePlaybook {
  return officePlaybook(entries.filter((e) => e.id !== userId));
}

/** המפתחות המוכחים של מדד — לפי הסדר. */
export function officeProvenKeys(
  office: MentorOfficePlaybook | undefined,
  metric: MentorGoalMetric,
): string[] {
  return (office?.proven ?? [])
    .filter((e) => e.metric === metric)
    .map((e) => e.key);
}

function metricPlural(metric: MentorGoalMetric): string {
  return MENTOR_METRICS.find((m) => m.code === metric)?.many ?? metric;
}

function ideaGist(text: string): string {
  const cut = text.search(/ — |[:.]/u);
  const gist = (cut < 0 ? text : text.slice(0, cut)).trim();
  return gist.length > 60 ? `${gist.slice(0, 59).trimEnd()}…` : gist;
}

/** „עזר ל-3 · המספר עלה אצל 2” — הראיה במילים, לכרטיס ולפרומפט. */
export function officeEvidenceLabel(e: OfficeIdeaEvidence): string {
  const parts: string[] = [];
  if (e.helped > 0)
    parts.push(e.helped === 1 ? "עזר לאחד" : `עזר ל-${e.helped}`);
  if (e.up > 0)
    parts.push(e.up === 1 ? "המספר עלה אצל אחד" : `המספר עלה אצל ${e.up}`);
  if (e.dismissed > 0)
    parts.push(
      e.dismissed === 1 ? "אחד אמר לא בשבילו" : `${e.dismissed} אמרו לא בשבילם`,
    );
  return parts.join(" · ");
}

/**
 * הבלוק לפרומפט השיחה — ידע משותף, לא דירוג: עד חמישה רעיונות
 * מוכחים עם הספירות. `[]` כשאין.
 */
export function officePlaybookBlock(
  office: MentorOfficePlaybook | undefined,
): string[] {
  const top = (office?.proven ?? []).slice(0, 5);
  if (top.length === 0) return [];
  return [
    "רעיונות שהוכיחו את עצמם במשרד הזה (ספירות בלבד, בלי שמות — ידע משותף, לא השוואה; אפשר להציע אותם ראשונים ולומר שעבדו אצל אחרים במשרד):",
    ...top.map(
      (e) =>
        `- ${metricPlural(e.metric)}: „${ideaGist(e.text)}” — ${officeEvidenceLabel(e)}`,
    ),
  ];
}
