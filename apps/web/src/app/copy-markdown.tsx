"use client";

import { useState } from "react";
import { IconCopy, IconDoc } from "./icons";

/**
 * „העתקה לכלי בינה מלאכותית” — **הטקסט עצמו, לא קישור אליו.**
 *
 * ## למה כפתור ולא רק קישור לקובץ
 *
 * מתווך ששואל את ChatGPT „איך אני מפרסם ביקוש ברשת” מקבל תשובה
 * שהמודל המציא — הוא לא ראה את המערכת מעולם. הדבקת ההדרכה עצמה
 * לתוך השיחה הופכת את אותה שאלה לתשובה מדויקת, וכפתור אחד הוא
 * המרחק בין „אפשר” לבין „קורה”.
 *
 * ## למה גם קישור, תמיד
 *
 * `navigator.clipboard` אינו זמין בכל מצב: דפדפן ישן, הקשר לא
 * מאובטח, או מדיניות שחוסמת גישה ללוח. כפתור לבדו היה מייצר שם
 * מבוי סתום. הקישור לקובץ ה-Markdown פותח את אותו טקסט בדיוק
 * לבחירה ולהעתקה ידנית, ועובד גם בלי JavaScript כלל.
 *
 * ## למה ההודעה בנפרד מהכפתור
 *
 * שם הכפתור נשאר קבוע. כפתור שהתווית שלו מתחלפת ל„הועתק” מבלבל
 * קורא מסך שמגיע אליו רגע אחר כך ושומע שם שאינו מתאר את הפעולה.
 * ההודעה יושבת ב-`role="status"` צמוד — מוכרזת ברגע שהיא מופיעה,
 * ולא נוגעת בשם הכפתור.
 *
 * כישלון מדווח ככישלון. הדפוס הנפוץ — `catch` שבולע ואז מציג
 * „הועתק” — הוא הדרך הבטוחה לגרום למישהו להדביק שיחה ריקה.
 */
export function CopyMarkdown({
  markdown,
  href,
  subject,
}: {
  /** הטקסט שיועתק ללוח. */
  markdown: string;
  /** אותו תוכן ככתובת, לקריאה ולהעתקה ידנית. */
  href: string;
  /** על מה מדובר — נכנס לשם הנגיש כדי שרשימת כפתורים לא תישמע זהה. */
  subject: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <p className="m-0 mt-4 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className="mv-chip"
        aria-label={`העתקת „${subject}” כ-Markdown, להדבקה בכלי בינה מלאכותית`}
        onClick={() => {
          void copy();
        }}
      >
        <IconCopy s={14} /> העתקה לכלי AI
      </button>
      <a
        href={href}
        className="mv-chip no-underline"
        aria-label={`פתיחת „${subject}” כקובץ Markdown`}
      >
        <IconDoc s={14} /> קובץ Markdown
      </a>
      {/*
        אזור החי קיים תמיד ולא נוצר בלחיצה — אזור שנולד עם תוכן
        אינו מוכרז בחלק מקוראי המסך, וזו בדיוק ההודעה היחידה כאן.
      */}
      <span role="status" style={{ color: "var(--color-text-muted)" }}>
        {state === "copied"
          ? "הטקסט הועתק — אפשר להדביק בצ'אט"
          : state === "failed"
            ? "הדפדפן חסם את הגישה ללוח — פתחו את קובץ ה-Markdown והעתיקו ממנו"
            : ""}
      </span>
    </p>
  );
}
