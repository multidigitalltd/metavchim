/**
 * ‎**משפט הגילוי — ניסוח אחד לשני הדיאלוגים.**
 *
 * מחיקת קונה ומחיקת ליד מציגות את אותה עובדה: כרטיס הלקוח עומד
 * להימחק, וזה מה שיירד איתו. שני ניסוחים של אותו משפט הם בדיוק
 * הצורה שנפרדת מעצמה — הרשימה והשער, שתי התיבות, שלושת מבחני
 * היתמות — ולכן המשפט נכתב פעם אחת, כאן.
 *
 * ‎**„יימחק גם כרטיס הלקוח” לבדו אינו גילוי.** מה שהופך מחיקה רחבה
 * למגולה הוא שהמתווך רואה **מה** יורד: השיחות, ההודעות, המיילים.
 * ספירת אפס אינה מוצגת — „0 שיחות” הוא רעש שמלמד לא לקרוא את
 * האזהרה.
 */
export interface ContactErasureCounts {
  calls: number;
  messages: number;
  emails: number;
}

function countedParts(erasure: ContactErasureCounts): string[] {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(n === 1 ? one : `${n} ${many}`);
  };
  add(erasure.calls, "שיחה מוקלטת אחת", "שיחות (כולל הקלטות)");
  add(erasure.messages, "הודעה אחת", "הודעות");
  add(erasure.emails, "מייל אחד", "מיילים");
  return parts;
}

export function contactErasureDisclosure(erasure: ContactErasureCounts): string {
  const parts = countedParts(erasure);
  return parts.length === 0
    ? "יימחק גם כרטיס הלקוח — השם, הטלפונים והאימייל. זה הקישור האחרון אליו במשרד, והפעולה אינה הפיכה."
    : `יימחק גם כרטיס הלקוח, כולל ${parts.join(", ")}. זה הקישור האחרון אליו במשרד, והפעולה אינה הפיכה.`;
}

/**
 * ‎**הצורה הקבוצתית — למחיקה המרוכזת.** אפס כרטיסים = מחרוזת ריקה:
 * כשאף כרטיס לקוח אינו נמחק אין מה לגלות, והאישור הרגיל עומד בפני
 * עצמו. אותו עיקרון של ספירת האפס במשפט הבודד.
 */
export function bulkContactErasureDisclosure(
  contacts: number,
  erasure: ContactErasureCounts,
): string {
  if (contacts === 0) return "";
  const who =
    contacts === 1
      ? "יימחק גם כרטיס לקוח אחד שזה הקישור האחרון אליו במשרד"
      : `יימחקו גם ${contacts} כרטיסי לקוח שזה הקישור האחרון אליהם במשרד`;
  const parts = countedParts(erasure);
  return parts.length === 0 ? `${who}.` : `${who}, כולל ${parts.join(", ")}.`;
}
