"use client";

import { useState } from "react";
import { apiPost, ApiError } from "@/lib/api";
import { useFeature } from "@/lib/use-features";

/**
 * חיוג בלחיצה דרך המרכזייה.
 *
 * **לא `tel:`** — הקישור הזה כבר קיים לצידו ופותח את החייגן של
 * המכשיר. כאן המרכזייה עצמה יוזמת: היא מצלצלת קודם לטלפון של הסוכן,
 * וכשהוא עונה מחברת את הלקוח. ההבדל המעשי הוא שהשיחה נרשמת בכרטיס
 * מעצמה, עם משך והקלטה — שיחה מהנייד הפרטי לא מגיעה למערכת בכלל.
 *
 * הכפתור נעלם כשהתמלול/הטלפוניה אינם במסלול או כשאין מרכזייה
 * מחוברת: כפתור שמחזיר 400 בכל לחיצה גרוע מכפתור שלא קיים.
 */

export function ClickToDial({
  contactId,
  phone,
  label = "חייג",
}: {
  contactId: string;
  /** לבחירה בין מספרי אותו איש קשר. השרת מאמת שהוא אכן שלו. */
  phone?: string;
  label?: string;
}): React.JSX.Element | null {
  const enabled = useFeature("telephony");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  async function dial(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>("/settings/telephony/dial", {
        contactId,
        ...(phone ? { phone } : {}),
      });
      if (res.ok) setNote("הטלפון שלכם מצלצל — ענו, והלקוח יחובר");
      else setError(res.message);
    } catch (err: unknown) {
      /*
       * 400 כאן הוא כמעט תמיד תצורה חסרה (אין מרכזייה, אין טלפון
       * בפרופיל), וההודעה מהשרת אומרת בדיוק מה להשלים — ולכן היא
       * מוצגת כפי שהיא ולא מוחלפת בטקסט גנרי.
       */
      setError(err instanceof ApiError ? err.message : "החיוג נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="mv-btn-plain"
        style={{ padding: "7px 14px", fontSize: 13 }}
        disabled={busy}
        onClick={() => void dial()}
      >
        {busy ? "מחייג…" : `📞 ${label}`}
      </button>
      {note ? (
        <span aria-live="polite" className="text-sm" style={{ color: "var(--color-success)" }}>
          {note}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : null}
    </>
  );
}
