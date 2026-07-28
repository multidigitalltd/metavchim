import type { Metadata } from "next";

export const metadata: Metadata = { title: "הצהרת נגישות" };

/**
 * הצהרת נגישות כנדרש בתקנות שוויון זכויות לאנשים עם מוגבלות (התשע"ג-2013)
 * ות"י 5568. פרטי הרכז והתאריך יושלמו לקראת עלייה לאוויר.
 */
export default function AccessibilityStatementPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">הצהרת נגישות</h1>

      <p className="mb-4">
        אנו רואים חשיבות רבה במתן שירות שוויוני לכלל הלקוחות ובשיפור השירות
        הניתן לאנשים עם מוגבלות. המערכת פותחה בהתאם לתקן הישראלי ת&quot;י 5568
        ולהנחיות WCAG 2.2 ברמה AA.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">מה הונגש במערכת</h2>
      <ul className="mb-4 list-inside list-disc space-y-1">
        <li>ניווט מלא באמצעות מקלדת, כולל מחווני פוקוס נראים וקישור &quot;דלג לתוכן&quot;.</li>
        <li>תמיכה בקוראי מסך (NVDA, VoiceOver, TalkBack) ומבנה HTML סמנטי.</li>
        <li>ניגודיות צבעים תקינה במצב בהיר וכהה.</li>
        <li>תמיכה בהגדלת טקסט עד 200% ללא שבירת פריסה.</li>
        <li>כיבוד העדפת המשתמש לצמצום תנועה (prefers-reduced-motion).</li>
        <li>
          סרגל נגישות ייעודי: הגדלת/הקטנת טקסט, ניגודיות גבוהה, גווני אפור,
          הדגשת קישורים וכותרות, פונט קריא, עצירת אנימציות וקו קריאה —
          ההעדפות נשמרות במכשיר.
        </li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-semibold">פנייה בנושא נגישות</h2>
      <p>
        נתקלתם בבעיית נגישות? נשמח לתקן. פנו לרכז/ת הנגישות בכתובת{" "}
        <a href="mailto:accessibility@example.com" className="underline">
          accessibility@example.com
        </a>{" "}
        ונטפל בפנייה בהקדם.
      </p>
    </article>
  );
}
