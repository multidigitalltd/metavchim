"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";

/**
 * ייצוא נתונים (docs/08): הנתונים שייכים למשרד — הורדת CSV בכותרות
 * עבריות שניתן לייבא חזרה. ההורדה ב-fetch עם עוגיית ה-Session (קישור
 * ישיר לא נושא אותה בכל דפדפן), והקובץ נמסר כ-Blob.
 */

const API_BASE = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001") + "/api/v1";

export function ExportSection() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(path: string, filename: string): Promise<void> {
    setBusy(filename);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(res.status === 403 ? "אין הרשאת ייצוא" : "הייצוא נכשל");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "הייצוא נכשל");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="export-heading" className="mb-8">
      <h2 id="export-heading" className="mb-1 text-lg font-semibold">ייצוא נתונים</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הנתונים שייכים למשרד. הקבצים בעברית, נפתחים באקסל וניתנים לייבוא חזרה. כל ייצוא
        מתועד ביומן הפעילות.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => download("/export/properties.csv", "properties.csv")}
        >
          {busy === "properties.csv" ? "מוריד…" : "⬇️ ייצוא נכסים (CSV)"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => download("/export/buyers.csv", "buyers.csv")}
        >
          {busy === "buyers.csv" ? "מוריד…" : "⬇️ ייצוא קונים (CSV)"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
