"use client";

import { useId } from "react";

/**
 * גרפים ב-SVG טהור, בלי ספריית תרשימים.
 *
 * ספריית גרפים טיפוסית מוסיפה מאות קילובייטים לחבילה — בשביל שתי
 * צורות שאפשר לצייר בעשרות שורות. חשוב מכך: היא מביאה איתה פלטה
 * ומידות משלה, וזה בדיוק מה שגורם לגרף להיראות מודבק מבחוץ. כאן
 * הכול נשען על טוקני הצבע של המערכת, ולכן הגרפים משתנים יחד עם
 * הערכה הכהה ועם מצב הניגודיות בלי טיפול נפרד.
 *
 * כל גרף נגיש: יש לו תיאור טקסטואלי מקביל, והנתונים גם מופיעים
 * כמקרא קריא — לא רק כצורה.
 */

export interface Slice {
  label: string;
  value: number;
  /** צבע מפורש; ברירת המחדל היא גווני המותג לפי הסדר. */
  color: string;
  /** יעד לחיצה — פילוח בלי דרך לצלול אליו הוא קישוט. */
  href?: string;
}

const RADIUS = 54;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * טבעת פילוח. הפער בין הפרוסות מושג ב-stroke-dasharray ולא במסכה —
 * פשוט יותר, ונשאר חד בכל רזולוציה.
 */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: readonly Slice[];
  centerValue: string;
  centerLabel: string;
}) {
  const titleId = useId();
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  // בלי נתונים מציגים טבעת ריקה ולא כלום: מסך שבו הגרף נעלם לסירוגין
  // נראה שבור יותר מגרף ריק עם הסבר
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 140 140"
        width="140"
        height="140"
        role="img"
        aria-labelledby={titleId}
        className="flex-none"
      >
        <title id={titleId}>
          {total === 0
            ? "אין נתונים להצגה"
            : slices.map((s) => `${s.label}: ${s.value}`).join(", ")}
        </title>
        {/* מסילה אפורה — נותנת לטבעת צורה גם כשהכול אפס */}
        <circle
          cx="70"
          cy="70"
          r={RADIUS}
          fill="none"
          stroke="var(--color-progress-track)"
          strokeWidth={STROKE}
        />
        {total > 0
          ? slices.map((slice) => {
              const portion = slice.value / total;
              const length = portion * CIRCUMFERENCE;
              const dash = `${Math.max(0, length - 2)} ${CIRCUMFERENCE - Math.max(0, length - 2)}`;
              const element = (
                <circle
                  key={slice.label}
                  cx="70"
                  cy="70"
                  r={RADIUS}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={STROKE}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  // הסיבוב מתחיל למעלה במקום בשעה 3
                  transform="rotate(-90 70 70)"
                />
              );
              offset += length;
              return element;
            })
          : null}
        <text
          x="70"
          y="66"
          textAnchor="middle"
          style={{ fontSize: 26, fontWeight: 800, fill: "var(--color-text)" }}
        >
          {centerValue}
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-text-muted)" }}
        >
          {centerLabel}
        </text>
      </svg>

      {/* המקרא הוא גם הנתונים עצמם — לא רק פענוח צבעים */}
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0">
        {slices.map((slice) => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className="flex-none rounded-full"
                style={{ width: 10, height: 10, background: slice.color }}
              />
              <span className="flex-1 truncate">{slice.label}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{slice.value}</b>
            </>
          );
          return (
            <li key={slice.label} className="text-[13px]">
              {slice.href ? (
                <a
                  href={slice.href}
                  className="mv-legend-row"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  {row}
                </a>
              ) : (
                <span className="mv-legend-row">{row}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * עמודות אופקיות — מתאים לעברית יותר מעמודות אנכיות: התוויות
 * נקראות בשורה אחת ולא מוטות באלכסון.
 */
export function BarChart({ slices }: { slices: readonly Slice[] }) {
  const max = Math.max(1, ...slices.map((s) => s.value));

  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {slices.map((slice) => {
        const percent = Math.round((slice.value / max) * 100);
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate">{slice.label}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{slice.value}</b>
            </div>
            <div
              className="overflow-hidden rounded-full"
              style={{ height: 8, background: "var(--color-progress-track)" }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: slice.color,
                  borderRadius: 99,
                  transition: "width .35s ease",
                }}
              />
            </div>
          </>
        );
        return (
          <li key={slice.label}>
            {slice.href ? (
              <a
                href={slice.href}
                className="mv-bar-row block"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
