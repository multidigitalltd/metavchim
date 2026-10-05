import { IconUser } from "./icons";

/**
 * ‎**„של מי הכרטיס הזה?” — תשובה אחת, בשישה מסכים.**
 *
 * ## למה רכיב ולא שורת JSX בכל מקום
 *
 * השאלה זהה על נכס, על קונה ועל ליד, והתשובה צריכה להיראות זהה —
 * אחרת מנהל שסורק שלוש רשימות מחפש שלושה דברים שונים. וחשוב מזה:
 * ‎**„לא משויך” הוא מצב שצריך להיראות**, לא היעדר. שורת JSX מקומית
 * הייתה נכתבת כ-`{agentName ? … : null}` בכל מסך בנפרד, ואז כרטיס
 * בלי סוכן פשוט לא מציג דבר — כלומר בדיוק הכרטיסים שהמנהל מחפש הם
 * אלה שאינם נראים.
 *
 * ## „לא משויך” מול „סוכן שעזב”
 *
 * שניהם מגיעים מהשרת כ-`agentName` חסר, וזו הכרעה מכוונת: מבחינת
 * המנהל שתי המשמעויות זהות — אין מי שמטפל בזה — והפרדה ביניהן
 * הייתה מוסיפה מצב רביעי למסך בלי להוסיף פעולה.
 */
export function AgentTag({
  name,
  /** „לא משויך” מוצג גם כשאין סוכן. כבו רק היכן שהמקום צר באמת. */
  showUnassigned = true,
}: {
  name?: string;
  showUnassigned?: boolean;
}) {
  if (name === undefined && !showUnassigned) return null;
  const assigned = name !== undefined;
  return (
    <span
      className="mv-pill"
      style={{
        background: assigned ? "var(--domain-blue-bg)" : "var(--chip-neutral-bg)",
        color: assigned ? "var(--domain-blue-fg)" : "var(--chip-neutral-fg)",
      }}
    >
      <IconUser s={13} /> {assigned ? name : "לא משויך"}
    </span>
  );
}
