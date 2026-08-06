"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * יומן שיחות — תיעוד ידני של שיחות שהמתווך קיים.
 *
 * למה ידני: הקלטת שיחות ותמלולן דורשות חיבור לספק טלפוניה שאינו
 * קיים. המסך והמודל בנויים כך שכשייכנס ספק, שיחות אוטומטיות יופיעו
 * כאן לצד הידניות בלי מסך שני.
 */

interface CallRow {
  id: string;
  direction: "inbound" | "outbound";
  source: string;
  contactName?: string;
  leadId?: string;
  phone?: string;
  occurredAt: string;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  answered: "נענתה",
  missed: "לא נענתה",
  no_answer: "אין מענה",
  voicemail: "תא קולי",
};

const FILTERS: [string, string][] = [
  ["", "הכול"],
  ["answered", "נענו"],
  ["missed", "לא נענו"],
  ["no_answer", "אין מענה"],
];

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

/** ערך ברירת מחדל לשדה datetime-local — "עכשיו" בשעון המקומי. */
function nowLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const timeFmt = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function CallsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<CallRow[] | null>(null);
  const [outcome, setOutcome] = useState("");
  const [selected, setSelected] = useState<CallRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(current = outcome): void {
    const query = current ? `?outcome=${current}` : "";
    apiGet<CallRow[]>(`/calls${query}`)
      .then((rows) => {
        setItems(rows);
        setSelected((prev) => rows.find((r) => r.id === prev?.id) ?? rows[0] ?? null);
      })
      .catch(() => setError("טעינת השיחות נכשלה"));
  }

  useEffect(() => {
    if (!authLoading) load(outcome);
  }, [authLoading, outcome]);

  async function onAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const duration = String(form.get("durationMinutes")).trim();
    const phone = String(form.get("phone")).trim();
    const summary = String(form.get("summary")).trim();
    try {
      await apiPost("/calls", {
        direction: String(form.get("direction")),
        outcome: String(form.get("outcome")),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        ...(phone ? { phone } : {}),
        ...(duration ? { durationMinutes: Number(duration) } : {}),
        ...(summary ? { summary } : {}),
      });
      setAdding(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת השיחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string): Promise<void> {
    if (!window.confirm("למחוק את תיעוד השיחה?")) return;
    await apiDelete(`/calls/${id}`);
    load();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">שיחות</h1>
        <Button onClick={() => setAdding((v) => !v)}>
          {adding ? "ביטול" : "➕ תעד שיחה"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {adding ? (
        <form
          onSubmit={(event) => void onAdd(event)}
          className="mb-5 rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block font-medium">כיוון</span>
              <select name="direction" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="inbound">שיחה נכנסת</option>
                <option value="outbound">שיחה יוצאת</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block font-medium">תוצאה</span>
              <select name="outcome" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block font-medium">מתי</span>
              <input
                type="datetime-local"
                name="occurredAt"
                required
                defaultValue={nowLocal()}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">טלפון</span>
              <input
                name="phone"
                dir="ltr"
                inputMode="tel"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">משך (דקות)</span>
              <input
                name="durationMinutes"
                type="number"
                min={0}
                max={600}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block font-medium">סיכום השיחה</span>
            <textarea
              name="summary"
              rows={3}
              placeholder="מה סוכם, מה הלקוח מחפש, מה הצעד הבא"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </label>
          <div className="mt-3">
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : "שמור שיחה"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => {
          const active = outcome === value;
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setOutcome(value)}
              className="min-h-11 rounded-full border px-4 py-1.5 font-medium"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-border)",
                background: active ? "var(--color-primary-soft)" : "var(--color-surface)",
                color: active ? "var(--color-primary)" : "var(--color-text)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {items === null ? (
        <p aria-live="polite">טוען שיחות…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">אין שיחות מתועדות</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            תיעוד שיחה לוקח 20 שניות ושומר את ההקשר לפעם הבאה שתדברו עם הלקוח.
          </p>
        </div>
      ) : (
        /* שני חלוניות כמו בעיצוב: רשימה מימין, פרטים משמאל */
        <div className="grid gap-4 lg:grid-cols-[330px_1fr] lg:items-start">
          <ul
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {items.map((call) => {
              const active = selected?.id === call.id;
              return (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(call)}
                    aria-current={active ? "true" : undefined}
                    className="flex w-full items-center gap-3 border-b p-3 text-start"
                    style={{
                      borderColor: "var(--color-border)",
                      background: active ? "var(--color-primary-soft)" : "transparent",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{
                        background:
                          call.outcome === "answered"
                            ? "var(--color-success)"
                            : "var(--color-danger)",
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {call.contactName ?? call.phone ?? "לא מזוהה"}
                      </span>
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {call.direction === "inbound" ? "נכנסת" : "יוצאת"} ·{" "}
                        {timeFmt.format(new Date(call.occurredAt))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <section
              aria-label="פרטי השיחה"
              className="rounded-xl border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <h2 className="text-lg font-semibold">
                {selected.contactName ?? selected.phone ?? "לא מזוהה"}
              </h2>
              <p style={{ color: "var(--color-text-muted)" }}>
                {selected.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"} ·{" "}
                {OUTCOME_LABELS[selected.outcome] ?? selected.outcome} ·{" "}
                {timeFmt.format(new Date(selected.occurredAt))}
                {selected.durationMinutes !== undefined ? ` · ${selected.durationMinutes} דק׳` : ""}
              </p>

              {selected.phone ? (
                <p className="mt-3 flex flex-wrap items-center gap-3">
                  <a href={`tel:${selected.phone}`} className="font-medium underline">
                    📞 חייג
                  </a>
                  <a
                    href={waMeUrl(selected.phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    💬 וואטסאפ
                  </a>
                  <span dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                    {selected.phone}
                  </span>
                </p>
              ) : null}

              <p className="mt-4 whitespace-pre-wrap">
                {selected.summary ?? (
                  <span style={{ color: "var(--color-text-muted)" }}>לא נרשם סיכום.</span>
                )}
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                {selected.leadId ? (
                  <Link href={`/leads/${selected.leadId}`} className="underline">
                    לכרטיס הליד
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onDelete(selected.id)}
                  className="underline"
                  style={{ color: "var(--color-danger)" }}
                >
                  מחק תיעוד
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
