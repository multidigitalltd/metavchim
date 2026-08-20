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
/**
 * הלוגו של Kanko — וקטור שצויר לפי קובץ הלוגו (בקשת המשתמש), במקום
 * כותרת טקסט באנגלית. "KAN" בצבע הטקסט, "KO" בירוק המותג, וחיוך
 * ")" אחרי ה-O. מצויר בקווים עבים שנחתכים בגבולות ה-viewBox — כך
 * הקצוות ישרים בלי לחשב פינות ידנית.
 */
function KankoLogo({ height }: { height: number }): React.JSX.Element {
  const dark = "currentColor";
  const green = "#53d17c";
  const K = (x: number, color: string) => (
    <g transform={`translate(${x} 0)`} stroke={color}>
      <line x1="26" y1="-10" x2="26" y2="210" strokeWidth="52" />
      <line x1="46" y1="108" x2="140" y2="-20" strokeWidth="54" />
      <line x1="46" y1="92" x2="140" y2="220" strokeWidth="54" />
    </g>
  );
  return (
    <svg
      viewBox="0 0 962 200"
      height={height}
      role="img"
      aria-label="Kanko"
      style={{ display: "inline-block", maxWidth: "100%" }}
    >
      {K(0, dark)}
      <g transform="translate(172 0)" stroke={dark}>
        <line x1="26" y1="216" x2="88" y2="-16" strokeWidth="52" />
        <line x1="146" y1="216" x2="84" y2="-16" strokeWidth="52" />
        <rect x="46" y="120" width="80" height="40" fill={dark} stroke="none" />
      </g>
      <g transform="translate(358 0)" stroke={dark}>
        <line x1="26" y1="-10" x2="26" y2="210" strokeWidth="52" />
        <line x1="128" y1="-10" x2="128" y2="210" strokeWidth="52" />
        <line x1="26" y1="-16" x2="128" y2="216" strokeWidth="54" />
      </g>
      {K(524, green)}
      <circle cx="785" cy="100" r="74" fill="none" stroke={green} strokeWidth="52" />
      <path d="M 900 40 A 80 80 0 0 1 900 180 A 140 140 0 0 0 900 40 Z" fill={dark} />
    </svg>
  );
}

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
          <span className="mv-visually-hidden">קונים - Kanko</span>
          <KankoLogo height={40} />
        </h1>
        <p className="m-0 mt-3 text-[16px]" style={{ color: "var(--color-text-soft)" }}>
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
