"use client";

import { useId, useState } from "react";

/**
 * ‎**מגמה לאורך שנים — סדרה אחת, עמודות.**
 *
 * עמודות ולא קו: שנה היא סל של עסקאות ולא רגע, ושנה חלקית (שהדיווחים
 * עליה עוד מגיעים) צריכה להיראות שונה מהשאר — עמודה בהירה ומקווקוות
 * עושה את זה, קו פשוט היה „צולל” בסופו ומספר סיפור שקרי על השוק.
 *
 * סדרה אחת, ולכן בלי מקרא — הכותרת שמעל אומרת מה נמדד. הצבע הוא
 * טוקן המערכת (`--color-primary-accent`), ולכן מתחלף עם הערכה הכהה
 * ומצב הניגודיות. כל עמודה מגיבה לריחוף ולמיקוד מקלדת עם הערך
 * המלא, והטבלה שמתחת היא הגרסה לקורא מסך ולמי שרוצה מספרים.
 *
 * כיוון הציר משמאל לימין גם בממשק עברי — כך נקרא ציר זמן בגרפים
 * בישראל, ומי שמשווה לגרף בעיתון לא צריך להפוך אותו בראש.
 */

export interface TrendPoint {
  label: string;
  value: number | null;
  /** תקופה שהנתונים עליה חלקיים. */
  partial?: boolean;
}

const HEIGHT = 180;
const BAR_GAP = 2;

export function TrendChart({
  points,
  title,
  format,
}: {
  points: readonly TrendPoint[];
  /** מה נמדד — גם הכותרת לקורא המסך. */
  title: string;
  format: (value: number) => string;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values);
  const width = Math.max(320, points.length * 28);
  const barWidth = width / Math.max(1, points.length) - BAR_GAP;
  const hovered = active === null ? null : points[active];

  return (
    <figure className="m-0">
      <div className="mb-1 min-h-[1.5em]" aria-live="polite" style={{ fontSize: "var(--type-caption-lg)" }}>
        {hovered && hovered.value !== null ? (
          <span>
            <b>{hovered.label}</b>: {format(hovered.value)}
            {hovered.partial ? " (חלקי — הדיווחים עוד מגיעים)" : ""}
          </span>
        ) : (
          <span style={{ color: "var(--color-text-muted)" }}>ריחוף או מעבר במקלדת על עמודה מציג את הערך</span>
        )}
      </div>
      <div className="overflow-x-auto" dir="ltr">
        <svg
          role="img"
          aria-labelledby={`${id}-title`}
          viewBox={`0 0 ${width} ${HEIGHT + 22}`}
          width="100%"
          style={{ minWidth: 320, maxHeight: 240 }}
        >
          <title id={`${id}-title`}>{title}</title>
          <defs>
            <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--color-primary-soft)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-primary-accent)" strokeWidth="2" />
            </pattern>
          </defs>
          <line x1="0" y1={HEIGHT} x2={width} y2={HEIGHT} stroke="var(--color-border)" strokeWidth="1" />
          {points.map((point, index) => {
            const value = point.value ?? 0;
            const h = point.value === null ? 0 : Math.max(2, (value / max) * (HEIGHT - 8));
            const x = index * (barWidth + BAR_GAP);
            const showLabel = points.length <= 12 || index % Math.ceil(points.length / 12) === 0 || index === points.length - 1;
            return (
              <g
                key={point.label}
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${point.label}: ${point.value === null ? "אין נתון" : format(point.value)}${point.partial ? ", חלקי" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                style={{ outline: "none", cursor: "default" }}
              >
                {/* אזור פגיעה בגובה מלא — רחב מהעמודה עצמה */}
                <rect x={x} y={0} width={barWidth + BAR_GAP} height={HEIGHT} fill="transparent" />
                <rect
                  x={x}
                  y={HEIGHT - h}
                  width={Math.max(1, barWidth)}
                  height={h}
                  rx={4}
                  fill={point.partial ? `url(#${id}-hatch)` : "var(--color-primary-accent)"}
                  opacity={active === null || active === index ? 1 : 0.55}
                />
                {active === index ? (
                  <rect x={x - 1} y={HEIGHT - h - 1} width={barWidth + 2} height={h + 2} rx={5} fill="none" stroke="var(--color-focus)" strokeWidth="2" />
                ) : null}
                {showLabel ? (
                  <text x={x + barWidth / 2} y={HEIGHT + 16} textAnchor="middle" fontSize="14" fill="var(--color-text-muted)">
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer" style={{ fontSize: "var(--type-caption-lg)" }}>
          הצגה כטבלה
        </summary>
        <table className="mt-2 w-full" style={{ fontSize: "var(--type-body-sm)" }}>
          <caption className="mv-visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-start">תקופה</th>
              <th scope="col" className="p-1 text-start">ערך</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row" className="p-1 text-start font-normal">
                  {point.label}
                  {point.partial ? " (חלקי)" : ""}
                </th>
                <td className="p-1">{point.value === null ? "—" : format(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
