"use client";

import { useEffect, useRef, useState } from "react";
import { api, apiGet } from "@/lib/api";
import { IconCamera, IconStar } from "../../icons";
import { Notice } from "../../notice";

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
  /** "3/12" בזמן העלאה מרובה — שידעו שמשהו קורה ומה נשאר */
  const [progress, setProgress] = useState<string | null>(null);
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
    /*
     * כל הקבצים שנבחרו, לא רק הראשון. סוכן חוזר מצילום נכס עם
     * עשרים תמונות, והעלאה אחת-אחת היא עשרים סבבים של "בחר קובץ"
     * (דיווח המשתמש). ההעלאה עצמה נשארת סדרתית: נקודת הקצה מקבלת
     * קובץ אחד, וסדר ההעלאה הוא סדר התצוגה — מקביליות הייתה
     * מערבבת אותו.
     */
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const [index, file] of files.entries()) {
        if (files.length > 1) setProgress(`${index + 1}/${files.length}`);
        const form = new FormData();
        form.append("file", file);
        // התיאור החופשי שייך לתמונה בודדת; בהעלאה מרובה הוא מוצמד
        // לראשונה בלבד — לשאר עורכים תיאור פרטני אחרי ההעלאה
        if (index === 0 && altText.trim() !== "") form.append("altText", altText.trim());
        // multipart — בלי Content-Type ידני; הדפדפן קובע boundary
        const res = await fetch(`${API_BASE}/properties/${propertyId}/media`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(
            files.length > 1
              ? `${body?.message ?? "ההעלאה נכשלה"} (תמונה ${index + 1} מתוך ${files.length}; הקודמות הועלו)`
              : (body?.message ?? "ההעלאה נכשלה"),
          );
        }
      }
      setAltText("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ההעלאה נכשלה");
      // מה שכבר הועלה מוצג — רענון גם בכשל חלקי
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
      setProgress(null);
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
          <span>{busy ? `מעלה…${progress === null ? "" : ` ${progress}`}` : <><IconCamera s={15} /> העלאת תמונות</>}</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="mv-visually-hidden"
            disabled={busy}
            onChange={onUpload}
          />
        </label>
      </div>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {items === null ? (
        <p aria-live="polite">טוען תמונות…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          אין תמונות עדיין — נכס עם תמונות מקבל יותר פניות.
        </p>
      ) : (
        /*
         * רוחב מינימלי לתא ולא מספר עמודות קבוע: הסעיף יושב גם בטור
         * צדדי צר, ושם grid-cols-2 ייצר תאים של ~150px — התמונה
         * נמתחה, והכפתורים לא נכנסו לשורה ונחתכו ע"י overflow-hidden.
         * auto-fill מוריד לעמודה אחת במקום לדחוס שתיים.
         */
        <ul className="m-0 grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {items.map((m, index) => (
            <li
              key={m.id}
              className="overflow-hidden rounded-xl border"
              style={{
                borderColor: index === 0 ? "var(--color-primary)" : "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              {/*
                יחס קבוע ולא גובה קבוע — תמונה לאורך ותמונה לרוחב
                מקבלות מסגרת זהה, והרשת נראית מסודרת בלי קשר למה
                שהמתווך צילם בטלפון.
              */}
              {/* img רגיל בכוונה: מוזרם דרך ה-API (העוגייה נשלחת same-site) */}
              <img
                src={API_BASE + m.url}
                alt={m.altText ?? `תמונה ${index + 1} של ${address || "הנכס"}`}
                className="block aspect-[4/3] w-full object-cover"
                style={{ background: "var(--color-bg)" }}
              />
              <div className="flex flex-wrap items-center justify-between gap-1.5 p-2">
                {index === 0 ? (
                  <span
                    className="mv-chip"
                    style={{
                      cursor: "default",
                      padding: "2px 9px",
                      fontSize: 14,
                      color: "var(--color-primary)",
                    }}
                  >
                    <IconStar s={13} /> ראשית
                  </span>
                ) : (
                  /*
                   * כפתורים ולא קישורי טקסט: הטקסט לבדו משאיר יעד מגע
                   * בגודל התווים בלבד, ומחיקה בטעות במגע היא הרסנית
                   * (ביקורת Codex). mv-btn-plain נותן ריפוד ומסגרת,
                   * ו-min-height מבטיח יעד נוח גם בגופן קטן.
                   */
                  <button
                    type="button"
                    onClick={() => onMakePrimary(m.id)}
                    disabled={busy}
                    className="mv-btn-plain"
                    style={{ minHeight: 32, padding: "5px 10px", fontSize: 14 }}
                  >
                    הפוך לראשית
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(m.id)}
                  disabled={busy}
                  className="mv-btn-plain mv-btn-plain--danger"
                  style={{ minHeight: 32, padding: "5px 10px", fontSize: 14 }}
                >
                  מחק<span className="mv-visually-hidden"> את {m.altText ?? `תמונה ${index + 1}`}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
