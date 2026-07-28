"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { api, apiGet } from "@/lib/api";

/**
 * גלריית תמונות הנכס: העלאה (עם טקסט חלופי — ת"י 5568), תמונה ראשית,
 * ומחיקה. התצוגה ב-URL חתום קצר-מועד מהאחסון — לא דרך ה-API.
 */

interface MediaItem {
  id: string;
  altText?: string;
  sortOrder: number;
  url: string;
}

const API_BASE = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001") + "/api/v1";

export function MediaSection({ propertyId, address }: { propertyId: string; address: string }) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [altText, setAltText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<MediaItem[]>(`/properties/${propertyId}/media`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [propertyId]);

  async function refresh(): Promise<void> {
    setItems(await apiGet<MediaItem[]>(`/properties/${propertyId}/media`));
  }

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (altText.trim() !== "") form.append("altText", altText.trim());
      // multipart — בלי Content-Type ידני; הדפדפן קובע boundary
      const res = await fetch(`${API_BASE}/properties/${propertyId}/media`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "ההעלאה נכשלה");
      }
      setAltText("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ההעלאה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(mediaId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/properties/${propertyId}/media/${mediaId}`, { method: "DELETE" });
      await refresh();
    } catch {
      setError("המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onMakePrimary(mediaId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/properties/${propertyId}/media/${mediaId}/primary`, { method: "POST" });
      await refresh();
    } catch {
      setError("העדכון נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="media-heading" className="mb-8">
      <h2 id="media-heading" className="mb-3 text-lg font-semibold">
        תמונות {items ? `(${items.length})` : ""}
      </h2>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1" style={{ minWidth: "220px", maxWidth: "420px" }}>
          <label htmlFor="media-alt" className="mb-1 block text-sm font-medium">
            תיאור התמונה (טקסט חלופי לנגישות)
          </label>
          <input
            id="media-alt"
            type="text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            maxLength={300}
            placeholder={`למשל: סלון הדירה ב${address || "נכס"}`}
            className="w-full rounded-md border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
        </div>
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 font-medium"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <span>{busy ? "מעלה…" : "📷 העלה תמונה"}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mv-visually-hidden"
            disabled={busy}
            onChange={onUpload}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p aria-live="polite">טוען תמונות…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          אין תמונות עדיין — נכס עם תמונות מקבל יותר פניות.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((m, index) => (
            <li
              key={m.id}
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: index === 0 ? "var(--color-primary)" : "var(--color-border)" }}
            >
              {/* img רגיל בכוונה: URL חתום זמני מהאחסון, לא לאופטימיזציית Next */}
              <img
                src={m.url}
                alt={m.altText ?? `תמונה ${index + 1} של ${address || "הנכס"}`}
                className="h-36 w-full object-cover"
              />
              <div className="flex items-center justify-between gap-1 p-2">
                {index === 0 ? (
                  <span className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>
                    ★ ראשית
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onMakePrimary(m.id)}
                    disabled={busy}
                    className="text-sm underline"
                  >
                    הפוך לראשית
                  </button>
                )}
                <Button variant="danger" onClick={() => onDelete(m.id)} disabled={busy}>
                  מחק<span className="mv-visually-hidden"> את {m.altText ?? `תמונה ${index + 1}`}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
