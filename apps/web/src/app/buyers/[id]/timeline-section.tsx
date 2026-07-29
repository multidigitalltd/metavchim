"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost } from "@/lib/api";

/**
 * ציר ההיסטוריה של הקונה (docs/01 §5): כל הערה ותיעוד שיחה במקום אחד —
 * מתווך שני שפותח את הקונה יודע בדיוק איפה הדברים עומדים.
 */

interface Interaction {
  id: string;
  kind: string;
  direction?: string;
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

const timeFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

export function TimelineSection({ buyerId }: { buyerId: string }) {
  const [items, setItems] = useState<Interaction[] | null>(null);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<"note" | "call">("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Interaction[]>(`/buyers/${buyerId}/interactions`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [buyerId]);

  async function onAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (content.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/buyers/${buyerId}/interactions`, { kind, content: content.trim() });
      setContent("");
      setItems(await apiGet<Interaction[]>(`/buyers/${buyerId}/interactions`));
    } catch {
      setError("שמירת התיעוד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="timeline-heading" className="mb-8">
      <h2 id="timeline-heading" className="mb-3 text-lg font-semibold">
        היסטוריה {items ? `(${items.length})` : ""}
      </h2>

      <form onSubmit={onAdd} className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="int-kind" className="mb-1 block text-sm font-medium">סוג</label>
          <select
            id="int-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "note" | "call")}
            className="rounded-md border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <option value="note">הערה</option>
            <option value="call">שיחה</option>
          </select>
        </div>
        <div className="flex-1" style={{ minWidth: "220px" }}>
          <label htmlFor="int-content" className="mb-1 block text-sm font-medium">
            תיעוד חדש
          </label>
          <input
            id="int-content"
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={4000}
            placeholder='למשל: "דיברנו — מחפש כניסה מיידית, גמיש בתקציב עד 2.7"'
            className="w-full rounded-md border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
        </div>
        <Button type="submit" disabled={busy || content.trim() === ""}>
          הוסף
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p aria-live="polite">טוען היסטוריה…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          אין תיעוד עדיין — כל הערה שתוסיפו תישמר כאן לצמיתות.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {KIND_LABELS[i.kind] ?? i.kind}
                {i.direction ? (i.direction === "in" ? " · נכנסת" : " · יוצאת") : ""}
                {" · "}
                {timeFmt.format(new Date(i.createdAt))}
              </p>
              <p className="whitespace-pre-wrap">{i.content}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
