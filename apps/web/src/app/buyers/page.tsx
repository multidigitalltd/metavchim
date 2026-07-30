"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { formatPrice, MATURITY_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { FilterSelect, ResultsCount, SearchField, textMatches } from "../list-controls";

interface BuyerRow {
  id: string;
  contact: { name: string; phone: string };
  requirements: { cities: string[]; budgetMaxAgorot: number; roomsMin?: number; roomsMax?: number };
  maturity: string;
  source: string;
}

const MATURITY_ORDER = ["very_hot", "hot", "interested", "not_ripe"];

export default function BuyersPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<BuyerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [maturity, setMaturity] = useState("");

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
      .then((res) =>
        setItems(
          [...res.items].sort(
            (a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity),
          ),
        ),
      )
      .catch(() => setError("טעינת הקונים נכשלה"));
  }, [authLoading]);

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (b) =>
          textMatches(query, b.contact.name, b.contact.phone, ...b.requirements.cities) &&
          (!maturity || b.maturity === maturity),
      ),
    [items, query, maturity],
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">קונים</h1>
        <div className="flex gap-2">
          <Link href="/buyers/new">
            <Button>➕ קונה חדש</Button>
          </Link>
          <Link href="/import">
            <Button variant="secondary">📄 ייבוא מקובץ</Button>
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען קונים…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-3 text-lg font-semibold">עדיין אין קונים</p>
          <Link href="/buyers/new">
            <Button>הוסף קונה ראשון</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchField
              label="חיפוש קונה"
              placeholder="🔍 שם, טלפון או עיר מבוקשת"
              value={query}
              onChange={setQuery}
            />
            <FilterSelect
              label="סינון לפי בשלות"
              value={maturity}
              onChange={setMaturity}
              allLabel="כל רמות הבשלות"
              options={Object.entries(MATURITY_LABELS)}
            />
            <ResultsCount shown={visible.length} total={items.length} noun="קונים" />
          </div>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף קונה לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setMaturity("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full">
            <caption className="mv-visually-hidden">
              רשימת הקונים במשרד לפי רמת בשלות: שם, טלפון, אזורים, תקציב
            </caption>
            <thead style={{ background: "var(--color-surface)" }}>
              <tr>
                <th scope="col" className="p-3 text-start">שם</th>
                <th scope="col" className="p-3 text-start">בשלות</th>
                <th scope="col" className="p-3 text-start">אזורים</th>
                <th scope="col" className="p-3 text-start">חדרים</th>
                <th scope="col" className="p-3 text-start">תקציב עד</th>
                <th scope="col" className="p-3 text-start">מקור</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr key={b.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="p-3">
                    <Link href={`/buyers/${b.id}`} className="font-medium underline">
                      {b.contact.name}
                    </Link>
                    <span className="block text-sm" dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                      {b.contact.phone}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className="rounded-full px-3 py-1 text-sm font-medium"
                      style={{
                        background:
                          b.maturity === "very_hot" || b.maturity === "hot"
                            ? "var(--color-danger)"
                            : "var(--color-border)",
                        color:
                          b.maturity === "very_hot" || b.maturity === "hot"
                            ? "var(--color-bg)"
                            : "var(--color-text)",
                      }}
                    >
                      {MATURITY_LABELS[b.maturity] ?? b.maturity}
                    </span>
                  </td>
                  <td className="p-3">{b.requirements.cities.join(", ")}</td>
                  <td className="p-3">
                    {b.requirements.roomsMin ?? "—"}–{b.requirements.roomsMax ?? "—"}
                  </td>
                  <td className="p-3">{formatPrice(b.requirements.budgetMaxAgorot)}</td>
                  <td className="p-3">{b.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}
    </>
  );
}
