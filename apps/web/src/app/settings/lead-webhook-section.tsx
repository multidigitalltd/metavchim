"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * "לידים מהאתר שלך" — כמה מקורות קליטה, מפתח לכל אחד.
 *
 * כל מקור מקבל שם ("אתר", "פייסבוק"...) שנכנס כ-source של הליד, כך
 * שברשימת הלידים רואים מאיפה כל פנייה הגיעה. הכתובת נמסרת לבונה
 * האתר / מוגדרת בכלי האוטומציה — שולחים אליה POST עם ‎name, phone,
 * message. (טופס ההטמעה המוכן הוסר לבקשת המשתמש.)
 */

interface LeadWebhook {
  id: string;
  key: string;
  sourceLabel: string;
}

const SOURCE_SUGGESTIONS = ["אתר", "פייסבוק", "אינסטגרם", "יד2", "מדלן", "גוגל"];

export function LeadWebhookSection() {
  const [hooks, setHooks] = useState<LeadWebhook[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<LeadWebhook[]>("/settings/lead-webhooks")
      .then(setHooks)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  function endpointFor(key: string): string {
    return `${window.location.origin}${API_BASE}/public/leads/${key}`;
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("sourceLabel") ?? "").trim();
    if (label.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/settings/lead-webhooks", { sourceLabel: label });
      form.reset();
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת המקור נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/settings/lead-webhooks/${id}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function copy(hook: LeadWebhook): Promise<void> {
    await navigator.clipboard.writeText(endpointFor(hook.key)).catch(() => undefined);
    setCopiedId(hook.id);
    setTimeout(() => setCopiedId(null), 3000);
  }

  return (
    <section aria-labelledby="webhook-heading" className="mv-list-card px-5 py-[17px]">
      <h2 id="webhook-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>מקורות לידים</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל מקור מקבל כתובת קליטה משלו, והשם שלו מופיע על הליד — כך רואים אם
        הפנייה הגיעה מהאתר, מפייסבוק או מכל ערוץ אחר. שולחים לכתובת POST עם
        השדות <code dir="ltr">name, phone, email, message, intent</code> (כולל זיהוי
        פנייה חוזרת ומניעת כפילויות).
        {/*
          הקישור לתיעוד כאן ולא במסך נפרד: זו הנקודה שבה מישהו מחזיק
          כתובת ולא יודע מה לעשות איתה. בלעדיו התיעוד קיים ואיש אינו
          מגיע אליו.
        */}
        {" "}
        <a href="/docs/api" target="_blank" rel="noopener" className="underline" style={{ color: "var(--color-primary)" }}>
          תיעוד מלא, כולל חיבור דרך Make ו-n8n ←
        </a>
      </p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את מקורות הקליטה" onRetry={load} />
      ) : hooks === null ? (
        <p aria-live="polite" className="m-0 text-sm">טוען…</p>
      ) : (
        <>
          {hooks.length > 0 ? (
            <ul className="m-0 mb-4 flex list-none flex-col gap-3 p-0">
              {hooks.map((hook) => (
                <li
                  key={hook.id}
                  className="rounded-xl border p-3"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-bold">{hook.sourceLabel}</span>
                    <button
                      type="button"
                      className="mv-btn-plain ms-auto"
                      onClick={() => void copy(hook)}
                    >
                      העתק כתובת
                    </button>
                    {copiedId === hook.id ? (
                      <span role="status" className="text-sm" style={{ color: "var(--color-success)" }}>✓ הועתקה</span>
                    ) : null}
                    <button
                      type="button"
                      className="mv-btn-plain"
                      style={{ color: "var(--color-danger)" }}
                      disabled={busy}
                      onClick={() => void remove(hook.id)}
                    >
                      {confirmDeleteId === hook.id ? "לאשר מחיקה? הטופס שמצביע לכאן יפסיק לעבוד" : "מחק"}
                    </button>
                    {confirmDeleteId === hook.id ? (
                      <button type="button" className="mv-btn-plain" onClick={() => setConfirmDeleteId(null)}>
                        ביטול
                      </button>
                    ) : null}
                  </div>
                  <p
                    className="m-0 overflow-x-auto rounded-lg border p-2 font-mono text-sm"
                    dir="ltr"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  >
                    {endpointFor(hook.key)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              עדיין אין מקורות קליטה — צרו את הראשון:
            </p>
          )}

          <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="lw-source" className="mb-1 block text-sm font-semibold">
                שם המקור החדש
              </label>
              <input
                id="lw-source"
                name="sourceLabel"
                list="lw-source-suggestions"
                required
                minLength={2}
                maxLength={20}
                placeholder="למשל: פייסבוק"
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              />
              <datalist id="lw-source-suggestions">
                {SOURCE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "יוצר…" : "צור מקור קליטה"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
