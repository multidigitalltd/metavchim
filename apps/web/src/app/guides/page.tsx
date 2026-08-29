"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GUIDES, GUIDE_AREAS } from "@/lib/guide-content";
import { useRequireAuth } from "@/lib/use-auth";
import { SupportCard } from "./support-card";

/**
 * ‎**מדף ההדרכות — עמוד לכל נושא, ולא מגילה אחת.**
 *
 * ## מה היה כאן קודם, ולמה זה הפסיק לעבוד
 *
 * כל ההדרכות ישבו בעמוד אחד עם שורת עוגנים, מתוך נימוק שנשמע נכון:
 * „מתווך שמחפש איך משתפים קונה לא יודע באיזה נושא זה יושב —
 * ‏Ctrl+F על עמוד אחד מוצא הכל”.
 *
 * הנימוק החזיק כל עוד היו שם עשרה מדריכים קצרים. הוא נשבר בשלוש
 * נקודות:
 *
 * - ‎**Ctrl+F אינו קיים בנייד**, ורוב המתווכים פותחים את המערכת
 *   בנייד. בעמוד של אלפי מילים בלי חיפוש נשאר רק לגלול.
 * - ‎**אי אפשר לשלוח קישור לנושא.** „תקרא על הבלעדיות” הפך לקישור
 *   לעמוד שלם, שבו הבלעדיות היא סעיף אחד מתוך עשרים.
 * - ‎**הכל נטען תמיד.** עשרים ואחד מדריכים עם צילומי מסך בכל
 *   כניסה, גם כשבאתם לשאלה אחת.
 *
 * החיפוש שהיה ב-Ctrl+F חוזר כאן כשדה סינון על הכרטיסים, והוא
 * מחפש גם בכותרות, גם בתקצירים וגם בכותרות הצעדים שבתוך כל
 * מדריך — כלומר גם במילה שיושבת עמוק, כמו „שליש” או „סופטפון”.
 */
export default function GuidesPage() {
  const { loading } = useRequireAuth();
  const [query, setQuery] = useState("");

  /*
   * המפתח לחיפוש נבנה פעם אחת ולא בכל הקלדה. הוא כולל את כותרות
   * הצעדים והסעיפים, כי המילה שמחפשים כמעט תמיד יושבת שם ולא
   * בכותרת המדריך.
   */
  const haystack = useMemo(
    () =>
      new Map(
        GUIDES.map((guide) => [
          guide.id,
          [
            guide.title,
            guide.summary,
            guide.intro,
            ...guide.steps.map((step) => step.title),
            ...(guide.sections ?? []).map((section) => section.title),
            ...(guide.faq ?? []).map((item) => item.q),
          ]
            .join(" ")
            .toLowerCase(),
        ]),
      ),
    [],
  );

  if (loading) return <p aria-live="polite">טוען…</p>;

  const needle = query.trim().toLowerCase();
  const matches = (id: string): boolean =>
    needle === "" || (haystack.get(id) ?? "").includes(needle);
  const found = GUIDES.filter((guide) => matches(guide.id));

  return (
    <div className="mx-auto max-w-4xl pb-12">
      <h1 className="mb-1 text-2xl font-bold">הדרכות</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מדריך צעד-אחר-צעד לכל מה שהמערכת יודעת לעשות — {GUIDES.length} נושאים.
      </p>

      <SupportCard />

      <label className="mb-6 block">
        <span className="mb-1 block text-sm font-medium">חיפוש בהדרכות</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="בלעדיות, סופטפון, ייבוא, קרדיטים…"
          className="w-full rounded-lg border px-3 py-2.5"
          style={{
            borderColor: "var(--color-input-border)",
            background: "var(--color-field)",
          }}
        />
      </label>

      {needle !== "" ? (
        <p className="mb-4 text-sm" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
          {found.length === 0
            ? "אין מדריך שמתאים לחיפוש הזה. נסו מילה אחרת, או כתבו לתמיכה."
            : `${found.length} מדריכים תואמים`}
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        {GUIDE_AREAS.map((area) => {
          const inArea = found.filter((guide) => guide.area === area.key);
          /* אזור ריק אחרי סינון נעלם — כותרת בלי כרטיסים היא רעש */
          if (inArea.length === 0) return null;
          return (
            <section key={area.key} aria-labelledby={`area-${area.key}`}>
              <h2 id={`area-${area.key}`} className="m-0 mb-0.5 text-lg font-extrabold">
                {area.title}
              </h2>
              <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {area.blurb}
              </p>
              <ul
                className="m-0 grid list-none gap-3 p-0"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
              >
                {inArea.map((guide) => (
                  <li key={guide.id}>
                    <Link
                      href={`/guides/${guide.id}`}
                      className="mv-list-card block h-full px-4 py-3.5 no-underline"
                    >
                      <span className="block font-bold">{guide.title}</span>
                      <span
                        className="mt-1 block text-sm"
                        style={{ color: "var(--color-text-soft)", lineHeight: 1.6 }}
                      >
                        {guide.summary}
                      </span>
                      <span
                        className="mt-2 block text-[length:var(--type-caption-lg)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {guide.steps.length} צעדים
                        {(guide.faq ?? []).length > 0 ? " · שאלות נפוצות" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/*
        הקישור לתיעוד המלא נשאר: מי שרוצה להדביק את הכול לכלי בינה
        מלאכותית צריך מסמך אחד, וזו בדיוק הסיבה שעמוד אחד ארוך היה
        פתרון טוב לקהל הזה — ופתרון גרוע לקורא אנושי.
      */}
      <p className="mt-8 text-sm" style={{ color: "var(--color-text-muted)" }}>
        רוצים את כל התיעוד בקובץ אחד (למשל כדי להדביק לכלי בינה מלאכותית)?{" "}
        <Link href="/docs" className="underline">
          התיעוד המלא
        </Link>
      </p>
    </div>
  );
}
