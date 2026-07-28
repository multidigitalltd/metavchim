import type { Metadata } from "next";

export const metadata: Metadata = { title: "הצהרת נגישות" };

/**
 * הצהרת נגישות כנדרש בתקנות שוויון זכויות לאנשים עם מוגבלות (התשע"ג-2013)
 * ות"י 5568. התוכן יושלם לקראת עלייה לאוויר — המבנה והעמוד קיימים מהיום
 * הראשון בכוונה (docs/06 §4).
 */
export default function AccessibilityStatementPage() {
  return (
    <article className="prose max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">הצהרת נגישות</h1>
      <p className="mb-3">
        מערכת 360 למתווכים מחויבת להנגשת השירות לאנשים עם מוגבלות, בהתאם לתקן
        הישראלי ת&quot;י 5568 ולהנחיות WCAG 2.2 ברמה AA.
      </p>
      <p className="mb-3">
        המערכת תוכננה לתמיכה מלאה בניווט מקלדת, קוראי מסך, ניגודיות צבעים תקינה
        והעדפות צמצום תנועה.
      </p>
      <p>
        נתקלתם בבעיית נגישות? נשמח לתקן: פנו לרכז הנגישות בכתובת{" "}
        <a href="mailto:accessibility@example.com" className="underline">
          accessibility@example.com
        </a>
        .
      </p>
    </article>
  );
}
