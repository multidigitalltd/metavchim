"use client";

import { use } from "react";
import Link from "next/link";
import { GUIDES, GUIDE_AREAS, guideMarkdown, type Guide } from "@/lib/guide-content";
import { useRequireAuth } from "@/lib/use-auth";
import { CopyMarkdown } from "../../copy-markdown";
import { Notice } from "../../notice";
import { GuideImage } from "../guide-image";
import { SupportCard } from "../support-card";

/**
 * מדריך אחד — **עמוד משלו, וכתובת שאפשר לשלוח.**
 *
 * ## הסדר בעמוד
 *
 * הצעדים ראשונים כי הם התשובה ל„איך עושים”, וזו השאלה שאיתה
 * נכנסים. ההעמקה אחריהם — היא עונה על „למה זה ככה” ועל „מה קורה
 * כשזה לא עובד”, ושתי אלה מגיעות רק אחרי שניסו. השאלות הנפוצות
 * אחרונות, כי הן חוזרות על מה שכבר נאמר במילים של מי ששאל.
 *
 * ## למה `use client` בלי `generateStaticParams`
 *
 * העמוד נמצא מאחורי התחברות (`useRequireAuth`), ולכן אין מה לבנות
 * מראש: הוא ממילא לא נשלח למי שלא מחובר. מי שרוצה את התוכן בלי
 * התחברות — כלי בינה מלאכותית, למשל — מקבל אותו ב-`/docs/md/<id>`
 * שכן נבנה מראש כקובץ Markdown.
 */
export default function GuidePage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = use(params);
  const { loading } = useRequireAuth();
  if (loading) return <p aria-live="polite">טוען…</p>;

  const guide = GUIDES.find((item) => item.id === topic);
  if (guide === undefined) {
    return (
      <div className="mx-auto max-w-3xl">
        <Notice tone="danger">
          לא קיים מדריך בשם הזה.{" "}
          <Link href="/guides" className="underline">
            חזרה לרשימת ההדרכות
          </Link>
        </Notice>
      </div>
    );
  }

  const area = GUIDE_AREAS.find((item) => item.key === guide.area);
  /*
   * „הבא” הוא הבא **באותו אזור** ולא ברשימה השטוחה. רצף שקופץ
   * מ„ניהול המשרד” ל„נגישות” אינו רצף — הוא סדר ההגדרה בקובץ.
   */
  const siblings = GUIDES.filter((item) => item.area === guide.area);
  const at = siblings.findIndex((item) => item.id === guide.id);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  const next = at < siblings.length - 1 ? siblings[at + 1] : undefined;
  const related = (guide.related ?? [])
    .map((id) => GUIDES.find((item) => item.id === id))
    .filter((item): item is Guide => item !== undefined);

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <nav aria-label="מיקום" className="mb-3 text-sm">
        <Link href="/guides" className="underline" style={{ color: "var(--color-text-muted)" }}>
          הדרכות
        </Link>
        {area !== undefined ? (
          <span style={{ color: "var(--color-text-muted)" }}> · {area.title}</span>
        ) : null}
      </nav>

      <h1 className="mb-1 text-2xl font-bold">{guide.title}</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--color-text-soft)", lineHeight: 1.7 }}>
        {guide.intro}
      </p>

      {guide.image !== undefined ? (
        <GuideImage src={guide.image} alt={`צילום מסך: ${guide.title}`} />
      ) : null}

      <section aria-labelledby="steps-heading" className="mb-8">
        <h2 id="steps-heading" className="mv-visually-hidden">
          צעדים
        </h2>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
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
                <h3 className="m-0 font-bold">{step.title}</h3>
                <p
                  className="m-0 mt-0.5 text-sm"
                  style={{ color: "var(--color-text-soft)", lineHeight: 1.7 }}
                >
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {(guide.sections ?? []).map((section) => (
        <section
          key={section.title}
          aria-labelledby={`s-${section.title}`}
          className="mv-list-card mb-4 px-5 py-[18px]"
        >
          <h2 id={`s-${section.title}`} className="m-0 mb-1.5 text-base font-extrabold">
            {section.title}
          </h2>
          <p
            className="m-0 text-sm"
            style={{ color: "var(--color-text-soft)", lineHeight: 1.7 }}
          >
            {section.body}
          </p>
          {section.bullets !== undefined ? (
            <ul className="m-0 mt-2 ps-5 text-sm" style={{ color: "var(--color-text-soft)", lineHeight: 1.8 }}>
              {section.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.image !== undefined ? (
            <div className="mt-3">
              <GuideImage src={section.image} alt={`צילום מסך: ${section.title}`} />
            </div>
          ) : null}
          {section.note !== undefined ? (
            <p
              className="m-0 mt-3 rounded-lg border p-3 text-sm"
              style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
            >
              {section.note}
            </p>
          ) : null}
        </section>
      ))}

      {(guide.faq ?? []).length > 0 ? (
        <section aria-labelledby="faq-heading" className="mb-4">
          <h2 id="faq-heading" className="m-0 mb-2 text-lg font-extrabold">
            שאלות נפוצות
          </h2>
          <div className="flex flex-col gap-2">
            {(guide.faq ?? []).map((item) => (
              /*
                `details` ולא מצב פתוח/סגור ב-state: העמוד עובד גם
                לפני שה-JavaScript נטען, וחיפוש בדפדפן מוצא טקסט
                שסגור בתוכו.
              */
              <details
                key={item.q}
                className="rounded-lg border px-4 py-3"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <summary className="cursor-pointer font-bold">{item.q}</summary>
                <p
                  className="m-0 mt-2 text-sm"
                  style={{ color: "var(--color-text-soft)", lineHeight: 1.7 }}
                >
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {guide.tip !== undefined ? (
        <p
          className="m-0 mb-6 rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
        >
          <b>טיפ:</b> {guide.tip}
        </p>
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related-heading" className="mb-6">
          <h2 id="related-heading" className="m-0 mb-2 text-base font-extrabold">
            מדריכים קשורים
          </h2>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {related.map((item) => (
              <li key={item.id}>
                <Link href={`/guides/${item.id}`} className="mv-chip no-underline">
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <CopyMarkdown
        markdown={guideMarkdown(guide)}
        href={`/docs/md/${guide.id}`}
        subject={guide.title}
      />

      <nav
        aria-label="מדריך קודם והבא"
        className="mt-8 flex flex-wrap justify-between gap-3 border-t pt-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        {previous !== undefined ? (
          <Link href={`/guides/${previous.id}`} className="underline">
            → {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next !== undefined ? (
          <Link href={`/guides/${next.id}`} className="ms-auto underline">
            {next.title} ←
          </Link>
        ) : null}
      </nav>

      <div className="mt-8">
        <SupportCard />
      </div>
    </div>
  );
}
