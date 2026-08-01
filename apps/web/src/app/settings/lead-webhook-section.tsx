"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiPost } from "@/lib/api";

/**
 * "לידים מהאתר שלך" — מפתח קליטה ייעודי למשרד + קוד מוכן להדבקה.
 * כל שליחת טופס באתר המשרד הופכת לליד במערכת (עם מניעת כפילויות).
 */
export function LeadWebhookSection({ initialKey }: { initialKey?: string }) {
  const [key, setKey] = useState<string | undefined>(initialKey);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const endpoint = key ? `${window.location.origin}${API_BASE}/public/leads/${key}` : null;

  const snippet = endpoint
    ? `<form onsubmit="event.preventDefault();
  fetch('${endpoint}', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      name: this.name.value,
      phone: this.phone.value,
      message: this.message.value,
      pageUrl: location.href,
      website: this.website.value
    })
  }).then(function(){ alert('תודה! נחזור אליכם בהקדם.'); });">
  <input name="name" placeholder="שם מלא" required minlength="2">
  <input name="phone" type="tel" placeholder="טלפון" required>
  <textarea name="message" placeholder="במה נוכל לעזור?"></textarea>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">שלחו לי פרטים</button>
</form>`
    : null;

  async function generate() {
    if (key && !confirmRegen) {
      setConfirmRegen(true);
      return;
    }
    setConfirmRegen(false);
    setBusy(true);
    try {
      const result = await apiPost<{ key: string }>("/settings/lead-webhook", {});
      setKey(result.key);
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <section aria-labelledby="webhook-heading" className="mb-8">
      <h2 id="webhook-heading" className="mb-1 text-lg font-semibold">לידים מהאתר שלך</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל שליחת טופס באתר המשרד נכנסת לכאן כליד אוטומטית — כולל זיהוי פנייה
        חוזרת ומניעת כפילויות.
      </p>

      {!key ? (
        <Button onClick={() => void generate()} disabled={busy}>
          {busy ? "מפעיל…" : "🔗 הפעל קליטת לידים מהאתר"}
        </Button>
      ) : (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-1 font-medium">כתובת הקליטה של המשרד:</p>
          <p className="mb-3 overflow-x-auto rounded-lg border p-2 font-mono text-sm" dir="ltr" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            {endpoint}
          </p>
          <p className="mb-1 font-medium">קוד מוכן להדבקה באתר (או למסירה לבונה האתר):</p>
          <pre className="mb-3 max-h-48 overflow-auto rounded-lg border p-2 text-xs" dir="ltr" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            {snippet}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void copySnippet()}>
              📋 העתק קוד
            </Button>
            {copied ? <span role="status" style={{ color: "var(--color-success)" }}>✓ הועתק</span> : null}
            <Button variant={confirmRegen ? "danger" : "ghost"} onClick={() => void generate()} disabled={busy}>
              {confirmRegen ? "לאשר חידוש? הטופס הקיים באתר יפסיק לעבוד" : "חדש מפתח"}
            </Button>
            {confirmRegen ? (
              <Button variant="ghost" onClick={() => setConfirmRegen(false)}>ביטול</Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
