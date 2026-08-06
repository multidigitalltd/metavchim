"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * "מה שלחתי ומה קרה איתו" — רשימת ההצעות של המשרד.
 *
 * עד היום אפשר היה לראות הצעה רק דרך ההתאמה או כרטיס הנכס, כלומר
 * המתווך לא יכול היה לענות על השאלה הכי בסיסית: אילו הצעות פתוחות
 * עכשיו ומי לא הגיב. הרשימה ממוינת כך שהצעות שנפתחו ולא נענו — הסימן
 * המובהק ללקוח מתלבט — בולטות.
 */

interface OfferRow {
  id: string;
  status: string;
  title: string;
  priceAgorot?: number;
  score?: number;
  buyerName: string | null;
  openCount: number;
  sentAt?: string;
  firstOpenedAt?: string;
  url: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "ממתין לאישור",
  sent: "נשלח",
  delivered: "נמסר",
  opened: "נפתח",
  interested: "מעוניין",
  declined: "לא מתאים",
};

const FILTERS: [string, string][] = [
  ["", "הכול"],
  ["sent", "נשלחו"],
  ["opened", "נפתחו"],
  ["interested", "מעוניינים"],
  ["declined", "נדחו"],
];

function statusColors(status: string): { bg: string; fg: string } {
  if (status === "interested") return { bg: "var(--color-success-soft)", fg: "var(--color-success)" };
  if (status === "declined") return { bg: "var(--color-border)", fg: "var(--color-text-muted)" };
  if (status === "opened") return { bg: "var(--color-primary-soft)", fg: "var(--color-primary)" };
  return { bg: "var(--color-border)", fg: "var(--color-text)" };
}

export default function OffersPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<OfferRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const query = status ? `?status=${status}` : "";
    apiGet<OfferRow[]>(`/offers${query}`)
      .then(setItems)
      .catch(() => setError("טעינת ההצעות נכשלה"));
  }, [authLoading, status]);

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">הצעות</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => {
          const active = status === value;
          return (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(value)}
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

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : items === null ? (
        <p aria-live="polite">טוען הצעות…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">אין הצעות להצגה</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            הצעות נשלחות ממסך <Link href="/matches" className="underline">ההתאמות</Link> או
            מכרטיס הנכס.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((offer) => {
            const colors = statusColors(offer.status);
            // נפתח יותר מפעם אחת ולא הגיב — הקונה מתלבט, וזה הרגע להתקשר
            const hesitating = offer.openCount >= 2 && offer.status === "opened";
            return (
              <li
                key={offer.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: hesitating ? "var(--color-primary)" : "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {offer.title}
                      {offer.priceAgorot !== undefined ? (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {" · "}
                          {formatPrice(offer.priceAgorot)}
                        </span>
                      ) : null}
                    </p>
                    <p style={{ color: "var(--color-text-muted)" }}>
                      <span aria-hidden="true">⇄ </span>
                      {offer.buyerName ?? "קונה של סוכן אחר"}
                      {offer.score !== undefined ? ` · התאמה ${offer.score}%` : ""}
                      {offer.sentAt ? ` · נשלח ${formatDate(offer.sentAt)}` : ""}
                    </p>
                    {offer.openCount > 0 ? (
                      <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                        נפתח {offer.openCount} פעמים
                        {hesitating ? (
                          <span className="ms-2 font-medium" style={{ color: "var(--color-primary)" }}>
                            ← הקונה מתלבט, שווה טלפון
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className="rounded-full px-3 py-1 text-sm font-medium"
                      style={{ background: colors.bg, color: colors.fg }}
                    >
                      {STATUS_LABELS[offer.status] ?? offer.status}
                    </span>
                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline"
                    >
                      דף ההצעה
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
