"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useFeature } from "@/lib/use-features";

/**
 * קו ה-SIP האישי — מה שמאפשר לדבר מהדפדפן.
 *
 * **בפרופיל ולא בהגדרות המשרד.** הוא היה תחילה שם, לצד המרכזייה
 * שמעליו, וזה נראה הגיוני עד שהתברר שמסך ההגדרות דורש
 * `settings.manage` — כלומר סוכן רגיל, שהנתיב בשרת *כן* מרשה לו
 * לנהל את הקו של עצמו, לא היה יכול להגיע לטופס בכלל, והסופטפון שלו
 * היה מדווח לנצח "אין קו" בלי דרך לתקן (ביקורת Codex).
 *
 * הקו שייך לאדם, ולכן הפרופיל הוא גם המקום הנכון מלכתחילה: מה ששייך
 * למשרד (כתובת WSS, דומיין) נשאר בהגדרות אצל המנהל.
 */

interface LineDto {
  username: string;
  hasPassword: boolean;
}

/** מה שהשרת אומר שחסר — ומי אמור להשלים אותו. */
const OFFICE_GAPS: Record<string, string> = {
  no_integration: "עדיין לא חוברה מרכזייה במשרד. מנהל המשרד מחבר אותה בהגדרות.",
  no_wss: "מנהל המשרד צריך להזין את כתובת ה-WSS של המרכזייה בהגדרות.",
  no_domain: "מנהל המשרד צריך להזין את דומיין ה-SIP בהגדרות.",
};

export function SipLineSection(): React.JSX.Element | null {
  const enabled = useFeature("telephony");
  const [line, setLine] = useState<LineDto | null>(null);
  const [officeGap, setOfficeGap] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    apiGet<LineDto>("/settings/telephony/my-line")
      .then((res) => {
        setLine(res);
        setUsername(res.username);
      })
      .catch(() => setLine(null));
    /*
     * הנתיב הזה פתוח לסוכן (‎leads.edit‎) בניגוד למסך ההגדרות, ולכן
     * הוא הדרך היחידה שיש כאן לדעת אם המשרד בכלל מוכן. בלעדיו הסוכן
     * היה ממלא קו תקין ותוהה למה הסופטפון לא עולה.
     */
    apiGet<{ ready: boolean; gap?: string }>("/settings/telephony/softphone")
      .then((res) => setOfficeGap(res.ready ? null : (OFFICE_GAPS[res.gap ?? ""] ?? null)))
      .catch(() => setOfficeGap(null));
  }

  useEffect(() => {
    if (enabled) load();
  }, [enabled]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPost("/settings/telephony/my-line", {
        username,
        // סיסמה ריקה אינה נשלחת — אותו כלל של סודות המרכזייה
        ...(password !== "" ? { password } : {}),
      });
      setPassword("");
      setSaved(true);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || !line) return null;

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="sip-line-heading">
      <h2 id="sip-line-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        דיבור מהדפדפן (סופטפון)
      </h2>
      <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        עם קו SIP משלכם אפשר לדבר עם אוזניות ישירות מהמסך, בלי להרים טלפון. הקו הזה
        הוא <b>שלכם ולא של המשרד</b> — שיחה נכנסת מצלצלת אצל מי שהיא מיועדת לו.
        קבלו אותו ממנהל המרכזייה.
      </p>

      {officeGap ? (
        <p className="m-0 mb-3 rounded-lg border p-2.5 text-[12.5px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
          {officeGap}
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="m-0 mb-2 text-sm" style={{ color: "var(--color-success)" }}>
          ✓ נשמר — לחצו &quot;חבר סופטפון&quot; בפינת המסך
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <form onSubmit={(e) => void save(e)} className="max-w-md">
        <div className="mb-3">
          <label htmlFor="sip-user" className="mb-1 block text-sm font-semibold">
            שם הקו / שלוחה
          </label>
          <input
            id="sip-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            dir="ltr"
            maxLength={80}
            autoComplete="off"
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>
        <div className="mb-3">
          <label htmlFor="sip-pass" className="mb-1 block text-sm font-semibold">
            סיסמת הקו
          </label>
          <input
            id="sip-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            dir="ltr"
            maxLength={200}
            autoComplete="new-password"
            placeholder={line.hasPassword ? "שמורה — השאירו ריק כדי לא לשנות" : undefined}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          <p
            className="m-0 mt-1 text-xs"
            style={{ color: line.hasPassword ? "var(--color-success)" : "var(--color-text-muted)" }}
          >
            {line.hasPassword ? "✓ שמורה בשרת" : "עדיין לא הוזנה"}
          </p>
        </div>
        <button type="submit" className="mv-btn-plain" disabled={busy}>
          {busy ? "שומר…" : "שמור את הקו שלי"}
        </button>
      </form>
    </section>
  );
}
