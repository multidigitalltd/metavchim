"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/gu, "");
  if (digits.startsWith("+972")) return digits;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return digits;
}

export default function NewLeadPage() {
  useRequireAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // הפנייה מוזגה לליד פתוח של סוכן אחר — אין לאן לנווט (view_own), רק מיידעים
  const [mergedNotice, setMergedNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    try {
      const created = await apiPost<{ id: string; merged?: boolean; visible?: boolean }>("/leads", {
        contactName: String(f.get("contactName")).trim(),
        contactPhone: normalizePhone(String(f.get("contactPhone"))),
        source: String(f.get("source")),
        intent: String(f.get("intent")),
        summary: String(f.get("summary") ?? "").trim() || undefined,
      });
      if (created.merged && created.visible === false) {
        // הליד הפתוח שייך לסוכן אחר — הפנייה נוספה אצלו והוא קיבל התראה
        setMergedNotice(true);
        setSubmitting(false);
        return;
      }
      // ליד פתוח כבר קיים לאיש הקשר — השרת מיזג את הפנייה אליו במקום לפצל
      router.replace(created.merged ? `/leads/${created.id}?merged=1` : `/leads/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הליד נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">ליד חדש</h1>
      <form onSubmit={onSubmit} noValidate>
        {mergedNotice ? (
          <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            ℹ️ לאיש הקשר כבר יש ליד פתוח אצל סוכן אחר במשרד — הפנייה נוספה לציר הזמן של הליד שלו והוא קיבל
            התראה. אין צורך לפתוח ליד חדש.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contactName" className="mb-1 block font-medium">שם מלא *</label>
            <input id="contactName" name="contactName" required minLength={2} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="contactPhone" className="mb-1 block font-medium">טלפון *</label>
            <input id="contactPhone" name="contactPhone" type="tel" required dir="ltr" placeholder="050-1234567" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="intent" className="mb-1 block font-medium">מה הוא רוצה?</label>
            <select id="intent" name="intent" defaultValue="buy" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="buy">לקנות</option>
              <option value="sell">למכור</option>
              <option value="rent_in">לשכור</option>
              <option value="rent_out">להשכיר</option>
              <option value="info">מתעניין</option>
              <option value="unknown">עוד לא ברור</option>
            </select>
          </div>
          <div>
            <label htmlFor="source" className="mb-1 block font-medium">מקור</label>
            <select id="source" name="source" defaultValue="voice_call" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="voice_call">שיחה</option>
              <option value="whatsapp">וואטסאפ</option>
              <option value="referral">המלצה</option>
              <option value="web_form">אתר</option>
              <option value="manual">אחר</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="summary" className="mb-1 block font-medium">סיכום הפנייה</label>
          <textarea id="summary" name="summary" rows={3} maxLength={2000} placeholder="מה הוא סיפר? מה סוכם?" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="summary" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>{submitting ? "שומר…" : "שמור ליד"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>ביטול</Button>
        </div>
      </form>
    </div>
  );
}
