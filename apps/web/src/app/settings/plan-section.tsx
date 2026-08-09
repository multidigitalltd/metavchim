"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

/**
 * המסלול של המשרד — מה כלול בו ואיפה הוא עומד מול המגבלות.
 *
 * הסעיף הזה הוא התשובה לשאלה "למה הכפתור הזה לא עובד אצלי". בלעדיו
 * חסימה של פיצ'ר נראית כמו תקלה, והדרך היחידה לדעת אחרת היא להתקשר.
 *
 * המחירים לא מוצגים כאן במכוון: זה מסך של מה מותר, לא של כמה זה
 * עולה. שדרוג עובר דרך בעל הפלטפורמה.
 */

interface LimitState {
  blocked: boolean;
  remaining: number | null;
  percent: number | null;
  warn: boolean;
}

interface PlanInfo {
  code: string;
  name: string;
  description: string;
  /** false = קוד המסלול אינו נפתר; כל הוספה חסומה עד טיפול. */
  resolved?: boolean;
  features: { code: string; label: string; description: string; included: boolean }[];
  limits: {
    users: { used: number; limit: number | null; state: LimitState };
    properties: { used: number; limit: number | null; state: LimitState };
  };
}

function LimitRow({
  label,
  used,
  limit,
  state,
  resolved,
}: {
  label: string;
  used: number;
  limit: number | null;
  state: LimitState;
  /**
   * false = קוד המסלול אינו נפתר, ואין מכסה שאפשר להציג.
   *
   * השרת מחזיר `null` במגבלה גם במצב הזה, ו-`null` פירושו "ללא
   * הגבלה" — כלומר בלי הדגל הזה השורה הייתה מכריזה "ללא הגבלה"
   * ישירות מתחת להודעה שהכול חסום (ביקורת Codex).
   */
  resolved: boolean;
}): React.JSX.Element {
  const color = state.blocked
    ? "var(--color-danger)"
    : state.warn
      ? "#8a6414"
      : "var(--color-primary)";
  return (
    <div className="mb-2.5">
      <p className="m-0 mb-1 flex flex-wrap justify-between gap-2 text-sm">
        <span>{label}</span>
        <strong style={state.warn || state.blocked ? { color } : undefined}>
          {!resolved
            ? `${used} — המכסה אינה ידועה`
            : limit === null
              ? `${used} — ללא הגבלה`
              : `${used} מתוך ${limit}`}
        </strong>
      </p>
      {resolved && state.percent !== null ? (
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: "var(--color-border)" }}
          role="img"
          aria-label={`${label}: ${state.percent}% מהמכסה`}
        >
          <div style={{ width: `${state.percent}%`, height: "100%", background: color }} />
        </div>
      ) : null}
      {resolved && state.blocked ? (
        <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-danger)" }}>
          הגעתם למכסה — הוספה נוספת תיחסם עד שדרוג מסלול.
        </p>
      ) : null}
    </div>
  );
}

export function PlanSection(): React.JSX.Element | null {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiGet<PlanInfo>("/settings/plan")
      .then(setPlan)
      .catch(() => setFailed(true));
  }, []);

  // כשל בטעינה לא מייצר סעיף שגיאה: זה מידע משלים, ומסך ההגדרות
  // צריך להמשיך לעבוד בלעדיו
  if (failed) return null;

  return (
    <section
      aria-labelledby="plan-heading"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="plan-heading" className="mb-1 text-lg font-semibold">
        💳 המסלול שלכם
      </h2>
      {plan === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <strong style={{ color: "var(--color-text)" }}>{plan.name}</strong>
            {plan.description ? ` — ${plan.description}` : ""}
          </p>

          {plan.resolved === false ? (
            <p
              role="alert"
              className="m-0 mb-3 rounded-lg border p-3 text-sm"
              style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
            >
              המסלול של המשרד אינו מוגדר במערכת. הוספת נכסים ומשתמשים חסומה עד שהעניין
              יטופל — פנו אלינו.
            </p>
          ) : null}

          <LimitRow
            label="משתמשים במשרד"
            used={plan.limits.users.used}
            limit={plan.limits.users.limit}
            state={plan.limits.users.state}
            resolved={plan.resolved !== false}
          />
          <LimitRow
            label="נכסים"
            used={plan.limits.properties.used}
            limit={plan.limits.properties.limit}
            state={plan.limits.properties.state}
            resolved={plan.resolved !== false}
          />

          <h3 className="mb-1 mt-4 text-sm font-bold">מה כלול</h3>
          <ul className="m-0 grid list-none gap-x-4 p-0 text-sm" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {plan.features.map((feature) => (
              <li
                key={feature.code}
                style={feature.included ? undefined : { color: "var(--color-text-muted)" }}
              >
                {feature.included ? "✓" : "—"} {feature.label}
              </li>
            ))}
          </ul>
          {/*
            כפתור ולא "פנו אלינו". מתווך שנתקל בחסימה בשבע בערב אינו
            מתקשר — הוא מוותר, וזו המכירה שאבדה.
          */}
          <p className="m-0 mt-4">
            <Link href="/settings/billing" className="mv-btn-primary inline-block">
              מסלולים ותשלום
            </Link>
          </p>
          <p className="m-0 mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            השינוי נכנס לתוקף מיד, בלי להתקין כלום.
          </p>
        </>
      )}
    </section>
  );
}
