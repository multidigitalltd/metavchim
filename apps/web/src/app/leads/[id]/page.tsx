"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";

interface LeadDetail {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
  summary?: string;
}

interface TimelineItem {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  note: "📝 הערה",
  call: "📞 שיחה",
  whatsapp: "💬 וואטסאפ",
  status_change: "🔄 שינוי סטטוס",
  system: "⚙️ מערכת",
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ lead: LeadDetail; timeline: TimelineItem[] }>(`/leads/${id}`)
      .then((res) => {
        setLead(res.lead);
        setTimeline(res.timeline);
      })
      .catch(() => setError("הליד לא נמצא"));
  }, [authLoading, id]);

  async function changeStatus(status: string) {
    await apiPatch(`/leads/${id}/status`, { status });
    setLead((prev) => (prev ? { ...prev, status, requiresHuman: false } : prev));
    setTimeline((prev) => [
      { id: `local-${status}`, kind: "status_change", content: status, createdAt: new Date().toISOString() },
      ...prev,
    ]);
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("note") ?? "").trim();
    if (!content) return;
    const created = await apiPost<TimelineItem>(`/leads/${id}/notes`, { content });
    setTimeline((prev) => [created, ...prev]);
    form.reset();
  }

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/leads" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!lead) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/leads" className="underline">לידים</Link>
        <span aria-hidden="true"> / </span>
        <span>{lead.contact.name}</span>
      </nav>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{lead.contact.name}</h1>
        <a href={`tel:${lead.contact.phone}`} className="underline" dir="ltr">
          {lead.contact.phone}
        </a>
      </div>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent} · מקור: {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
      </p>

      {lead.requiresHuman ? (
        <p role="alert" className="mb-4 rounded-xl border p-4 font-medium" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          ● דורש טיפול אנושי{lead.requiresHumanReason ? `: ${lead.requiresHumanReason}` : ""}
        </p>
      ) : null}

      <div className="mb-8">
        <label htmlFor="status" className="mb-1 block font-medium">סטטוס</label>
        <select
          id="status"
          value={lead.status}
          onChange={(event) => void changeStatus(event.target.value)}
          className="rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="mb-3 text-lg font-semibold">ציר זמן</h2>

        <form onSubmit={(event) => void addNote(event)} className="mb-4 flex gap-2">
          <label htmlFor="note" className="mv-visually-hidden">הוספת הערה</label>
          <input
            id="note"
            name="note"
            placeholder="הוסף הערה…"
            className="flex-1 rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          <Button type="submit" variant="secondary">הוסף</Button>
        </form>

        {timeline.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>אין עדיין פעילות בליד.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.map((item) => (
              <li key={item.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {KIND_LABELS[item.kind] ?? item.kind} · {formatDate(item.createdAt)}
                </p>
                <p>
                  {item.kind === "status_change"
                    ? `הסטטוס שונה ל: ${LEAD_STATUS_LABELS[item.content] ?? item.content}`
                    : item.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
