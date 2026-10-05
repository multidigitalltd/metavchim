import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GUIDES, GUIDE_AREAS, guideMarkdown, type Guide } from "@/lib/guide-content";
import { APP_URL } from "@/lib/legal";
import { CopyMarkdown } from "../../copy-markdown";
import { DocHeader, GuideBody } from "../doc-ui";
import { SupportCard } from "../support-card";

/**
 * נושא אחד בתיעוד — **עמוד ציבורי משלו, וכתובת שאפשר לשלוח.**
 *
 * ## למה עמוד לנושא ולא סעיף במגילה
 *
 * התיעוד היה עמוד אחד עם עשרים ואחד עוגנים. זה עבד כשהיו עשרה
 * נושאים קצרים, ונשבר בדיוק באותן שלוש נקודות שכבר שברו את מדף
 * ההדרכות שבמערכת:
 *
 * - ‎**„תקרא על הבלעדיות” הפך לקישור לעמוד שלם.** עוגן מביא אותך
 *   למקום הנכון בגלילה, אבל הכותרת בלשונית, התצוגה המקדימה בוואטסאפ
 *   והתשובה של מודל שפה כולן אומרות „תיעוד המערכת” — לא „בלעדיות”.
 * - ‎**מנוע חיפוש מדרג עמוד, לא עוגן.** עשרים ואחד נושאים בעמוד
 *   אחד מתחרים זה בזה על אותה תוצאה במקום כל אחד על השאילתה שלו.
 * - ‎**הכל נטען תמיד**, כולל צילומי המסך של עשרים נושאים אחרים.
 *
 * ## למה זה נבנה מראש
 *
 * הרשימה סגורה וידועה בזמן בנייה. `generateStaticParams` הופך כל
 * נושא ל-HTML סטטי — כלומר מגיע מלא למי שאינו מריץ JavaScript,
 * וזה בדיוק הקהל שהתיעוד הציבורי נכתב בשבילו: מנוע חיפוש, מודל
 * שפה, ומי ששוקל להצטרף ועוד אין לו חשבון.
 */

export function generateStaticParams(): { topic: string }[] {
  return GUIDES.map((guide) => ({ topic: guide.id }));
}

const find = (topic: string): Guide | undefined =>
  GUIDES.find((guide) => guide.id === topic);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const guide = find(topic);
  if (guide === undefined) return { title: "נושא שאינו קיים — תיעוד מתווכים" };
  return {
    title: `${guide.title} — תיעוד מתווכים`,
    description: guide.summary,
    alternates: { canonical: `${APP_URL}/docs/${guide.id}` },
    /*
     * ‎**התיעוד כן נאנדקס** — בניגוד לשאר המערכת.
     *
     * ה-layout הראשי מכריז `index: false` כי אפליקציה פנימית אינה
     * אמורה להופיע בחיפוש, והצהרה קנונית אינה מבטלת אותו: צריך
     * לדרוס אותו במפורש בכל עמוד שכן נועד להימצא.
     */
    robots: { index: true, follow: true },
  };
}

export default async function DocTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const guide = find(topic);
  if (guide === undefined) notFound();

  const area = GUIDE_AREAS.find((item) => item.key === guide.area);
  /*
   * „הקודם” ו„הבא” הם **באותו אזור** ולא ברשימה השטוחה. רצף
   * שקופץ מ„ניהול המשרד” ל„נגישות” אינו רצף — הוא סדר ההגדרה
   * בקובץ, ומי שעובר לפיו מרגיש שהמסמך אקראי.
   */
  const siblings = GUIDES.filter((item) => item.area === guide.area);
  const at = siblings.findIndex((item) => item.id === guide.id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  const next = at < siblings.length - 1 ? siblings[at + 1] : undefined;
  const related = (guide.related ?? [])
    .map((id) => find(id))
    .filter((item): item is Guide => item !== undefined);

  return (
    /*
     * `div` ולא `main`. המעטפת הכללית כבר עוטפת כל מסך ציבורי
     * ב-`<main id="main-content">`, ושני main מקוננים הם שני
     * ציוני דרך ראשיים באותו עמוד — כלומר קישור דילוג שמוביל
     * למקום לא ברור וקורא מסך שמדווח על מבנה שגוי.
     */
    <div className="mx-auto max-w-3xl px-4 py-10">
      <DocHeader current="product" title={guide.title} lead={guide.summary} />

      {/*
        פירורי הלחם אחרי הראש ולא לפניו: הראש נושא את המותג ואת
        המעבר בין שלושת המסמכים, וזה מה שצריך להיקרא ראשון במסמך
        שנפתח מקישור ישיר. מכאן ומטה זה כבר ניווט בתוך המסמך.
      */}
      <nav aria-label="מיקום במסמך" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <a href="/docs" className="underline">
          תיעוד המערכת
        </a>
        <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
          ›
        </span>
        {area === undefined ? null : (
          <>
            <a href={`/docs#area-${area.key}`} className="underline">
              {area.title}
            </a>
            <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
              ›
            </span>
          </>
        )}
        <span style={{ color: "var(--color-text-muted)" }}>{guide.title}</span>
      </nav>

      <GuideBody guide={guide} />

      <CopyMarkdown
        markdown={guideMarkdown(guide)}
        href={`/docs/md/${guide.id}`}
        subject={guide.title}
      />

      {related.length === 0 ? null : (
        <section className="mt-8" aria-labelledby="related-heading">
          <h2 id="related-heading" className="m-0 mb-2 text-lg font-extrabold">
            נושאים קרובים
          </h2>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {related.map((item) => (
              <li key={item.id}>
                <a href={`/docs/${item.id}`} className="mv-chip no-underline">
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        ‎`previous`/`next` באותו אזור — מי שקורא „להתחיל” רוצה
        להמשיך לנושא הבא באותו אזור, לא לקפוץ לנגישות.
      */}
      {previous === undefined && next === undefined ? null : (
        <nav
          aria-label="מעבר בין נושאי האזור"
          className="mt-8 flex flex-wrap justify-between gap-3 border-t pt-5"
          style={{ borderColor: "var(--color-border)" }}
        >
          {previous === undefined ? (
            <span />
          ) : (
            <a href={`/docs/${previous.id}`} className="underline">
              ← {previous.title}
            </a>
          )}
          {next === undefined ? (
            <span />
          ) : (
            <a href={`/docs/${next.id}`} className="underline">
              {next.title} →
            </a>
          )}
        </nav>
      )}

      <div className="mt-8">
        <SupportCard />
      </div>
    </div>
  );
}
