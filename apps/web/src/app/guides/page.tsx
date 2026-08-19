"use client";

import { useState } from "react";
import { GUIDES } from "@/lib/guide-content";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMail } from "../icons";

/** כתובת התמיכה של המערכת — פנייה כללית, לא קשורה לגישת התמיכה לחשבון. */
const SUPPORT_EMAIL = "service@multidigital.co.il";

/**
 * עמוד ההדרכות — מדריך מפורט לכל זרימה מרכזית, עם צילומי מסך.
 *
 * הכל בעמוד אחד עם ניווט פנימי (צ'יפים), ולא עמוד לכל נושא: מתווך
 * שמחפש "איך משתפים קונה" לא יודע באיזה נושא זה יושב — Ctrl+F על
 * עמוד אחד מוצא הכל.
 *
 * הצילומים יושבים ב-public/guides/; צילום שחסר פשוט לא מוצג —
 * ההדרכה שלמה גם בלעדיו.
 */

/** צילום מסך של הדרכה — נעלם בשקט אם הקובץ עוד לא קיים. */
function GuideImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // img רגיל בכוונה — קבצים סטטיים מ-public, בלי אופטימיזציית Next
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="mb-4 w-full rounded-xl border"
      style={{ borderColor: "var(--color-border)", maxHeight: 420, objectFit: "cover", objectPosition: "top" }}
    />
  );
}

export default function GuidesPage() {
  const { loading } = useRequireAuth();
  if (loading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <h1 className="mb-1 text-2xl font-bold">הדרכות</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מדריך צעד-אחר-צעד לכל מה שהמערכת יודעת לעשות.
      </p>

      {/* פנייה לתמיכה — כאן, ולא מוסתרת בתוך ניהול המשרד */}
      <section
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
        aria-labelledby="support-heading"
      >
        <div className="min-w-0">
          <h2 id="support-heading" className="m-0 text-sm font-extrabold">
            לא מצאתם תשובה?
          </h2>
          <p className="m-0 mt-0.5 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            צוות התמיכה שלנו כאן — כתבו לנו ונחזור אליכם.
          </p>
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("פנייה לתמיכה — מערכת מתווכים")}`}
          className="mv-btn-action ms-auto"
          style={{ minHeight: 38, textDecoration: "none" }}
        >
          <IconMail s={15} /> פנייה לתמיכה
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-[13px] underline"
          style={{ color: "var(--color-text-muted)" }}
          dir="ltr"
        >
          {SUPPORT_EMAIL}
        </a>
      </section>

      {/* ניווט פנימי — קפיצה לנושא */}
      <nav aria-label="נושאי ההדרכה" className="mb-6 flex flex-wrap gap-2">
        {GUIDES.map((guide) => (
          <a key={guide.id} href={`#guide-${guide.id}`} className="mv-chip no-underline">
            {guide.title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        {GUIDES.map((guide) => (
          <section
            key={guide.id}
            id={`guide-${guide.id}`}
            aria-labelledby={`gh-${guide.id}`}
            className="mv-list-card px-5 py-[18px]"
            style={{ scrollMarginTop: 80 }}
          >
            <h2 id={`gh-${guide.id}`} className="m-0 mb-1" style={{ fontSize: 17, fontWeight: 800 }}>
              {guide.title}
            </h2>
            <p className="m-0 mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {guide.intro}
            </p>

            {guide.image ? <GuideImage src={guide.image} alt={`צילום מסך: ${guide.title}`} /> : null}

            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {guide.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="grid flex-none place-items-center rounded-full text-sm font-extrabold"
                    style={{
                      width: 28,
                      height: 28,
                      background: "var(--color-primary-soft)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="m-0 text-sm font-bold">{step.title}</h3>
                    <p className="m-0 mt-0.5 text-sm" style={{ color: "var(--color-text-soft)", lineHeight: 1.65 }}>
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {guide.tip ? (
              <p
                className="m-0 mt-4 rounded-lg border p-3 text-sm"
                style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
              >
                <b>טיפ:</b> {guide.tip}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
