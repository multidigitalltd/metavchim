"use client";

import { useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
import { Notice } from "../notice";

/**
 * מחיקת נכס — **השאלה נשאלת במקום שבו לוחצים.**
 *
 * ## מה היה קודם
 *
 * אייקון הפח בכותרת הכרטיס לא מחק דבר: הוא בחר את לשונית הסקירה
 * וגלל אל כרטיס „פעולות נוספות” שבתחתית העמוד, ששם ישבו שני
 * כפתורים עם אישור דו-לחיצה משלהם. מי שלחץ על פח אשפה וקיבל גלילה
 * אינו יודע אם משהו קרה — ולכן הוא לוחץ שוב.
 *
 * ## שתי הפעולות, יחד
 *
 * ‏„למחוק את הנכס?” היא שאלה שהתשובה השימושית לה לרוב אינה „כן”
 * ואינה „ביטול” אלא **„לא, רק להוציא אותו מהרשימה”**. הארכיון היה
 * כפתור נפרד במקום אחר, ולכן מי שהתכוון אליו היה צריך לדעת מראש
 * שהוא קיים. כאן שתי הדרכים באותו חלון, וההבדל ביניהן כתוב.
 *
 * ## והגילוי נשאר
 *
 * ‏מחיקה לצמיתות מוחקת גם **כרטיס של אדם** שהנכס הזה הוא העוגן
 * היחיד שלו — שם, טלפונים והיסטוריית תקשורת. מתווך שמנקה כפילות
 * אינו מתכוון לזה, ולכן השאלה נשאלת בשרת ברגע שהחלון נפתח,
 * והתשובה מוצגת **לפני** שאפשר לאשר. „מחק” חסום עד שהיא מגיעה:
 * אישור לפני הגילוי הוא מחיקה שהמסך עוד לא גילה.
 *
 * ‎**כישלון הבדיקה אינו „לא יימחק אף כרטיס”.** שלושה מצבים ולא
 * שניים — נטען, ידוע, ולא ידוע — כי „כל מה שאינו מספר = אפס” היה
 * מבטיח שקט בדיוק כשאין לנו מושג.
 *
 * ## נכס פעיל
 *
 * השרת דורש ארכיון לפני מחיקה לצמיתות, ובצדק: זה מה שמנע היעלמות
 * בלחיצה אחת. כאן הלחיצה אינה אחת — היא חלון שנפתח, גילוי שנקרא
 * ואישור מפורש — ולכן „כן, מחק” על נכס פעיל מבצע את שני הצעדים
 * ברצף. אם השני נכשל, הנכס נשאר בארכיון וזה נאמר במפורש: מצב
 * ביניים שקוף עדיף על שגיאה שלא מסבירה מה כן קרה.
 */

/** ‎`"loading"` עד שהשרת ענה; `"unknown"` כשהבדיקה עצמה נכשלה. */
type Impact = number | "loading" | "unknown";

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
  const [impact, setImpact] = useState<Impact>("loading");
  const [busy, setBusy] = useState<null | "archive" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  /** הנכס נארכב אך המחיקה נכשלה — המצב שחייב להיאמר. */
  const [strandedInArchive, setStrandedInArchive] = useState(false);

  /*
   * חלון שנפתח מחדש מתחיל נקי, וגם שולף מחדש: הגילוי מכרטיס קודם
   * הוא בדיוק סוג המספר שנראה נכון ואינו.
   */
  useEffect(() => {
    if (!open) return;
    setError(null);
    setStrandedInArchive(false);
    setImpact("loading");
    let live = true;
    apiGet<{ contacts: number }>(`/properties/${propertyId}/permanent/preview`)
      .then((res) => {
        if (live) setImpact(res.contacts);
      })
      .catch(() => {
        if (live) setImpact("unknown");
      });
    return () => {
      live = false;
    };
  }, [open, propertyId]);

  async function archive(): Promise<void> {
    setBusy("archive");
    setError(null);
    try {
      await apiDelete(`/properties/${propertyId}`);
      onDone("archived");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההעברה לארכיון נכשלה");
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    setBusy("delete");
    setError(null);
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
      onDone("deleted");
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : "המחיקה נכשלה";
      setError(
        didArchiveNow || strandedInArchive
          ? `${message} — הנכס הועבר לארכיון ולא נמחק.`
          : message,
      );
      setBusy(null);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title="למחוק את הנכס?"
      tone="danger"
      confirmLabel="כן, מחק"
      busyLabel={busy === "archive" ? "מעביר…" : "מוחק…"}
      busy={busy !== null}
      /* אין לאשר לפני שהגילוי הגיע — זו כל מטרתו */
      confirmDisabled={impact === "loading"}
      onConfirm={() => void remove()}
      /* ‎`X` בפינה במקום כפתור טקסט שלישי שיתחרה על שתי הפעולות */
      cancelLabel={null}
      dismissIcon
      {...(archived
        ? {}
        : { secondary: { label: "העבר לארכיון", onClick: () => void archive() } })}
      onClose={onClose}
    >
      <p className="m-0">
        {archived
          ? "הנכס כבר בארכיון. מחיקה לצמיתות מסירה אותו מהמערכת יחד עם התמונות שלו מהאחסון — ואי אפשר לשחזר."
          : "מחיקה לצמיתות מסירה את הנכס מהמערכת יחד עם התמונות שלו מהאחסון — ואי אפשר לשחזר. העברה לארכיון משאירה אותו בהיסטוריה, מחוץ לרשימת הנכסים הפעילים."}
      </p>
      {/*
        ‎**האזהרה על כרטיסי האדם — לפני האישור ולא אחריו.**

        זה הגילוי שבגללו המחיקה הייתה דו-שלבית מלכתחילה: בעלים שהנכס
        הוא העוגן היחיד שלו יורד איתו, על שמו וטלפוניו.
      */}
      {impact === "loading" ? (
        <p className="m-0 mt-2" style={{ color: "var(--color-text-muted)" }}>
          בודקים מה עוד תגרור המחיקה…
        </p>
      ) : impact === "unknown" ? (
        <Notice tone="danger">
          לא הצלחנו לבדוק אם יימחקו גם כרטיסי לקוח — בדקו לפני המחיקה.
        </Notice>
      ) : impact > 0 ? (
        <Notice tone="danger">
          {impact === 1
            ? "יימחק גם כרטיס לקוח אחד, שהנכס הזה הוא הקישור היחיד אליו — כולל שם, טלפונים והיסטוריית התקשורת."
            : `יימחקו גם ${impact} כרטיסי לקוח, שהנכס הזה הוא הקישור היחיד אליהם — כולל שם, טלפונים והיסטוריית התקשורת.`}
        </Notice>
      ) : null}
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
    </ConfirmDialog>
  );
}
