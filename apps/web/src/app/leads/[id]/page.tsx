"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { MATURITY_LABELS as SHARED_MATURITY } from "@metavchim/shared";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { formatDate, shekelsToAgorot, waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ContactPeople } from "../../contact-people";
import { DictateFor } from "../../dictation-field";
import { RelatedEntities } from "../../related-entities";

interface LeadDetail {
  id: string;
  contact: { id: string; name: string; phone: string };
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

/**
 * המרת ליד לקונה בלי לצאת מהעמוד: דרישות מינימליות (ערים, סוג עסקה,
 * תקציב) — והאדם נכנס למנוע ההתאמות. אותו contact, ההיסטוריה נשמרת.
 */
function ConvertSection({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConvert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(event.currentTarget);
    const budget = Number(String(f.get("budgetMax") ?? "").trim());
    try {
      const buyer = await apiPost<{ id: string }>(`/leads/${leadId}/convert`, {
        maturity: String(f.get("maturity")),
        requirements: {
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          budgetMaxAgorot: shekelsToAgorot(budget),
        },
      });
      router.push(`/buyers/${buyer.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "הליד כבר הומר, או שכבר קיים קונה פעיל לאיש קשר זה"
          : "ההמרה נכשלה — בדקו את הפרטים ונסו שוב",
      );
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-4">
        <Button onClick={() => setOpen(true)}>👤 המר לקונה</Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void onConvert(event)}
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 className="mb-3 text-lg font-semibold">המרה לקונה</h2>
      <div className="mb-3 flex flex-wrap gap-3">
        <div>
          <label htmlFor="cv-cities" className="mb-1 block text-sm font-medium">
            ערים (מופרדות בפסיק)
          </label>
          <input
            id="cv-cities"
            name="cities"
            required
            placeholder="תל אביב, גבעתיים"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>
        <div>
          <label htmlFor="cv-deal" className="mb-1 block text-sm font-medium">סוג עסקה</label>
          <select
            id="cv-deal"
            name="dealType"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <option value="sale">קנייה</option>
            <option value="rent">שכירות</option>
          </select>
        </div>
        <div>
          <label htmlFor="cv-budget" className="mb-1 block text-sm font-medium">
            תקציב מקסימלי (₪)
          </label>
          <input
            id="cv-budget"
            name="budgetMax"
            type="number"
            required
            min={1}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="cv-maturity" className="mb-1 block text-sm font-medium">בשלות</label>
          <select
            id="cv-maturity"
            name="maturity"
            defaultValue="interested"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {Object.entries(SHARED_MATURITY).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "ממיר…" : "המר לקונה"}</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </form>
  );
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  // אותה יכולת שמגינה על "המר לקונה" למטה — הרשאת עריכת לקוח
  const canEditPeople = can(user, "buyers.edit");
  // הגעה מטופס "ליד חדש" כשכבר היה ליד פתוח — השרת מיזג את הפנייה לכאן
  const merged = useSearchParams().get("merged") === "1";
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
        <a
          href={waMeUrl(lead.contact.phone)}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          💬 וואטסאפ
        </a>
      </div>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent} · מקור: {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
      </p>

      <RelatedEntities contactId={lead.contact.id} exclude={{ kind: "lead", id: lead.id }} />

      <ContactPeople contactId={lead.contact.id} canEdit={canEditPeople} />

      {merged ? (
        <p role="status" className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          ℹ️ לאיש הקשר כבר יש ליד פתוח — הפנייה החדשה נוספה לציר הזמן שלו במקום לפתוח ליד כפול.
        </p>
      ) : null}

      {lead.requiresHuman ? (
        <p role="alert" className="mb-4 rounded-xl border p-4 font-medium" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          ● דורש טיפול אנושי{lead.requiresHumanReason ? `: ${lead.requiresHumanReason}` : ""}
        </p>
      ) : null}

      <div className="mb-4">
        <Link href={`/calendar/new?leadId=${lead.id}`}>
          <Button variant="secondary">📅 קבע פגישה</Button>
        </Link>
      </div>

      {lead.status !== "converted" && can(user, "buyers.edit") ? (
        <ConvertSection leadId={lead.id} />
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
        {/* הערה אחרי שיחה היא הטקסט שהכי כדאי להכתיב — המתווך עדיין
            עם הטלפון ביד ולא ליד המקלדת */}
        <div className="mb-4">
          <DictateFor targetId="note" />
        </div>

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
