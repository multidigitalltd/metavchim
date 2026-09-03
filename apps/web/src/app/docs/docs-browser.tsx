"use client";

import { useMemo, useState } from "react";
import type { GuideArea } from "@/lib/guide-content";

/**
 * מדף התיעוד — **חיפוש על הכרטיסים, ואזורים שנשארים במקומם.**
 *
 * ## למה זה רכיב לקוח, ומה זה לא שובר
 *
 * החיפוש חייב לרוץ בדפדפן: מנוע חיפוש שמדרג את העמוד, ומודל שפה
 * שקורא אותו, אינם מקלידים בשדה. לכן המידע כולו מגיע כ-props
 * ונצבע ב-HTML כבר בשרת — מי שלא מריץ JavaScript מקבל את כל
 * הכרטיסים, וכל הקישורים בהם עובדים. השדה הוא תוספת, לא שער.
 *
 * ## למה מפתח חיפוש ולא סינון על הכותרת
 *
 * המילה שמחפשים כמעט תמיד יושבת עמוק — „שליש”, „סופטפון”,
 * „בלעדיות” — ולא בכותרת הנושא. המפתח נבנה בשרת מכותרות הצעדים,
 * הסעיפים והשאלות, ולכן שאילתה כזו מוצאת את הנושא הנכון גם
 * כשהכותרת שלו אינה מזכירה אותה.
 */

export interface DocsBrowserItem {
  id: string;
  title: string;
  summary: string;
  area: GuideArea;
  steps: number;
  hasFaq: boolean;
  /** הכל בשורה אחת, כבר מוקטן — נבנה בשרת ולא בכל הקלדה. */
  haystack: string;
}

export function DocsBrowser({
  areas,
  items,
}: {
  areas: { key: GuideArea; title: string; blurb: string }[];
  items: DocsBrowserItem[];
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const found = useMemo(
    () => (needle === "" ? items : items.filter((item) => item.haystack.includes(needle))),
    [items, needle],
  );

  return (
    <>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">חיפוש בתיעוד</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="בלעדיות, וואטסאפ, ייבוא, סופטפון…"
          className="w-full rounded-lg border px-3 py-2.5"
          style={{
            borderColor: "var(--color-input-border)",
            background: "var(--color-field)",
          }}
          /* בנייד המקלדת מציגה „חפש” — אין כאן טופס לשלוח */
          enterKeyHint="search"
        />
      </label>

      <p className="mb-8 text-sm" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
        {needle === ""
          ? `${items.length} נושאים, מסודרים לפי מתי צריך אותם.`
          : found.length === 0
            ? "אין נושא שמתאים לחיפוש הזה. נסו מילה אחרת, או כתבו לתמיכה."
            : `${found.length} נושאים תואמים`}
      </p>

      <div className="flex flex-col gap-9">
        {areas.map((area) => {
          const inArea = found.filter((item) => item.area === area.key);
          /* אזור ריק אחרי סינון נעלם — כותרת בלי כרטיסים היא רעש */
          if (inArea.length === 0) return null;
          return (
            /*
             * ‎`area-` ולא המפתח לבדו. מפתחות האזורים ומזהי הנושאים
             * חולקים מילים — „start”, „office” ו„account” הם גם וגם —
             * ושני עוגנים באותו שם באותו עמוד הם עוגן אחד שבור.
             */
            <section
              key={area.key}
              id={`area-${area.key}`}
              aria-labelledby={`area-${area.key}-heading`}
              style={{ scrollMarginTop: 80 }}
            >
              <h2 id={`area-${area.key}-heading`} className="m-0 mb-0.5 text-lg font-extrabold">
                {area.title}
              </h2>
              <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {area.blurb}
              </p>
              <ul
                className="m-0 grid list-none gap-3 p-0"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
              >
                {inArea.map((item) => (
                  /*
                   * ‎`id` על הכרטיס — `/docs#leads` היה עוגן לסעיף
                   * לפני שהנושאים קיבלו עמוד משלהם, והוא מקושר
                   * מהמערכת, מהודעות ומתשובות שכבר יצאו. עכשיו הוא
                   * מביא לכרטיס שממנו ממשיכים בקליק.
                   */
                  <li key={item.id} id={item.id} style={{ scrollMarginTop: 80 }}>
                    <a
                      href={`/docs/${item.id}`}
                      className="mv-list-card block h-full px-4 py-3.5 no-underline"
                    >
                      <span className="block font-bold">{item.title}</span>
                      <span
                        className="mt-1 block text-sm"
                        style={{ color: "var(--color-text-soft)", lineHeight: 1.6 }}
                      >
                        {item.summary}
                      </span>
                      <span
                        className="mt-2 block text-[length:var(--type-caption-lg)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {item.steps} צעדים{item.hasFaq ? " · שאלות נפוצות" : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
