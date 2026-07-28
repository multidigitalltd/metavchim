"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { MATURITY_LABELS, STATUS_LABELS } from "@/lib/format";
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
    results.leads.length === 0;

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
          placeholder="טלפון, שם לקוח או כתובת…"
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

      {q.length < 2 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          הקלידו לפחות 2 תווים — מספר טלפון מאתר לקוח מיידית.
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
