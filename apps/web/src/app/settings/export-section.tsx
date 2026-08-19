"use client";

import { useState } from "react";
import { Notice } from "../notice";

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
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          className="mv-btn-plain flex-1 text-center"
          style={{ padding: "8px 0", fontSize: 14.5 }}
          disabled={busy !== null}
          onClick={() => download("/export/properties.csv", "properties.csv")}
        >
          {busy === "properties.csv" ? "מוריד…" : "ייצוא נכסים"}
        </button>
        <button
          type="button"
          className="mv-btn-plain flex-1 text-center"
          style={{ padding: "8px 0", fontSize: 14.5 }}
          disabled={busy !== null}
          onClick={() => download("/export/buyers.csv", "buyers.csv")}
        >
          {busy === "buyers.csv" ? "מוריד…" : "ייצוא קונים"}
        </button>
      </div>
      <p className="m-0 mt-[9px] text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        קבצים בעברית שנפתחים באקסל וניתנים לייבוא חזרה. כל ייצוא מתועד ביומן הפעילות.
      </p>
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
    </div>
  );
}
