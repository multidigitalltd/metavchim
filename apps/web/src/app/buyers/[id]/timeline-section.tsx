"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { ROLE_CAPABILITIES } from "@metavchim/shared";
import { apiGet, apiPost } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { WithDictation } from "../../dictation-field";

/**
 * ציר ההיסטוריה של הקונה (docs/01 §5): כל הערה ותיעוד שיחה במקום אחד —
 * מתווך שני שפותח את הקונה יודע בדיוק איפה הדברים עומדים. מעומד Cursor;
 * טופס ההוספה מוצג רק למי שמחזיק buyers.edit (ביקורת Codex, PR #16).
 */

interface Interaction {
  id: string;
  kind: string;
  direction?: string;
  content: string;
  createdAt: string;
}

interface InteractionsPage {
  items: Interaction[];
  nextCursor: string | null;
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
  const { user } = useRequireAuth();
  const [items, setItems] = useState<Interaction[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<"note" | "call">("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit =
    user !== null && (ROLE_CAPABILITIES[user.role] ?? []).includes("buyers.edit");

  useEffect(() => {
    apiGet<InteractionsPage>(`/buyers/${buyerId}/interactions`)
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => setItems([]));
  }, [buyerId]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const page = await apiGet<InteractionsPage>(
        `/buyers/${buyerId}/interactions?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("טעינת המשך ההיסטוריה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (content.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/buyers/${buyerId}/interactions`, { kind, content: content.trim() });
      setContent("");
      const page = await apiGet<InteractionsPage>(`/buyers/${buyerId}/interactions`);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError("שמירת התיעוד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="timeline-heading" className="mb-8">
      <h2 id="timeline-heading" className="mb-3 text-lg font-semibold">
        היסטוריה {items ? `(${items.length}${nextCursor ? "+" : ""})` : ""}
      </h2>

      {canEdit ? (
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
            <WithDictation value={content} onChange={setContent}>
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
            </WithDictation>
          </div>
          <Button type="submit" disabled={busy || content.trim() === ""}>
            הוסף
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p aria-live="polite">טוען היסטוריה…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          אין תיעוד עדיין{canEdit ? " — כל הערה שתוסיפו תישמר כאן לצמיתות" : ""}.
        </p>
      ) : (
        <>
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
          {nextCursor ? (
            <div className="mt-3">
              <Button variant="secondary" onClick={loadMore} disabled={busy}>
                {busy ? "טוען…" : "הצג היסטוריה ישנה יותר"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
