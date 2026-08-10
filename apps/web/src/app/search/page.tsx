"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseSearchQuery, type ParsedSearchQuery } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatDateTime, MATURITY_LABELS, STATUS_LABELS } from "@/lib/format";
import { LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";

interface SearchResults {
  contact: { id: string; name: string; phone: string } | null;
  properties: {
    id: string;
    city: string | null;
    street: string | null;
    neighborhood: string | null;
    marketingTitle: string | null;
    status: string;
  }[];
  buyers: { id: string; name: string; maturity: string; cities: string[] }[];
  leads: { id: string; name: string; status: string; requiresHuman: boolean }[];
  appointments: { id: string; title: string; kind: string; startsAt: string; status: string }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null }[];
  calls: { id: string; summary: string; occurredAt: string; direction: string }[];
  notes: {
    id: string;
    content: string;
    createdAt: string;
    leadId: string | null;
    buyerId: string | null;
  }[];
}

const APPOINTMENT_KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

/** מדגיש את מילות החיפוש בתוך טקסט חופשי — כדי שיהיה ברור למה השורה עלתה. */
function Highlight({ text, needle }: { text: string; needle: string }) {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0 || needle === "") return <>{text.slice(0, 200)}</>;
  // חלון סביב ההתאמה — הערה ארוכה לא משתלטת על התוצאה
  const from = Math.max(0, at - 60);
  const to = Math.min(text.length, at + needle.length + 120);
  return (
    <>
      {from > 0 ? "…" : ""}
      {text.slice(from, at)}
      <mark style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length, to)}
      {to < text.length ? "…" : ""}
    </>
  );
}

/** "4 חדרים" / "3–4 חדרים" / "מ-3 חדרים" — כפי שהמתווך היה אומר. */
function describeRooms(rooms: NonNullable<ParsedSearchQuery["rooms"]>): string {
  if (rooms.min !== undefined && rooms.max !== undefined) {
    return rooms.min === rooms.max
      ? `${rooms.min} חדרים`
      : `${rooms.min}–${rooms.max} חדרים`;
  }
  if (rooms.min !== undefined) return `מ-${rooms.min} חדרים`;
  return `עד ${rooms.max} חדרים`;
}

/** סכומים בשקלים ולא באגורות — האגורות הן ייצוג פנימי בלבד. */
function describeBudget(budget: NonNullable<ParsedSearchQuery["budget"]>): string {
  const shekels = (agorot: number): string =>
    new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(agorot / 100);
  if (budget.minAgorot !== undefined && budget.maxAgorot !== undefined) {
    return `₪${shekels(budget.minAgorot)}–${shekels(budget.maxAgorot)}`;
  }
  if (budget.maxAgorot !== undefined) return `עד ₪${shekels(budget.maxAgorot)}`;
  return `מעל ₪${shekels(budget.minAgorot ?? 0)}`;
}

