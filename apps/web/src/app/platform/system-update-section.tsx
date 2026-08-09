"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";

interface SystemInfo {
  version: string;
  updateAvailable: boolean;
}

/**
 * עדכון גרסה — **בעל הפלטפורמה בלבד**.
 *
 * העדכון מרים מחדש את השירות כולו, ולכן הוא חל בבת אחת על כל המשרדים
 * שרצים על השרת. מנהל משרד יחיד לא אמור להחזיק בכפתור כזה; המשתמשים
 * האחרים מקבלים רק את באנר "מה חדש" אחרי שהעדכון כבר עלה.
 */
export function SystemUpdateSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SystemInfo>("/platform/system")
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  if (!info) return null;

  function update(): void {
    if (
      !window.confirm(
        "לעדכן את המערכת לגרסה האחרונה?\n\nהעדכון חל על כל המשרדים במערכת, והשירות יתרענן למשך כדקה.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    apiPost<{ status: string }>("/platform/system/update", {})
      .then(() => {
        setMessage(
          "העדכון הופעל — המערכת מושכת את הגרסה החדשה ותתרענן תוך כדקה. רעננו את הדף.",
        );
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "העדכון נכשל — נסו שוב");
        setBusy(false);
      });
  }

  /**
   * עדכון סוכן העדכון עצמו.
   *
   * הסוכן אינו מתעדכן עם המערכת — הוא מריץ את פקודת ההרמה, ואינו
   * יכול להרים את עצמו בלי להסתכן בהריגת התהליך באמצע. עד כה זו
   * הייתה פקודה שמדביקים ב-SSH; עכשיו הוא מעביר את ההחלפה לקונטיינר
   * עזר חד-פעמי, ומכאן זה כפתור.
   *
   * הוא נשאר **נפרד** מ"עדכן לגרסה האחרונה": כישלון בהחלפת הסוכן
   * לא אמור להפיל עדכון מערכת תקין.
   */
  function updateAgent(): void {
    if (
      !window.confirm(
        "לעדכן את סוכן העדכון?\n\nהסוכן יוחלף תוך כמה שניות. המערכת עצמה אינה מושפעת.",
      )
    ) {
      return;
    }
    setAgentBusy(true);
    setMessage(null);
    setError(null);
    apiPost<{ status: string }>("/platform/system/update-agent", {})
      .then(() => {
        setMessage("סוכן העדכון מתחלף — המתינו כמה שניות ורעננו. המערכת עצמה ממשיכה לרוץ.");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "עדכון הסוכן נכשל");
      })
      .finally(() => setAgentBusy(false));
  }

  return (
    <section aria-labelledby="platform-system-heading" className="mb-8">
      <h2 id="platform-system-heading" className="mb-1 text-lg font-semibold">
        גרסת המערכת
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        העדכון חל על כל המשרדים בפלטפורמה בבת אחת. המשתמשים לא צריכים לעשות דבר —
        הם יראו באנר "מה חדש" בכניסה הבאה.
      </p>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          גרסה מותקנת: <code dir="ltr">{info.version.slice(0, 12)}</code>
        </p>
        {info.updateAvailable ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={update} disabled={busy || agentBusy}>
              {busy ? "מעדכן…" : "משוך ועדכן לגרסה האחרונה"}
            </Button>
            {/*
              נפרד ומשני: הסוכן מתעדכן לעיתים רחוקות, ורק כשפעולה
              חדשה מוחזרת ממנו כ-404 ("הסוכן ישן מהמערכת").
            */}
            <Button variant="ghost" onClick={updateAgent} disabled={busy || agentBusy}>
              {agentBusy ? "מחליף…" : "עדכן את סוכן העדכון"}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            עדכון מרחוק זמין רק בסביבת הפרודקשן (ראו docs/10-deployment.md)
          </p>
        )}
        {message ? (
          <p className="mt-2 text-sm" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm" role="alert" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
