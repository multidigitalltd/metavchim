/**
 * חיתוך תשובה ארוכה למספר הודעות וואטסאפ — פונקציה טהורה, מכוסה
 * בבדיקות.
 *
 * ## למה זה לא `slice`
 *
 * תקרת Cloud API להודעת טקסט היא 4096 תווים, וקודם התשובה פשוט
 * נחתכה שם. תשובה על "מי מחפש 4 חדרים בגבעתיים" עם עשרים קונים
 * נגמרה באמצע שם של לקוח, בלי שום סימן שיש המשך — כלומר המתווך קיבל
 * *נתונים חסרים* וחשב שאלה כל הנתונים. עדיף פיצול לכמה הודעות.
 *
 * החיתוך על גבולות שורה כי התשובות בנויות שורות ("• שדה: ערך",
 * פריטי רשימה) — חצי שורה בהודעה אחת וחצי בשנייה אינו קריא. שורה
 * בודדת שארוכה מהתקרה נחתכת על גבול מילה, וכמוצא אחרון על תו.
 */

/** שוליים מתחת ל-4096 של Meta — מקום לסימון ההמשך ולתווי UTF-16. */
export const WA_MAX_TEXT = 3500;
/**
 * תקרת הודעות לתשובה אחת. בלעדיה תשובה חריגה הייתה מציפה את הצ'אט
 * בעשר הודעות רצופות — שזה גם ספאם וגם דירוג איכות נמוך אצל Meta.
 */
export const WA_MAX_CHUNKS = 4;

const CONTINUED = "…";
const TRUNCATED_NOTE = "(התשובה ארוכה — ההמשך המלא במסך המערכת)";

/** מחלק שורה בודדת ארוכה מדי, על גבול מילה כשאפשר. */
function splitLine(line: string, max: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = window.lastIndexOf(" ");
    // מילה אחת ארוכה מהתקרה (קישור, מזהה) — נחתכת על תו, אין ברירה
    const at = cut > max * 0.6 ? cut : max;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

export function splitForWhatsApp(
  text: string,
  max: number = WA_MAX_TEXT,
  maxChunks: number = WA_MAX_CHUNKS,
): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.length <= max) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  const push = (): void => {
    if (current.trim() !== "") chunks.push(current.trim());
    current = "";
  };

  for (const rawLine of trimmed.split("\n")) {
    for (const line of splitLine(rawLine, max)) {
      const candidate = current === "" ? line : `${current}\n${line}`;
      if (candidate.length <= max) {
        current = candidate;
        continue;
      }
      push();
      current = line;
    }
  }
  push();

  if (chunks.length <= maxChunks) return chunks;
  /*
   * חורג מהתקרה: מוסרים את העודף ואומרים את זה במפורש. הודעה
   * שנקטעת בשקט היא בדיוק הבעיה שהפיצול בא לפתור.
   */
  const kept = chunks.slice(0, maxChunks);
  const note = `${CONTINUED}\n${TRUNCATED_NOTE}`;
  const last = kept[maxChunks - 1]!;
  /*
   * הסימון עצמו נכנס בתקרה גם כשהוא ארוך ממנה (תקרה קטנה בבדיקות):
   * מפנים לו מקום מסוף החלק האחרון, ואם גם זה לא מספיק — הסימון הוא
   * כל התוכן. הודעה שחורגת מהתקרה נדחית ע"י Meta, כלומר נעלמת.
   */
  const room = max - note.length - 1;
  kept[maxChunks - 1] =
    room <= 0 ? note.slice(0, max) : `${last.slice(0, Math.min(last.length, room))}\n${note}`;
  return kept;
}
