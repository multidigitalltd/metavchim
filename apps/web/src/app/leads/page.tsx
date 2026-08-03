"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { compareLeadsByUrgency, leadWaiting, type LeadWaitingLevel } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatDate, waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import { CapNote, FilterSelect, ResultsCount, SearchField, textMatches } from "../list-controls";

interface LeadRow {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  createdAt: string;
}

const WAITING_COLOR: Record<LeadWaitingLevel, string> = {
  ok: "var(--color-text-muted)",
  warn: "var(--color-text)",
  late: "var(--color-danger)",
};

export default function LeadsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [intent, setIntent] = useState("");
  // שעון קפוא לרינדור — כדי שכל השורות ימדדו מול אותו רגע
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: LeadRow[] }>("/leads?limit=100")
      .then((res) => {
        setItems([...res.items].sort(compareLeadsByUrgency));
        setNow(new Date());
      })
      .catch(() => setError("טעינת הלידים נכשלה"));
  }, [authLoading]);

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (l) =>
          textMatches(query, l.contact.name, l.contact.phone) &&
          (!status || l.status === status) &&
          (!intent || l.intent === intent),
      ),
    [items, query, status, intent],
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">לידים</h1>
        <div className="flex gap-2">
          <Link href="/leads/voice">
            <Button>🎤 ליד בקול</Button>
          </Link>
          <Link href="/leads/new">
            <Button variant="secondary">➕ ליד חדש</Button>
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען לידים…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-3 text-lg font-semibold">אין לידים פתוחים</p>
          {/* לא מבטיחים כאן פיצ'רים שטרם נבנו — מפנים למה שאפשר להפעיל
              עכשיו: חיבור טופס הלידים מאתר המשרד */}
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            אפשר להוסיף ליד ידנית או בקול — וגם לחבר את טופס יצירת הקשר
            שבאתר המשרד, כך שכל פנייה תיכנס לכאן אוטומטית.
          </p>
          <Link href="/settings">
            <Button variant="secondary">חיבור לידים מהאתר</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchField
              label="חיפוש ליד"
              placeholder="🔍 שם או טלפון"
              value={query}
              onChange={setQuery}
            />
            <FilterSelect
              label="סינון לפי סטטוס"
              value={status}
              onChange={setStatus}
              allLabel="כל הסטטוסים"
              options={Object.entries(LEAD_STATUS_LABELS)}
            />
            <FilterSelect
              label="סינון לפי כוונה"
              value={intent}
              onChange={setIntent}
              allLabel="כל הכוונות"
              options={Object.entries(LEAD_INTENT_LABELS)}
            />
            <ResultsCount shown={visible.length} total={items.length} noun="לידים" />
          </div>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף ליד לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setIntent("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((lead) => {
            const waiting = now ? leadWaiting(lead.createdAt, lead.status, now) : null;
            return (
              <li
                key={lead.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor:
                    lead.requiresHuman || waiting?.level === "late"
                      ? "var(--color-danger)"
                      : "var(--color-border)",
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
                    {/* זמן ההמתנה ולא רק התאריך: "ממתין יומיים" הוא קריאה
                        לפעולה, "3 בפברואר" הוא רק מידע (docs/01 §7) */}
                    {waiting ? (
                      <p className="font-medium" style={{ color: WAITING_COLOR[waiting.level] }}>
                        {waiting.level === "late" ? "⏰ " : ""}
                        {waiting.label}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className="rounded-full border px-3 py-1 text-sm font-medium"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                  </span>
                </div>

                {/* חזרה ללקוח היא הפעולה של המסך הזה — בלי להיכנס לכרטיס */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a href={`tel:${lead.contact.phone}`} className="font-medium underline">
                    📞 חייג
                  </a>
                  <a
                    href={waMeUrl(lead.contact.phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    💬 וואטסאפ
                  </a>
                  <span dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                    {lead.contact.phone}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
          )}
          <CapNote
            show={(query.trim() !== "" || status !== "" || intent !== "") && items.length === 100}
            noun="לידים"
          />
        </>
      )}
    </>
  );
}
