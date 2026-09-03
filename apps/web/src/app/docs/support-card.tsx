import { IconMail } from "../icons";

/** כתובת התמיכה של המערכת — פנייה כללית, לא קשורה לגישת התמיכה לחשבון. */
export const SUPPORT_EMAIL = "service@metavchim.co.il";

/**
 * „לא מצאתם תשובה?” — בכל עמוד הדרכה, ולא רק באינדקס.
 *
 * מי שקורא מדריך ולא מצא בו את מה שחיפש נמצא **בסוף אותו מדריך**,
 * לא בעמוד הפתיחה. כרטיס שיושב רק באינדקס מחייב אותו לחזור אחורה
 * כדי לגלות שיש למי לפנות — וזה בדיוק הרגע שבו מוותרים.
 */
export function SupportCard() {
  return (
    <section
      className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
      aria-labelledby="support-heading"
    >
      <div className="min-w-0">
        <h2 id="support-heading" className="m-0 text-sm font-extrabold">
          לא מצאתם תשובה?
        </h2>
        <p
          className="m-0 mt-0.5 text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-text-muted)" }}
        >
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
        className="text-[length:var(--type-caption-lg)] underline"
        style={{ color: "var(--color-text-muted)" }}
        dir="ltr"
      >
        {SUPPORT_EMAIL}
      </a>
    </section>
  );
}
