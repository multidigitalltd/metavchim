/**
 * אבני הבניין של התיעוד הציבורי.
 *
 * הן יושבות כאן ולא בכל עמוד בנפרד משום ש-`/docs` ו-`/docs/api`
 * הם מסמך אחד מבחינת הקורא: הוא עובר ביניהם בקישור, ושתי שפות
 * עיצוביות באותו מעבר נקראות כשני אתרים.
 *
 * הכל שרת בלבד — אין כאן `"use client"`. תיעוד ציבורי שדורש
 * JavaScript כדי להיקרא הוא תיעוד שמנוע חיפוש ומודל שפה מקבלים
 * ריק, וזה בדיוק הקהל שהעמודים האלה נכתבו בשבילו.
 */

export const inlineCode = {
  background: "var(--color-hover-soft)",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: "0.9em",
} as const;

/** בלוק קוד או כתובת — תמיד LTR, גם בתוך עמוד עברי. */
export function Code({ children }: { children: string }) {
  return (
    <pre
      dir="ltr"
      className="my-3 overflow-x-auto rounded-lg p-3 text-xs leading-relaxed"
      style={{
        background: "var(--color-hover-soft)",
        border: "1px solid var(--color-border)",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

/**
 * סעיף עם עוגן.
 *
 * ה-`id` אינו קישוט: הוא מה שמאפשר לשלוח למישהו קישור לסעיף
 * מסוים במקום "תגלול עד שתמצא", וזה גם מה שמודל שפה מצטט כשהוא
 * עונה על שאלה מתוך התיעוד.
 */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="mb-10"
      // הכותרת לא נחתכת מתחת לראש העמוד בקפיצה לעוגן
      style={{ scrollMarginTop: 80 }}
    >
      <h2 id={id} className="mb-3 text-xl font-bold">
        <a
          href={`#${id}`}
          className="no-underline"
          style={{ color: "inherit" }}
        >
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

/** ניווט העמוד — צ'יפים שקופצים לסעיפים. */
export function DocNav({
  items,
  label,
}: {
  items: { id: string; title: string }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-8 flex flex-wrap gap-2">
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`} className="mv-chip no-underline">
          {item.title}
        </a>
      ))}
    </nav>
  );
}

/**
 * ראש העמוד + מעבר בין שני מסמכי התיעוד.
 *
 * הקישור ההדדי כאן ולא רק בסוף העמוד: מי שהגיע לתיעוד המשתמש
 * בחיפוש על "איך מחברים לידים" צריך למצוא את תיעוד ה-API בלי
 * לקרוא עשרה סעיפים קודם, ולהפך.
 */
export function DocHeader({
  title,
  lead,
  current,
}: {
  title: string;
  lead: string;
  current: "product" | "api";
}) {
  return (
    <header className="mb-8">
      <nav aria-label="מסמכי התיעוד" className="mb-4 flex flex-wrap gap-2">
        <a
          href="/docs"
          className="mv-chip no-underline"
          aria-current={current === "product" ? "page" : undefined}
          style={
            current === "product"
              ? { borderColor: "var(--color-primary)", color: "var(--color-primary)" }
              : undefined
          }
        >
          המדריך למערכת
        </a>
        <a
          href="/docs/api"
          className="mv-chip no-underline"
          aria-current={current === "api" ? "page" : undefined}
          style={
            current === "api"
              ? { borderColor: "var(--color-primary)", color: "var(--color-primary)" }
              : undefined
          }
        >
          קליטת לידים (API)
        </a>
      </nav>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {lead}
      </p>
    </header>
  );
}
