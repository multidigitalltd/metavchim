"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { IconSparkle, IconUsers } from "../icons";

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
    <main className="mv-page">
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
        <span
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background: "var(--color-primary)",
            color: "#fff",
            boxShadow:
              "0 6px 16px color-mix(in srgb, var(--color-primary) 35%, transparent)",
          }}
          aria-hidden="true"
        >
          <IconUsers s={28} />
        </span>
        <h1 id="kanko-heading" className="m-0 text-2xl font-extrabold">
          קונים - Kanko
        </h1>
        <p className="m-0 mt-3 text-[16px]" style={{ color: "var(--color-text-soft)" }}>
          פה תוכלו להציע נכסים לקונים מפולחים שמחכים להצעות.
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
    </main>
  );
}
