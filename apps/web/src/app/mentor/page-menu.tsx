"use client";

import { useEffect, useState } from "react";

/**
 * ‎**תפריט פנימי לעמוד המנטור.**
 *
 * ‏עמוד המנטור התארך עד שרוב מה שיש בו אינו נראה בלי גלילה: מי
 * ‏שנכנס רואה „השבוע” ומניח שזה העמוד. תרגול שיחה, הסיכום
 * ‏החודשי ו„מה עובד אצלנו” היו קיימים ובלתי מגולים.
 *
 * ## ‏עוגנים ולא מטפלי `onClick`
 *
 * ‏הכותרות כבר נושאות מזהים, ו-`globals.css` כבר נותן לכל כותרת
 * ‏עם מזהה `scroll-margin-top: 88px` — כלומר הקפיצה נוחתת מתחת
 * ‏להידר הדביק ולא באמצע הסעיף. עוגן רגיל מקבל את כל זה בחינם,
 * ‏וגם עובד עם מקלדת, עם „פתח בלשונית חדשה” ולפני שה-JS נטען.
 * ‏גם צמצום תנועה כבר מכובד גלובלית.
 *
 * ## ‏למה הרשימה נשאלת מה-DOM
 *
 * ‏שלושה מהסעיפים מותנים: „30 הימים הראשונים” תלוי בוותק,
 * ‏„מה המנטור זוכר” בקיום דפוסים, ו„מה עובד אצלנו” ביכולת
 * ‏`analytics.view`. שכפול שלושת התנאים כאן היה יוצר מקום שני
 * ‏שצריך לזכור לתקן — ותפריט שמצביע על סעיף שאינו קיים הוא
 * ‏כפתור שאינו עושה דבר.
 *
 * ‏לכן הרשימה למטה מצהירה **מה יכול להיות** בעמוד, וה-DOM עונה
 * ‏מה **באמת** יש בו. סעיף חדש שיתווסף יופיע כאן ברגע שיקבל
 * ‏מזהה ושורה ברשימה, ולא יידרש לשכפל את התנאי שלו.
 */

/**
 * ‏הסעיפים שיכולים להופיע בעמוד. **הסדר כאן אינו קובע** — ראו
 * ‏למטה: ה-DOM נשאל גם מי קיים וגם באיזה סדר.
 */
const SECTIONS: readonly { id: string; label: string }[] = [
  { id: "mentor-onboarding-heading", label: "30 הימים הראשונים" },
  { id: "mentor-week-heading", label: "השבוע" },
  { id: "mentor-advice-heading", label: "מה המנטור מציע" },
  { id: "mentor-goals-heading", label: "היעדים שלך" },
  { id: "mentor-memory-heading", label: "מה המנטור זוכר" },
  { id: "mentor-review-heading", label: "הסיכום השבועי" },
  { id: "mentor-monthly-heading", label: "הסיכום החודשי" },
  { id: "mentor-chat-heading", label: "שיחה עם המנטור" },
  { id: "mentor-practice-heading", label: "תרגול שיחה" },
  { id: "mentor-office-heading", label: "מה עובד אצלנו" },
  { id: "mentor-persona-heading", label: "השם והסגנון" },
];

export function MentorPageMenu({
  overview,
  user,
}: {
  /*
   * ‎**שני אלה אינם נקראים — הם אות לשינוי.**
   *
   * ‏הם ה**קלט** שממנו נגזר אילו סעיפים קיימים (ותק, דפוסים,
   * ‏היכולת `analytics.view`), ולא התנאים עצמם: שכפול התנאים כאן
   * ‏היה יוצר מקום שני שצריך לזכור לתקן. כשהקלט משתנה — נשאלים
   * ‏שוב, וה-DOM עונה.
   */
  overview: unknown;
  user: unknown;
}) {
  const [visible, setVisible] = useState<readonly (typeof SECTIONS)[number][]>([]);

  useEffect(() => {
    /*
     * ‎**הסדר נשאל מה-DOM, לא נשמר כאן.**
     *
     * ‏עד כה נשאל רק *מי* קיים, והסדר נלקח מהמערך שלמעלה. ביום
     * ‏שהעמוד סודר מחדש (השיחה עלתה לראש, השאר ירדו לרייל) התפריט
     * ‏המשיך למנות את הסדר הישן — כלומר מעבר על הצ׳יפים לפי הסדר
     * ‏קפץ למטה, חזר למעלה, ושוב למטה (ביקורת Codex).
     *
     * ‎`compareDocumentPosition` הופך את זה לבלתי אפשרי: הסדר
     * ‏שהתפריט מציג **הוא** הסדר שבעמוד, ואין מקום שני שיכול
     * ‏להיפרד ממנו.
     */
    const present = SECTIONS.map((section) => ({
      section,
      el: document.getElementById(section.id),
    }))
      .filter(
        (row): row is { section: (typeof SECTIONS)[number]; el: HTMLElement } =>
          row.el !== null,
      )
      .sort((a, b) =>
        (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          ? -1
          : 1,
      )
      .map((row) => row.section);
    setVisible((prev) =>
      prev.length === present.length && prev.every((row, i) => row.id === present[i]?.id)
        ? prev
        : present,
    );
  }, [overview, user]);

  /* ‏עד שהעמוד נטען אין לאן לגלול, ותפריט ריק הוא רעש */
  if (visible.length === 0) return null;

  return (
    <nav aria-label="מעבר לסעיפי העמוד" className="mv-page-menu">
      <ul className="mv-page-menu__list">
        {visible.map((section) => (
          <li key={section.id}>
            <a className="mv-chip" href={`#${section.id}`}>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
