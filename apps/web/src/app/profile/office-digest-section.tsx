"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "@/lib/api";
import { Notice } from "../notice";

/**
 * ‎**הסיכום החודשי שלי — מתג אישי, לא של המשרד.**
 *
 * ## ‏למה זה כאן ולא בהגדרות המשרד
 *
 * ‏הסיכום הוא על הסוכן עצמו ונשלח לטלפון שלו, ולכן הבחירה היא שלו.
 * ‏מתג בהגדרות המשרד היה נותן למנהל לכבות בשם סוכן, וזו בדיוק
 * ‏ההפרדה שביטול הצטרפות קיים כדי לשמור.
 *
 * ## ‏מה נשאר דולק גם אחרי כיבוי
 *
 * ‎**ההתראה בפעמון.** הכיבוי הוא של ההודעה שמגיעה לטלפון, לא של
 * ‏המידע: מי שלא רוצה הודעה בוואטסאפ עדיין רואה את הסיכום שלו
 * ‏במערכת. הסתרה של שניהם הייתה מוחקת מידע ולא משתיקה רעש.
 */
export function OfficeDigestSection(): React.ReactNode {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ enabled: boolean }>("/settings/office-digest")
      .then((res) => {
        if (!cancelled) setEnabled(res.enabled);
      })
      .catch(() => {
        /* ‏כישלון טעינה אינו „כבוי” — המתג פשוט אינו מוצג */
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiPatch<{ enabled: boolean }>("/settings/office-digest", {
        enabled: next,
      });
      setEnabled(saved.enabled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null) return null;

  return (
    <section className="mv-card mv-card--pad mt-6">
      <h2 className="mv-card-head__title m-0 mb-1">הסיכום החודשי שלי</h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        בתחילת כל חודש נשלחת אליך בוואטסאפ סקירה של החודש שנגמר — הלידים, הנכסים,
        הפגישות והעסקאות שלך, והמקום שלך במשרד. אין בה נתונים של סוכנים אחרים.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>לקבל את הסיכום בוואטסאפ</span>
      </label>
      <p className="m-0 mt-2 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        גם בלי זה הסיכום ימשיך להופיע בהתראות במערכת.
      </p>
      {error === null ? null : <Notice tone="danger">{error}</Notice>}
    </section>
  );
}
