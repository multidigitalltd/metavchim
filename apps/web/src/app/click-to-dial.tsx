"use client";

import { useState } from "react";
import { apiPost, ApiError } from "@/lib/api";
import { useFeature } from "@/lib/use-features";
import { useSoftphone } from "./softphone-bar";
import { IconHeadphones, IconPhone } from "./icons";

/**
 * חיוג בלחיצה — **שתי דרכים, לפי מה שזמין**.
 *
 * כשהסופטפון מחובר, הלחיצה מחייגת ישירות מהדפדפן: הסוכן מדבר
 * באוזניות ולא מרים כלום. זו הדרך המהירה, ולכן היא הראשונה.
 *
 * כשהוא אינו מחובר — בנייד, במחשב אחר, או כשהמשרד לא הגדיר WSS —
 * הלחיצה נופלת לחיוג הדו-שלבי: המרכזייה מצלצלת לטלפון של הסוכן,
 * וכשהוא עונה היא מחברת את הלקוח. מסורבל יותר, אבל עובד בכל מקום.
 *
 * **לא `tel:`** בשני המקרים — הקישור הזה כבר קיים לצידו ופותח את
 * החייגן של המכשיר, ושיחה כזו לא מגיעה למערכת בכלל.
 *
 * הכפתור נעלם כשהטלפוניה אינה במסלול: כפתור שמחזיר 400 בכל לחיצה
 * גרוע מכפתור שלא קיים.
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
  const softphone = useSoftphone();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  /*
   * הסופטפון דורש מספר, והמספר כאן הוא של איש הקשר שהכרטיס כבר
   * הציג — לא קלט חופשי. מסלול השרת ממשיך לקבל `contactId` בלבד
   * ולפתור את המספר בעצמו, כי שם הוא כן חשוף לבקשות מזויפות.
   */
  const viaSoftphone = softphone.call !== undefined && phone !== undefined && phone !== "";

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
        onClick={() => {
          if (viaSoftphone) {
            softphone.call!(phone!);
            return;
          }
          void dial();
        }}
        title={
          viaSoftphone
            ? "שיחה מהדפדפן — דברו באוזניות"
            : "המרכזייה תצלצל לטלפון שלכם, וכשתענו תחבר את הלקוח"
        }
      >
        {busy ? (
          "מחייג…"
        ) : viaSoftphone ? (
          <>
            <IconHeadphones s={15} /> {label}
          </>
        ) : (
          <>
            <IconPhone s={15} /> {label}
          </>
        )}
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
