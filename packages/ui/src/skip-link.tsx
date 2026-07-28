/**
 * קישור "דלג לתוכן" — הפריט הראשון ב-Tab בכל עמוד (WCAG 2.4.1).
 * מוסתר חזותית עד קבלת פוקוס.
 */
export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a href={`#${targetId}`} className="mv-skip-link">
      דלג לתוכן המרכזי
    </a>
  );
}
