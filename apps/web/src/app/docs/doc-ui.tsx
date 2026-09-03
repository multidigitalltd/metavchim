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

import type { DocPassage, Guide } from "@/lib/guide-content";
import { LogoMark } from "../icons";

/**
 * פסקאות סעיף המסגרת, מתוך `guide-content`.
 *
 * העמוד מצייר ומהקובץ נגזר ה-Markdown — **מאותו מקור**. כשהטקסט
 * ישב ב-JSX, „התיעוד המלא” שהעמוד הציע להעתיק לא הכיל אותו כלל.
 *
 * מה שנשאר בעמוד הם רק הדברים שאינם טקסט קבוע: בלוק הכתובת,
 * ופרטי המפעילה שנערכים בזמן ריצה ב-/platform. הם מוזרמים
 * כ-`children` ומופיעים בסוף הסעיף.
 */
export function DocPassages({ passages }: { passages: DocPassage[] }) {
  return (
    <>
      {passages.map((passage, index) =>
        passage.kind === "link" ? (
          <p key={passage.href} className="mb-3">
            <a href={passage.href} className="mv-chip no-underline">
              {passage.label}
            </a>
          </p>
        ) : (
          <p
            // הפסקאות קבועות בקובץ ואינן נערכות, ולכן המיקום הוא מזהה יציב
            key={index}
            className="mb-2"
            style={passage.muted === true ? { color: "var(--color-text-muted)" } : undefined}
          >
            {passage.lead === undefined ? null : <b>{passage.lead}</b>}
            {passage.lead === undefined ? passage.body : ` ${passage.body}`}
          </p>
        ),
      )}
    </>
  );
}

export const inlineCode = {
  background: "var(--color-hover-soft)",
  padding: "2px 6px",
  borderRadius: 4,
  // ‎1em‎ ולא ‎0.9em‎: הרצף בטקסט זורם הוא הטקסט הקטן ביותר בעמוד,
  // וכל הקטנה יחסית עליו שוברת את רצפת ה-14px של המערכת.
  fontSize: "1em",
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
      className="my-3 overflow-x-auto rounded-lg p-3 text-sm leading-relaxed"
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
  current: "product" | "api" | "telephony";
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
        <a href="/docs/telephony" {...chip(current === "telephony")}>
          חיבור שיחות ומרכזייה
        </a>
      </nav>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {lead}
      </p>
    </header>
  );
}

/**
 * צילום מסך בתוך התיעוד — **שרת בלבד, בלי נפילה רכה.**
 *
 * הגרסה שישבה במערכת (`GuideImage`) הייתה רכיב לקוח שמסתיר את
 * עצמו ב-`onError`. כאן זה מזיק פעמיים: התיעוד נקרא גם בידי מנוע
 * חיפוש ומודל שפה, שאינם מריצים JavaScript ולכן ממילא רואים את
 * ה-`img`, ו-`use client` על תמונה סטטית הוא חבילת JS שנשלחת בלי
 * שום דבר לעשות בה. שער הנכסים (`verify:assets`) כבר מוודא שכל
 * נתיב שנכתב קיים ב-`public`, וזו ההגנה האמיתית.
 */
export function DocImage({ src, alt }: { src: string; alt: string }) {
  return (
    // img רגיל בכוונה — קבצים סטטיים מ-public, בלי אופטימיזציית Next
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="mb-5 w-full rounded-xl border"
      style={{
        borderColor: "var(--color-border)",
        maxHeight: 460,
        objectFit: "cover",
        objectPosition: "top",
      }}
    />
  );
}

/**
 * גוף המדריך — **מקום אחד שמצייר את כל מה ש-`Guide` מכיל.**
 *
 * הוא היה משוכפל: פעם ב-`/guides/[topic]` שבמערכת ופעם בלולאה
 * שבתוך `/docs`. שכפול של מרכיב תצוגה נשבר בשקט — סעיף חדש שנוסף
 * למבנה מופיע בעותק אחד ונעלם בשני, וזה בדיוק מה שקרה כאן פעם עם
 * ‎`sections` (ביקורת Codex). עכשיו יש עותק אחד, ושלושת הפלטים —
 * עמוד הנושא, האינדקס ו-`guideMarkdown` — נגזרים מאותו מבנה.
 *
 * ‎`<ol>` ולא `<ul>` לצעדים: זה סדר פעולה, וזה מה שקורא מסך אמור
 * להכריז.
 */
export function GuideBody({ guide }: { guide: Guide }) {
  return (
    <>
      <p className="mb-4 text-[length:calc(16.5/16*1rem)] leading-relaxed">{guide.intro}</p>
      {guide.image === undefined ? null : <DocImage src={guide.image} alt={guide.title} />}

      <h2 className="mb-3 text-lg font-extrabold">איך עושים את זה</h2>
      <ol className="m-0 mb-0 flex list-decimal flex-col gap-3 ps-5">
        {guide.steps.map((step) => (
          <li key={step.title}>
            <b>{step.title}.</b> {step.body}
          </li>
        ))}
      </ol>

      {(guide.sections ?? []).map((section) => (
        <section key={section.title} className="mt-6">
          <h2 className="m-0 mb-1.5 text-lg font-extrabold">{section.title}</h2>
          <p className="m-0">{section.body}</p>
          {section.bullets === undefined ? null : (
            <ul className="m-0 mt-2 flex list-disc flex-col gap-1 ps-5">
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {section.note === undefined ? null : <DocCallout>{section.note}</DocCallout>}
          {section.image === undefined ? null : (
            <DocImage src={section.image} alt={section.title} />
          )}
        </section>
      ))}

      {(guide.faq ?? []).length === 0 ? null : (
        <section className="mt-8">
          <h2 className="m-0 mb-2 text-lg font-extrabold">שאלות נפוצות</h2>
          <dl className="m-0">
            {(guide.faq ?? []).map((item) => (
              <div key={item.q} className="mt-3">
                <dt className="font-bold">{item.q}</dt>
                <dd className="m-0 mt-0.5">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {guide.tip === undefined ? null : (
        <DocCallout>
          <b>שימו לב:</b> {guide.tip}
        </DocCallout>
      )}
    </>
  );
}

/** הערה בתוך הרצף — מה שחייב להיקרא, ולא עוד פסקה. */
export function DocCallout({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-3 mb-0 rounded-lg border p-3 text-[length:var(--type-body-sm)] leading-relaxed"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-hover-soft)",
      }}
    >
      {children}
    </p>
  );
}
