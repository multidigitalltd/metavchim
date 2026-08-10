import { LEGAL_IS_DEMO } from "../lib/legal";
import { IconWarning } from "./icons";

/**
 * כותרת האזהרה שמופיעה בראש כל מסמך משפטי כל עוד התוכן הוא דמו.
 *
 * הרכיב הזה הוא הסיבה שקיים `LEGAL_IS_DEMO`. מסמך משפטי שנראה גמור
 * ואינו גמור מסוכן יותר ממסמך חסר: משרד שקורא "תנאי שימוש" עם ח.פ.
 * שנראה תקין מניח שהוא חתם על משהו. האזהרה מוצגת למשתמש ולא רק
 * בהערה בקוד, כי מי שצריך לדעת אינו קורא את הקוד.
 *
 * כשהערכים האמיתיים מושלמים והמסמכים עוברים עורך/ת דין — מעבירים את
 * `LEGAL_IS_DEMO` ל-false, וכל שלושת המסמכים מפסיקים להציג את הבאנר
 * יחד. זו הסיבה שהוא רכיב אחד ולא שלוש פסקאות מועתקות.
 */
export function LegalDemoNotice() {
  if (!LEGAL_IS_DEMO) return null;
  return (
    <p
      role="note"
      className="mb-6 rounded-xl border p-3 text-sm font-medium"
      style={{
        borderColor: "var(--color-danger)",
        color: "var(--color-danger)",
        background: "var(--color-surface)",
      }}
    >
      <IconWarning s={15} /> טיוטה לתצוגה בלבד — פרטי המפעילה במסמך זה הם תוכן דמו, והנוסח
      טרם עבר בדיקה משפטית. אין להסתמך עליו כמסמך מחייב.
    </p>
  );
}