function SearchResultsView() {
  const { loading: authLoading } = useRequireAuth();
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || q.length < 2) return;
    setResults(null);
    setError(null);
    apiGet<SearchResults>(`/search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch(() => setError("החיפוש נכשל — נסו שוב"));
  }, [authLoading, q]);

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  const empty =
    results !== null &&
    results.contact === null &&
    results.properties.length === 0 &&
    results.buyers.length === 0 &&
    results.leads.length === 0 &&
    results.appointments.length === 0 &&
    results.tasks.length === 0 &&
    results.calls.length === 0 &&
    results.notes.length === 0;

  /*
   * אותו פרסור שרץ בשרת, כאן רק לתצוגה — כדי שהמתווך יראה לפי מה
   * סיננו. הלוגיקה יושבת ב-shared ולכן אין כאן עותק שני שיסטה.
   */
  const parsed = parseSearchQuery(q);
  const understood: string[] = [];
  if (parsed.structured) {
    if (parsed.entity === "buyers") {
      understood.push(parsed.dealType === "rent" ? "שוכרים" : "קונים");
    }
    if (parsed.entity === "properties") understood.push("נכסים");
    if (parsed.entity === "leads") understood.push("לידים");
    if (parsed.rooms) understood.push(describeRooms(parsed.rooms));
    if (parsed.city !== undefined) understood.push(parsed.city);
    if (parsed.budget) understood.push(describeBudget(parsed.budget));
    if (parsed.rest !== "") understood.push(`„${parsed.rest}"`);
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">חיפוש</h1>

      <form action="/search" role="search" className="mb-6 flex max-w-xl gap-2">
        <label htmlFor="q" className="mv-visually-hidden">
          חיפוש לפי טלפון, שם או כתובת
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          required
          minLength={2}
          maxLength={80}
          placeholder="קונים 4 חדרים בני ברק · טלפון · שם · כתובת…"
          className="w-full rounded-md border px-3 py-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        />
        <button
          type="submit"
          className="rounded-md px-4 py-2 font-medium"
          style={{ background: "var(--color-primary)", color: "var(--color-primary-contrast, #fff)" }}
        >
          חפש
        </button>
      </form>

      {/*
        מה הובן מהשאילתה. בלי זה, שאילתה שפורסרה חלקית נראית כמו תקלה:
        המתווך מקבל פחות תוצאות ואין לו דרך לדעת למה. הצ'יפים אומרים
        לו במפורש לפי מה סיננו, והוא יכול לתקן את הניסוח.
      */}
      {understood.length > 0 ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: "var(--color-text-muted)" }}>הבנתי:</span>
          {understood.map((chip) => (
            <span key={chip} className="mv-chip">
              {chip}
            </span>
          ))}
        </p>
      ) : null}

      {q.length < 2 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          הקלידו לפחות 2 תווים. אפשר לכתוב כמו שמדברים — „קונים 4 חדרים בני ברק"
          או „דירות עד 2 מיליון" — וגם טלפון, שם, כתובת, סיכום שיחה או הערה.
        </p>
      ) : error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : results === null ? (
        <p aria-live="polite">מחפש „{q}"…</p>
      ) : empty ? (
        <p role="status">
          לא נמצאו תוצאות עבור „{q}". אפשר להוסיף{" "}
          <Link href="/leads/new" className="underline">ליד חדש</Link> או{" "}
          <Link href="/buyers/new" className="underline">קונה חדש</Link>.
        </p>
      ) : (
        <div className="flex flex-col gap-8" aria-live="polite">
          {results.contact ? (
            <section aria-labelledby="contact-h">
              <h2 id="contact-h" className="mb-2 text-lg font-semibold">איש קשר</h2>
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--color-primary)", background: "var(--color-surface)" }}
              >
                <p className="text-xl font-bold">{results.contact.name}</p>
                <p dir="ltr" className="text-start" style={{ color: "var(--color-text-muted)" }}>
                  {results.contact.phone}
                </p>
              </div>
            </section>
          ) : null}

          {results.buyers.length > 0 ? (
            <section aria-labelledby="buyers-h">
              <h2 id="buyers-h" className="mb-2 text-lg font-semibold">
                קונים ({results.buyers.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.buyers.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/buyers/${b.id}`}
                      className="block rounded-xl border p-4 no-underline"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="font-semibold">{b.name}</span>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        — {MATURITY_LABELS[b.maturity] ?? b.maturity} · {b.cities.join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.leads.length > 0 ? (
            <section aria-labelledby="leads-h">
              <h2 id="leads-h" className="mb-2 text-lg font-semibold">
                לידים ({results.leads.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/leads/${l.id}`}
                      className="block rounded-xl border p-4 no-underline"
                      style={{
                        borderColor: l.requiresHuman ? "var(--color-danger)" : "var(--color-border)",
                        background: "var(--color-surface)",
                      }}
                    >
                      <span className="font-semibold">{l.name}</span>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        — {LEAD_STATUS_LABELS[l.status] ?? l.status}
                        {l.requiresHuman ? " · דורש טיפול אנושי" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.calls.length > 0 ? (
            <section aria-labelledby="calls-h">
              <h2 id="calls-h" className="mb-2 text-lg font-semibold">
                שיחות ({results.calls.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.calls.map((c) => (
                  <li key={c.id}>
                    <Link
                      href="/calls"
                      className="block rounded-xl border p-4 no-underline"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {c.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"} ·{" "}
                        {formatDateTime(c.occurredAt)}
                      </span>
                      <span className="block">
                        <Highlight text={c.summary} needle={q} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.notes.length > 0 ? (
            <section aria-labelledby="notes-h">
              <h2 id="notes-h" className="mb-2 text-lg font-semibold">
                הערות ותיעודים ({results.notes.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.notes.map((n) => {
                  const href = n.leadId
                    ? `/leads/${n.leadId}`
                    : n.buyerId
                      ? `/buyers/${n.buyerId}`
                      : null;
                  const body = (
                    <>
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {formatDateTime(n.createdAt)}
                        {n.leadId ? " · ליד" : n.buyerId ? " · קונה" : ""}
                      </span>
                      <span className="block">
                        <Highlight text={n.content} needle={q} />
                      </span>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {href ? (
                        <Link
                          href={href}
                          className="block rounded-xl border p-4 no-underline"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div
                          className="rounded-xl border p-4"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                        >
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {results.appointments.length > 0 ? (
            <section aria-labelledby="appts-h">
              <h2 id="appts-h" className="mb-2 text-lg font-semibold">
                יומן ({results.appointments.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.appointments.map((a) => (
                  <li key={a.id}>
                    <Link
                      href="/calendar"
                      className="block rounded-xl border p-4 no-underline"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="font-semibold">
                        <Highlight text={a.title} needle={q} />
                      </span>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        — {APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind} · {formatDateTime(a.startsAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.tasks.length > 0 ? (
            <section aria-labelledby="tasks-h">
              <h2 id="tasks-h" className="mb-2 text-lg font-semibold">
                המשימות שלי ({results.tasks.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.tasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      href="/calendar"
                      className="block rounded-xl border p-4 no-underline"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="font-semibold">
                        <Highlight text={t.title} needle={q} />
                      </span>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        — {t.status === "done" ? "בוצעה" : "פתוחה"}
                        {t.dueAt ? ` · ליום ${formatDateTime(t.dueAt)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.properties.length > 0 ? (
            <section aria-labelledby="props-h">
              <h2 id="props-h" className="mb-2 text-lg font-semibold">
                נכסים ({results.properties.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {results.properties.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/properties/${p.id}`}
                      className="block rounded-xl border p-4 no-underline"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="font-semibold">
                        {[p.street, p.neighborhood, p.city].filter(Boolean).join(", ") ||
                          p.marketingTitle ||
                          "נכס ללא כתובת"}
                      </span>{" "}
                      <span style={{ color: "var(--color-text-muted)" }}>
                        — {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <SearchResultsView />
    </Suspense>
  );
}
