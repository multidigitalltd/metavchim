import type { Metadata } from "next";
import { fetchLegal } from "../../lib/legal";

export const metadata: Metadata = { title: "הצהרת נגישות" };

/**
 * הצהרת נגישות כנדרש בתקנות שוויון זכויות לאנשים עם מוגבלות (התשע"ג-2013)
 * ות"י 5568.
 *
 * ההצהרה חייבת לתאר את מה שקיים *עכשיו*: היא הבטיחה "סרגל נגישות
 * ייעודי" צף גם אחרי שהסרגל הוסר וההעדפות עברו לעמוד הפרופיל. מסמך
 * משפטי שמתאר תכונה שאינה קיימת גרוע יותר מהיעדר תכונה — לכן כל שינוי
 * בהגדרות הנגישות מחייב מעבר על העמוד הזה.
 */
export default async function AccessibilityStatementPage() {
  const { legal } = await fetchLegal();

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
          הגדרות נגישות אישיות בעמוד הפרופיל של כל משתמש/ת במערכת: הגדלת
          והקטנת טקסט, ניגודיות גבוהה, גווני אפור, הדגשת קישורים וכותרות,
          פונט קריא, עצירת אנימציות וקו קריאה. ההעדפות נשמרות במכשיר
          ומוחלות מיד בכל המסכים.
        </li>
      </ul>

      <h2 className="mb-2 mt-6 text-lg font-semibold">היכן מגדירים</h2>
      <p className="mb-4">
        לאחר הכניסה למערכת — בתפריט המשתמש, בעמוד &quot;הפרופיל שלי&quot;, תחת
        &quot;נגישות&quot;. ההגדרות אישיות לכל משתמש/ת ואינן משפיעות על שאר
        המשתמשים במשרד.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">מגבלות ידועות</h2>
      <p className="mb-4">
        קבצים ומסמכים שהועלו על ידי משתמשי המערכת (תמונות נכסים, מסמכים
        סרוקים) אינם בהכרח נגישים, משום שהם נוצרו מחוץ למערכת. אנו פועלים
        לצמצום הפערים באופן שוטף.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold">פנייה בנושא נגישות</h2>
      <p className="mb-4">
        נתקלתם בבעיית נגישות? נשמח לתקן. פנו לרכז/ת הנגישות בכתובת{" "}
        <a href={`mailto:${legal.accessibilityEmail}`} className="underline">
          {legal.accessibilityEmail}
        </a>{" "}
        ונטפל בפנייה בהקדם.
      </p>

      <p className="text-sm text-[var(--color-text-muted)]">
        עודכן לאחרונה: {legal.updatedAt}
        <br />
        ראו גם:{" "}
        <a href="/privacy" className="underline">
          מדיניות פרטיות
        </a>{" "}
        ·{" "}
        <a href="/terms" className="underline">
          תנאי שימוש
        </a>
      </p>
    </article>
  );
}
