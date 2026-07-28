"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  status: string;
  outcome?: string;
}

const KIND_LABELS: Record<string, string> = {
  viewing: "🏠 סיור בנכס",
  meeting: "🤝 פגישה",
  call: "📞 שיחה",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "מתוכנן",
  completed: "התקיים",
  cancelled: "בוטל",
  no_show: "לא הגיע",
};

const OUTCOMES = [
  ["liked", "אהב את הנכס"],
  ["negotiating", 'עוברים למו"מ'],
  ["needs_other", "צריך נכס אחר"],
  ["not_fit", "לא מתאים"],
] as const;

const dayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });

export default function CalendarPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // כולל 14 יום אחורה — כדי שסיורים שהסתיימו יופיעו לסיכום תוצאה
    // (המלצת עוזר המכירות מקשרת אליהם; ביקורת Codex)
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 14);
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    apiGet<AppointmentRow[]>(`/appointments?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setItems)
      .catch(() => setError("טעינת היומן נכשלה"));
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  async function setOutcome(id: string, outcome: string) {
    await apiPatch(`/appointments/${id}`, { outcome });
    load();
  }

  async function setStatus(id: string, status: string) {
    await apiPatch(`/appointments/${id}`, { status });
    load();
  }

  const byDay = new Map<string, AppointmentRow[]>();
  for (const item of items ?? []) {
    const key = dayFmt.format(new Date(item.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">יומן</h1>
        <Link href="/calendar/new">
          <Button>➕ פגישה חדשה</Button>
        </Link>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען יומן…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-3 text-lg font-semibold">אין פגישות מתוכננות</p>
          <Link href="/calendar/new">
            <Button>קבע פגישה ראשונה</Button>
          </Link>
        </div>
      ) : (
        [...byDay.entries()].map(([day, dayItems]) => (
          <section key={day} aria-label={day} className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">{day}</h2>
            <ul className="flex flex-col gap-2">
              {dayItems.map((a) => {
                const isPastScheduled =
                  a.status === "scheduled" && new Date(a.startsAt) < new Date();
                return (
                  <li
                    key={a.id}
                    className="rounded-xl border p-4"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold">{timeFmt.format(new Date(a.startsAt))}</span>
                        {" · "}
                        <span>{KIND_LABELS[a.kind] ?? a.kind}</span>
                        {a.title ? <span> — {a.title}</span> : null}
                      </div>
                      <span
                        className="rounded-full border px-3 py-0.5 text-sm"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        {a.outcome ? "✓ סוכם" : (STATUS_LABELS[a.status] ?? a.status)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm">
                      {a.propertyId ? (
                        <Link href={`/properties/${a.propertyId}`} className="underline">לנכס</Link>
                      ) : null}
                      {a.leadId ? (
                        <Link href={`/leads/${a.leadId}`} className="underline">לליד</Link>
                      ) : null}
                    </div>
                    {isPastScheduled && a.kind === "viewing" ? (
                      <fieldset className="mt-3">
                        <legend className="mb-2 font-medium">איך היה הסיור? (מעדכן את הליד אוטומטית)</legend>
                        <div className="flex flex-wrap gap-2">
                          {OUTCOMES.map(([value, label]) => (
                            <Button
                              key={value}
                              variant="secondary"
                              onClick={() => void setOutcome(a.id, value)}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </fieldset>
                    ) : isPastScheduled ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => void setStatus(a.id, "completed")}>
                          ✓ התקיימה
                        </Button>
                        <Button variant="ghost" onClick={() => void setStatus(a.id, "no_show")}>
                          לא התקיימה
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
