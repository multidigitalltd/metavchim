"use client";

import { useState } from "react";
import { ApiError, apiDelete, apiGet } from "@/lib/api";
import { PropertyRemovalDialog } from "./property-removal-dialog";

/**
 * מחיקת נכס **אחד** — מכרטיס הנכס.
 *
 * ## מה היה קודם
 *
 * אייקון הפח בכותרת הכרטיס לא מחק דבר: הוא בחר את לשונית הסקירה
 * וגלל אל כרטיס „פעולות נוספות” שבתחתית העמוד, ששם ישבו שני
 * כפתורים עם אישור דו-לחיצה משלהם. מי שלחץ על פח אשפה וקיבל גלילה
 * אינו יודע אם משהו קרה — ולכן הוא לוחץ שוב.
 *
 * ## ‏השאלה משותפת; מה שכאן הוא הפעולה
 *
 * ‏הניסוח, הגילוי, שלוש היציאות והכלל „אין אישור לפני שהתשובה
 * ‏הגיעה” חיים ב-`PropertyRemovalDialog`, כי הרשימה שואלת בדיוק
 * ‏אותה שאלה על מה שסומן. מה שנשאר כאן הוא מה שבאמת שונה בנכס
 * ‏יחיד: הנתיבים, והצעד הכפול שלמטה.
 *
 * ## נכס פעיל
 *
 * השרת דורש ארכיון לפני מחיקה לצמיתות, ובצדק: זה מה שמנע היעלמות
 * בלחיצה אחת. כאן הלחיצה אינה אחת — היא חלון שנפתח, גילוי שנקרא
 * ואישור מפורש — ולכן „כן, מחק” על נכס פעיל מבצע את שני הצעדים
 * ברצף. אם השני נכשל, הנכס נשאר בארכיון וזה נאמר במפורש: מצב
 * ביניים שקוף עדיף על שגיאה שלא מסבירה מה כן קרה.
 */

export function DeletePropertyDialog({
  propertyId,
  archived,
  open,
  onClose,
  onDone,
}: {
  propertyId: string;
  /** נכס שכבר בארכיון — אין לו לאן להיארכב, ולכן אין פעולה שנייה. */
  archived: boolean;
  open: boolean;
  onClose: () => void;
  /** נקרא אחרי שהפעולה הצליחה — המסך שקרא לנו מחליט לאן ללכת. */
  onDone: (what: "archived" | "deleted") => void;
}): React.JSX.Element {
  /** הנכס נארכב אך המחיקה נכשלה — המצב שחייב להיאמר. */
  const [strandedInArchive, setStrandedInArchive] = useState(false);

  async function archive(): Promise<void> {
    try {
      await apiDelete(`/properties/${propertyId}`);
    } catch (err: unknown) {
      throw new Error(err instanceof ApiError ? err.message : "ההעברה לארכיון נכשלה");
    }
    onDone("archived");
  }

  async function remove(): Promise<void> {
    /*
     * ‎**„הועבר לארכיון” נאמר רק אחרי שזה קרה** (ביקורת Codex, P1).
     *
     * הניסוח הראשון גזר את המשפט מ-`!archived` — כלומר מהמצב שבו
     * הנכס היה כשהחלון נפתח. נכשל הארכוב עצמו (403, נפילת
     * טרנזקציה)? הקוד נכנס לאותו ענף בדיוק, והמסך הודיע שהנכס הוצא
     * מהרשימה בזמן שהוא פעיל ומפורסם — הבטחה על שינוי מצב שלא
     * התרחש, וזה גרוע משגיאה סתומה.
     *
     * ‎**משתנה מקומי ולא `state`**: `setStrandedInArchive` אינו
     * נקרא באותו סבב, ולכן `strandedInArchive` בתוך ה-`catch` הוא
     * עדיין הערך הישן. זו בדיוק הסיבה שהניסוח הראשון נשען על
     * ‎`!archived` מלכתחילה.
     */
    let didArchiveNow = false;
    try {
      // השרת דורש ארכיון קודם; על נכס פעיל זה הצעד הראשון מהשניים
      if (!archived && !strandedInArchive) {
        await apiDelete(`/properties/${propertyId}`);
        didArchiveNow = true;
        setStrandedInArchive(true);
      }
      await apiDelete(`/properties/${propertyId}/permanent`);
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "המחיקה נכשלה";
      throw new Error(
        didArchiveNow || strandedInArchive
          ? `${message} — הנכס הועבר לארכיון ולא נמחק.`
          : message,
      );
    }
    onDone("deleted");
  }

  return (
    <PropertyRemovalDialog
      open={open}
      count={1}
      impact={async () =>
        (await apiGet<{ contacts: number }>(`/properties/${propertyId}/permanent/preview`))
          .contacts
      }
      {...(archived ? {} : { archive })}
      remove={remove}
      onClose={onClose}
    />
  );
}
