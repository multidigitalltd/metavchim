/**
 * ‎**הניסוח של התפריט לוואטסאפ — החלוקה עצמה יושבת ב-`shared`.**
 *
 * מה שהמתווך רואה כאן הוא טקסט עם כוכביות, כי זה מה שוואטסאפ יודע
 * להציג; אותן קבוצות בדיוק מרונדרות במסך ככרטיסים. החלוקה ישבה
 * בקובץ הזה, כלומר הייתה של ערוץ אחד — והצ'אט במסך הציג שש דוגמאות
 * קבועות מתוך שבעים ושתיים פעולות בלי שום דרך לגלות את השאר. ראו
 * ‎`agentHelpGroups`.
 */

import { agentHelpGroups } from "@metavchim/shared";

/** כמה דוגמאות מוצגות בכל קבוצה — תפריט, לא קטלוג. */
const EXAMPLES_PER_GROUP = 2;

export function helpMenu(allowedIds: readonly string[], firstName?: string): string {
  const groups = agentHelpGroups(allowedIds);
  if (groups.length === 0) {
    return "כרגע אין לך הרשאות לפעולות דרך הסוכן — פנו לבעל המשרד.";
  }

  const greeting = firstName
    ? `${firstName}, הנה מה שאני יודעת לעשות בשבילך:`
    : "הנה מה שאני יודעת לעשות:";
  const lines: string[] = [greeting];
  for (const group of groups) {
    lines.push("", `*${group.label}*`);
    lines.push(group.actions.map((action) => action.title).join(" · "));
    for (const action of group.actions.slice(0, EXAMPLES_PER_GROUP)) {
      if (action.example !== undefined) lines.push(`   „${action.example}”`);
    }
  }

  lines.push(
    "",
    "אפשר גם *להקליט* לי הודעה קולית במקום להקליד.",
    "לפני כל פעולה שמשנה נתונים אשאל אישור — *אשר* לביצוע, *בטל* לביטול.",
  );
  return lines.join("\n");
}
