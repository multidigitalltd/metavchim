"use client";

import { IconGlobe } from "../icons";

/**
 * רכש מדיה — עמוד „בקרוב” לכל מי שאינו מנהל הפלטפורמה.
 *
 * המסך עצמו קיים ועובד, אבל בעל הפלטפורמה עוד מתקן בו דברים לפני
 * שמתווכים מזמינים בו בכסף אמיתי. בינתיים הלשונית נשארת בתפריט עם
 * התג „בקרוב” (כמו Kanko לפני ההשקה), והעמוד אומר משפט אחד — מה זה
 * ומתי. מנהל הפלטפורמה רואה את המסך האמיתי; השער ב-`layout.tsx`.
 */
export function MediaComingSoon(): React.JSX.Element {
  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <section
        className="mx-auto mt-10 max-w-xl rounded-2xl border p-8 text-center"
        style={{
          borderColor: "var(--color-primary-accent)",
          background:
            "linear-gradient(180deg, var(--color-primary-soft), var(--color-surface) 78%)",
          boxShadow:
            "0 10px 28px color-mix(in srgb, var(--color-primary) 10%, transparent)",
        }}
        aria-labelledby="media-soon-heading"
      >
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
        >
          <IconGlobe s={28} />
        </span>
        <h1 id="media-soon-heading" className="m-0 mt-4 text-2xl font-extrabold">
          רכש מדיה
        </h1>
        {/* גדול ומודגש, בצבע הטקסט המלא — זה המסר של העמוד, לא הערת שוליים */}
        <p className="m-0 mt-4 text-[length:var(--type-screen-title)] font-bold leading-relaxed">
          ארכיון המדיות של הציבור החרדי — מגזינים, לוחות ושילוט — עם הזמנת
          מודעה ותשלום מתוך המערכת, בלי טלפון לנציג ובלי העברה בנקאית.
        </p>
        <p
          className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[length:var(--type-body-sm)] font-bold"
          style={{
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
          }}
        >
          ההשקה בקרוב
        </p>
      </section>
    </div>
  );
}
