"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { FilterBar, SearchField, textMatches } from "../list-controls";
import { DictateFor } from "../dictation-field";

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
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("");
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

  /* סינון מקומי: חיפוש בשם, בטלפון ובסיכום — סיכום השיחה הוא בדיוק
     המקום שבו המתווך זוכר "מישהו שאל על נכס בהרצל" */
  const visible = (items ?? []).filter(
    (c) =>
      textMatches(query, c.contactName, c.phone, c.summary) &&
      (direction === "" || c.direction === direction),
  );
  const filtering = query.trim() !== "" || direction !== "" || outcome !== "";

  async function onDelete(id: string): Promise<void> {
    if (!window.confirm("למחוק את תיעוד השיחה?")) return;
    await apiDelete(`/calls/${id}`);
    load();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          תיעוד שיחה לוקח 20 שניות ושומר את ההקשר לפעם הבאה שתדברו עם הלקוח.
        </p>
        <button type="button" className="mv-btn-action ms-auto" onClick={() => setAdding((v) => !v)}>
          {adding ? "ביטול" : "+ תעד שיחה"}
        </button>
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
              id="callSummary"
              name="summary"
              rows={3}
              placeholder="מה סוכם, מה הלקוח מחפש, מה הצעד הבא"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </label>
          <DictateFor targetId="callSummary" />
          <div className="mt-3">
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : "שמור שיחה"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        {FILTERS.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            className="mv-chip"
            aria-pressed={outcome === value}
            onClick={() => setOutcome(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {items !== null && items.length > 0 ? (
        <FilterBar
          shown={visible.length}
          total={items.length}
          noun="שיחות"
          active={filtering}
          onClear={() => {
            setQuery("");
            setDirection("");
            setOutcome("");
          }}
        >
          <SearchField
            label="חיפוש שיחה"
            placeholder="🔍 שם, טלפון או מה נאמר בשיחה"
            value={query}
            onChange={setQuery}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <span className="mv-visually-hidden">סינון לפי כיוון</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border px-2 py-1.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
            >
              <option value="">נכנסות ויוצאות</option>
              <option value="inbound">נכנסות</option>
              <option value="outbound">יוצאות</option>
            </select>
          </label>
        </FilterBar>
      ) : null}

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
          <ul className="mv-list-card">
            {visible.map((call) => {
              const active = selected?.id === call.id;
              return (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(call)}
                    aria-current={active ? "true" : undefined}
                    className="flex w-full items-center gap-3 px-4 py-[13px] text-start"
                    style={{
                      border: "none",
                      borderBottom: "1px solid var(--color-row-border)",
                      background: active ? "var(--color-row-hover)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: call.outcome === "answered" ? "#12A150" : "#b0512c" }}
                    />
                    <span className="min-w-0" style={{ lineHeight: 1.35 }}>
                      <span className="block truncate text-[14.5px] font-bold">
                        {call.contactName ?? call.phone ?? "לא מזוהה"}
                      </span>
                      <span className="block text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                        {call.direction === "inbound" ? "נכנסת" : "יוצאת"} ·{" "}
                        {timeFmt.format(new Date(call.occurredAt))}
                      </span>
                    </span>
                    <span className="ms-auto flex-none text-start" style={{ lineHeight: 1.4 }}>
                      <span
                        className="mv-pill block"
                        style={{
                          fontSize: 12,
                          padding: "2px 10px",
                          color: call.outcome === "answered" ? "#0C6E34" : "#b0512c",
                          background: call.outcome === "answered" ? "#E5FCEA" : "#faf1ec",
                        }}
                      >
                        {OUTCOME_LABELS[call.outcome] ?? call.outcome}
                      </span>
                      {call.durationMinutes !== undefined ? (
                        <span className="mt-[3px] block text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                          {call.durationMinutes} דק׳
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <section aria-label="פרטי השיחה" className="mv-list-card">
              <div
                className="flex flex-wrap items-center gap-3 px-[22px] py-4"
                style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
              >
                <div style={{ lineHeight: 1.35 }}>
                  <h2 className="m-0" style={{ fontSize: 17, fontWeight: 800 }}>
                    {selected.contactName ?? selected.phone ?? "לא מזוהה"}
                  </h2>
                  <p className="m-0 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                    {selected.phone ? <span dir="ltr">{selected.phone} · </span> : null}
                    {selected.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"} ·{" "}
                    {timeFmt.format(new Date(selected.occurredAt))}
                    {selected.durationMinutes !== undefined ? ` · משך ${selected.durationMinutes} דק׳` : ""}
                  </p>
                </div>
                {selected.phone ? (
                  <div className="ms-auto flex gap-2">
                    <a
                      href={waMeUrl(selected.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mv-btn-plain"
                      style={{ padding: "7px 14px", fontSize: 13 }}
                    >
                      וואטסאפ
                    </a>
                    <a href={`tel:${selected.phone}`} className="mv-btn-plain" style={{ padding: "7px 14px", fontSize: 13 }}>
                      חייג
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="px-[22px] py-5">
                <p className="mb-2.5 mt-0 text-[13px] font-extrabold" style={{ color: "var(--color-text-muted)" }}>
                  סיכום השיחה
                </p>
                <div
                  className="whitespace-pre-wrap rounded-[13px] border p-3.5 text-sm"
                  style={{ background: "var(--color-field)", borderColor: "var(--color-border)", lineHeight: 1.55 }}
                >
                  {selected.summary ?? (
                    <span style={{ color: "var(--color-text-muted)" }}>לא נרשם סיכום.</span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {selected.leadId ? (
                    <Link href={`/leads/${selected.leadId}`} className="mv-btn-soft">
                      לכרטיס הליד
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onDelete(selected.id)}
                    className="mv-btn-plain"
                    style={{ color: "var(--color-danger)" }}
                  >
                    מחק תיעוד
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
