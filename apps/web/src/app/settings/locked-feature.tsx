import Link from "next/link";
import { featureLabel, type PlanFeature } from "@metavchim/shared";

/**
 * מודול שאינו כלול במסלול — מוצג נעול, לא נעלם.
 *
 * עד כה מודול שלא נכלל במסלול פשוט לא עלה למסך. זה נראה נקי ועלה
 * כסף: מנהל משרד שאינו יודע שיש חיבור למרכזייה לא ישדרג בשבילו,
 * ומנהל שכן שמע עליו מחפש אותו, לא מוצא, ומסיק שהמערכת לא עושה את
 * זה. **פיצ'ר נסתר הוא מכירה שלא קרתה.**
 *
 * הכרטיס הזה אומר שלוש דברים בדיוק: מה זה, שזה לא כלול, ואיפה
 * משדרגים.
 */
export function LockedFeature({
  code,
  description,
}: {
  code: PlanFeature;
  description: string;
}): React.JSX.Element {
  return (
    <section
      aria-labelledby={`locked-${code}`}
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-table-head)" }}
    >
      <h2
        id={`locked-${code}`}
        className="mb-1 text-lg font-semibold"
        style={{ color: "var(--color-text-muted)" }}
      >
        🔒 {featureLabel(code)}
      </h2>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {description}
      </p>
      <Link href="/settings/billing" className="mv-btn-ghost inline-block">
        לא כלול במסלול — למסלולים ותשלום
      </Link>
    </section>
  );
}
