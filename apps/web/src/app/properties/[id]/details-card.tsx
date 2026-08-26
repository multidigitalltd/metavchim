"use client";

import Link from "next/link";
import { IconEdit, IconHome } from "../../icons";

/**
 * ‎**כרטיס „פרטי הנכס” — SPEC-3c §5.**
 *
 * ## מה החליף מה
 *
 * הכרטיס הקודם היה רשת `auto-fit` של תאים: תווית קטנה ומעליה ערך,
 * כמה בשורה, לפי מה שנכנס. זה נראה סביר בשש שורות ונשבר בשתיים —
 * „סוג” ו„חדרים” לבדם התפרסו על כל רוחב הכרטיס.
 *
 * המסמך מבקש **רשימת הגדרות**: שורה לכל שדה, התווית בתחילתה
 * והערך בסופה, מופרדות בקו. הצורה הזו קוראת מלמעלה למטה ולא
 * משתנה עם מספר השדות.
 *
 * ## ערך חסר הוא מקף, לא תא ריק
 *
 * „Missing value prints an em dash — never an empty cell”. תא ריק
 * נראה כמו תקלת טעינה; מקף אומר „נבדק, ואין”. וההבחנה הזו נשמרת
 * גם בקוד: `value === null` הוא החוסר, ולא מחרוזת ריקה שהקורא
 * צריך לנחש אם היא ערך.
 */

/**
 * שדה בכרטיס. `value: null` = חסר, ומוצג כמקף.
 *
 * ‎`ltr` מסומן על השדה ולא נגזר מהתוכן: „3 מתוך 8” הוא מספר ו„דירת
 * גן” אינה, ורק מי שבנה את השדה יודע. ניחוש לפי תוכן היה מסובב
 * כתובת שמתחילה בספרה.
 */
export interface DetailField {
  label: string;
  value: string | null;
  /** מספרים, מידות ותאריכים — DESIGN-SYSTEM-4. */
  ltr?: boolean;
}

export function DetailsCard({
  fields,
  editHref,
}: {
  fields: DetailField[];
  /** חסר ⇒ אין הרשאת עריכה, ואין כפתור. */
  editHref?: string;
}) {
  return (
    <section className="mv-card" aria-labelledby="details-heading">
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-blue" aria-hidden="true">
          <IconHome s={20} />
        </span>
        <h2 id="details-heading" className="mv-card-head__title">
          פרטי הנכס
        </h2>
        {editHref === undefined ? null : (
          <Link href={editHref} className="mv-card-head__link">
            <IconEdit s={15} /> עריכה
          </Link>
        )}
      </div>

      <dl className="mv-deflist">
        {fields.map((field) => (
          <div className="mv-deflist__row" key={field.label}>
            <dt className="mv-deflist__label">{field.label}</dt>
            <dd
              className="mv-deflist__value"
              data-empty={field.value === null ? "true" : undefined}
              {...(field.ltr && field.value !== null
                ? { dir: "ltr" as const, style: { unicodeBidi: "isolate" as const } }
                : {})}
            >
              {field.value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
