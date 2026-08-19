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

import { LogoMark } from "../icons";

export const inlineCode = {
  background: "var(--color-hover-soft)",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: "0.9em",
} as const;

/**
 * בלוק קוד או כתובת — תמיד LTR, גם בתוך עמוד עברי.
 *
 * `lang="en"` ולא רק `dir`: הדף מוצהר `lang="he"`, וקורא מסך
 * שמקבל `https://app.metavchim.co.il` בהגייה עברית מקריא רצף
 * אותיות חסר פשר. ההצהרה מחליפה את קול ההקראה לאנגלית בדיוק על
 * הקטע הזה.
 */
export function Code({ children }: { children: string }) {
  return (
    <pre
      dir="ltr"
      lang="en"
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
 *
 * ## למה הכותרת עצמה אינה הקישור
 *
 * היא הייתה. קישור שעוטף כותרת שלמה ונראה בדיוק כמו טקסט רגיל
 * הוא קישור שאיש אינו יודע שקיים — ובקורא מסך הוא ההפך: כל
 * כותרת בעמוד מוכרזת כ„קישור”, בלי שיש לזה משמעות.
 *
 * במקומה יש עוגן קטן ומפורש אחרי הכותרת, עם שם נגיש שאומר לאן
 * הוא מוביל. הוא מתגלה בריחוף ובפוקוס מקלדת — כלומר קיים לשתי
 * דרכי השימוש, ואינו מרעיש בקריאה רגילה.
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
      className="mv-doc-section mb-10"
      // הכותרת לא נחתכת מתחת לראש העמוד בקפיצה לעוגן
      style={{ scrollMarginTop: 80 }}
    >
      <h2 id={id} className="mb-3 flex items-baseline gap-2 text-xl font-bold">
        {title}
        <a
          href={`#${id}`}
          className="mv-anchor-link"
          aria-label={`קישור ישיר לסעיף ${title}`}
        >
          #
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
 * הסימן של המערכת מעל התיעוד.
 *
 * `/docs` נפתח לא פעם מקישור ישיר — מתוצאת חיפוש, מהודעה, או
 * מתשובה של מודל שפה — ואז זה העמוד הראשון והיחיד שהקורא רואה.
 * בלי הסימן הוא מסמך בלי שם: ברור מה כתוב בו, לא ברור של מי.
 *
 * הסימן עצמו `aria-hidden`: הוא ציור של אותן מילים שכתובות
 * לצידו, וקורא מסך שמקריא את שתיהן חוזר על עצמו. השם הנגיש הוא
 * הטקסט — „מתווכים · תיעוד”.
 */
function DocBrand() {
  return (
    <p className="m-0 mb-5 flex items-center gap-2.5">
      <LogoMark s={28} />
      <span className="text-lg font-extrabold">
        מתווכים
        {/* הנקודה היא סימן ולא מילה — קורא מסך לא אמור להגות אותה */}
        <span aria-hidden="true" style={{ color: "var(--color-action)" }}>
          .
        </span>
      </span>
      <span aria-hidden="true" style={{ color: "var(--color-border)" }}>
        |
      </span>
      <span className="text-lg" style={{ color: "var(--color-text-muted)" }}>
        תיעוד
      </span>
    </p>
  );
}

/**
 * ראש העמוד + מעבר בין שני מסמכי התיעוד.
 *
 * הקישור ההדדי כאן ולא רק בסוף העמוד: מי שהגיע לתיעוד המשתמש
 * בחיפוש על "איך מחברים לידים" צריך למצוא את תיעוד ה-API בלי
 * לקרוא עשרה סעיפים קודם, ולהפך.
 *
 * המסמך הנוכחי מסומן גם ב-`aria-current` וגם **בהדגשה** ולא רק
 * בצבע. הבחנה שכל כולה גוון אחר אובדת אצל מי שאינו מבחין בו —
 * וזו בדיוק הסיבה שהתקן אוסר להסתמך עליה לבדה.
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
  const chip = (isCurrent: boolean) => ({
    className: `mv-chip no-underline${isCurrent ? " font-extrabold" : ""}`,
    "aria-current": isCurrent ? ("page" as const) : undefined,
    style: isCurrent
      ? { borderColor: "var(--color-primary)", color: "var(--color-primary)" }
      : undefined,
  });

  return (
    <header className="mb-8">
      <DocBrand />
      <nav aria-label="מסמכי התיעוד" className="mb-4 flex flex-wrap gap-2">
        <a href="/docs" {...chip(current === "product")}>
          המדריך למערכת
        </a>
        <a href="/docs/api" {...chip(current === "api")}>
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
