"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";

interface LeadRow {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  createdAt: string;
}

export default function LeadsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: LeadRow[] }>("/leads?limit=100")
      .then((res) =>
        setItems(
          [...res.items].sort((a, b) => Number(b.requiresHuman) - Number(a.requiresHuman)),
        ),
      )
      .catch(() => setError("טעינת הלידים נכשלה"));
  }, [authLoading]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">לידים</h1>
        <Link href="/leads/new">
          <Button>➕ ליד חדש</Button>
        </Link>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען לידים…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-3 text-lg font-semibold">אין לידים פתוחים</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            כשיתחברו הוואטסאפ והסוכן הקולי — לידים ייכנסו לכאן אוטומטית.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((lead) => (
            <li
              key={lead.id}
              className="rounded-xl border p-4"
              style={{
                borderColor: lead.requiresHuman ? "var(--color-danger)" : "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    {lead.requiresHuman ? (
                      <span style={{ color: "var(--color-danger)" }}>● דורש טיפול אנושי — </span>
                    ) : null}
                    <Link href={`/leads/${lead.id}`} className="underline">
                      {lead.contact.name}
                    </Link>
                  </h2>
                  <p style={{ color: "var(--color-text-muted)" }}>
                    {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent} · מקור:{" "}
                    {LEAD_SOURCE_LABELS[lead.source] ?? lead.source} · {formatDate(lead.createdAt)}
                  </p>
                </div>
                <span
                  className="rounded-full border px-3 py-1 text-sm font-medium"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
