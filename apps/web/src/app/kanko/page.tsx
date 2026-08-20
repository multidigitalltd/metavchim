"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { IconSparkle } from "../icons";

/**
 * קונים - Kanko — עמוד "בקרוב" עד ההשקה.
 *
 * הלשונית קיימת בתפריט כבר עכשיו (בקשת המשתמש): מתווך שרואה אותה
 * יודע מה מגיע, וביום ההשקה הוא כבר יודע לאן להיכנס. העמוד אומר
 * משפט אחד וברור — מה זה ומתי — בלי טפסים ובלי הבטחות מעבר למה
 * שההשקה תקיים.
 */
export default function KankoComingSoonPage() {
  const { loading } = useRequireAuth();
  if (loading) return null;

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
        aria-labelledby="kanko-heading"
      >
        {/* בלי אייקון מעל הלוגו (בקשת המשתמש) — הלוגו הוא המותג */}
        <h1 id="kanko-heading" className="m-0 mt-2 text-2xl font-extrabold">
          <span className="mv-visually-hidden">קונים - Kanko</span>
          {/*
            קובץ הלוגו הרשמי שמסר המשתמש — לא שחזור. `alt` ריק
            ו-aria-hidden: השם הנגיש מגיע מה-span המוסתר, ותמונה עם
            שם משלה הייתה מקריאה "Kanko" פעמיים (ביקורת Codex).
          */}
          <img
            src="/kanko-logo.png"
            alt=""
            aria-hidden="true"
            // marginInline auto — ה-reset הופך img ל-block, ובלי זה
            // הלוגו נצמד לימין במקום להתמרכז בכרטיס
            style={{ height: 56, width: "auto", maxWidth: "100%", marginInline: "auto" }}
          />
        </h1>
        {/* גדול ומודגש, בצבע הטקסט המלא — זה המסר של העמוד, לא הערת שוליים */}
        <p className="m-0 mt-4 text-[19px] font-bold leading-relaxed">
          פה תוכלו להציע נכסים לקונים מפולחים שמחכים להצעות — בלחיצת
          כפתור ובלי צורך בשיחה.
        </p>
        <p
          className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[15px] font-bold"
          style={{
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
          }}
        >
          <IconSparkle s={16} /> ההשקה בקרוב
        </p>
      </section>
    </div>
  );
}
