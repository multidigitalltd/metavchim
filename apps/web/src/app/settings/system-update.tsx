"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";

interface SystemInfo {
  version: string;
  updateAvailable: boolean;
}

/**
 * "עדכון בלחיצת כפתור" — מוצג לבעלי settings.manage בלבד. הכפתור פעיל
 * רק כשסוכן העדכון מוגדר בסביבה (פרודקשן); בפיתוח רואים רק את הגרסה.
 */
export function SystemUpdateSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SystemInfo>("/settings/system")
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  if (!info) return null;

  const update = () => {
    if (!window.confirm("לעדכן את המערכת לגרסה האחרונה? השירות יתרענן למשך כדקה.")) return;
    setBusy(true);
    setMessage(null);
    apiPost<{ status: string }>("/settings/system/update", {})
      .then(() => {
        setMessage("העדכון הופעל — המערכת מושכת את הגרסה החדשה ותתרענן תוך כדקה. רעננו את הדף.");
      })
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : "העדכון נכשל — נסו שוב");
        setBusy(false);
      });
  };

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="system-update-title"
    >
      <h2 id="system-update-title" className="mb-2 text-lg font-semibold">
        מערכת
      </h2>
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        גרסה מותקנת: <code dir="ltr">{info.version.slice(0, 12)}</code>
      </p>
      {info.updateAvailable ? (
        <div className="mt-3">
          <Button onClick={update} disabled={busy}>
            {busy ? "מעדכן…" : "משוך ועדכן לגרסה האחרונה"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
          עדכון מרחוק זמין רק בסביבת הפרודקשן (ראו docs/10-deployment.md)
        </p>
      )}
      {message && (
        <p className="mt-2 text-sm" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
