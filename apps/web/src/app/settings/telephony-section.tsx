"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * חיבור מרכזיית הטלפון של המשרד.
 *
 * מה שמנהל משרד צריך לעשות בפועל: לבחור ספק, להעתיק כתובת אחת,
 * ולהדביק אותה במרכזייה. לכן הכתובת היא הדבר הבולט במסך אחרי
 * החיבור, עם כפתור העתקה — ולא פרט טכני בשורה קטנה.
 */

interface Provider {
  id: string;
  label: string;
  fields: { key: string; label: string; secret: boolean }[];
  clickToDial: boolean;
}

interface Status {
  connected: boolean;
  provider?: string;
  providerLabel?: string;
  webhookUrl?: string;
  lastEventAt?: string;
  clickToDial: boolean;
  config: Record<string, unknown>;
}

export function TelephonySection() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [chosen, setChosen] = useState("generic");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load(): void {
    apiGet<Provider[]>("/settings/telephony/providers")
      .then(setProviders)
      .catch(() => setProviders([]));
    apiGet<Status>("/settings/telephony")
      .then((res) => {
        setStatus(res);
        if (res.provider) setChosen(res.provider);
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const provider = providers?.find((p) => p.id === chosen);
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of provider?.fields ?? []) {
      const value = String(form.get(field.key) ?? "").trim();
      // סוד ריק לא נשלח — כך עדכון שלוחה לא מוחק טוקן שכבר שמור
      if (field.secret) {
        if (value !== "") secrets[field.key] = value;
      } else {
        config[field.key] = value;
      }
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await apiPost("/settings/telephony", { provider: chosen, config, secrets });
      setMessage("✓ המרכזייה מחוברת — העתיקו את הכתובת והדביקו אותה בהגדרות המרכזייה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החיבור נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm("לנתק את המרכזייה? הכתובת הנוכחית תפסיק לעבוד מיד.")) return;
    setBusy(true);
    try {
      await apiDelete("/settings/telephony");
      setMessage("המרכזייה נותקה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (!providers || !status) return null;
  const provider = providers.find((p) => p.id === chosen);

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="telephony-heading">
      <h2 id="telephony-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        מרכזיית טלפון
      </h2>
      <p className="m-0 mb-3 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        שיחה נכנסת תקפיץ את שם הלקוח לפני שעונים, ותירשם אוטומטית בכרטיס שלו.
        מספר שאינו מוכר שדיברתם איתו ייפתח כליד.
      </p>

      {message ? (
        <p role="status" className="m-0 mb-3 text-sm" style={{ color: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {status.connected ? (
        <div
          className="mb-3 rounded-[13px] border p-3.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
        >
          <p className="m-0 text-sm font-bold">
            ✓ מחובר · {status.providerLabel}
          </p>
          <p className="m-0 mt-1 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            {status.lastEventAt
              ? `אירוע אחרון: ${formatDateTime(status.lastEventAt)}`
              : "טרם התקבל אירוע מהמרכזייה"}
          </p>

          <p className="m-0 mb-1 mt-3 text-[13px] font-bold">
            הכתובת להדבקה בהגדרות המרכזייה
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[12.5px]"
              style={{ background: "var(--color-bg)" }}
            >
              {status.webhookUrl}
            </code>
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => {
                void navigator.clipboard.writeText(status.webhookUrl ?? "");
                setCopied(true);
              }}
            >
              {copied ? "✓ הועתק" : "העתק"}
            </button>
          </div>
          <p className="m-0 mt-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            המרכזייה יכולה לקרוא לכתובת ב-GET עם פרמטרים או ב-POST. השדות הנדרשים:
            מספר המתקשר, מזהה שיחה, וסטטוס (‎ringing / answered / hangup‎).
          </p>

          <button type="button" className="mv-btn-plain mt-3" disabled={busy} onClick={() => void disconnect()}>
            נתק מרכזייה
          </button>
        </div>
      ) : null}

      <form onSubmit={(e) => void connect(e)} className="max-w-md">
        <div className="mb-3">
          <label htmlFor="tel-provider" className="mb-1 block text-sm font-semibold">
            ספק
          </label>
          <select
            id="tel-provider"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider && provider.fields.length === 0 ? (
            <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              לא נדרשים פרטים — מקבלים כתובת ומדביקים אותה במרכזייה.
            </p>
          ) : null}
        </div>

        {(provider?.fields ?? []).map((field) => (
          <div key={field.key} className="mb-3">
            <label htmlFor={`tel-${field.key}`} className="mb-1 block text-sm font-semibold">
              {field.label}
            </label>
            <input
              id={`tel-${field.key}`}
              name={field.key}
              type={field.secret ? "password" : "text"}
              dir="ltr"
              autoComplete="off"
              defaultValue={field.secret ? "" : String(status.config[field.key] ?? "")}
              placeholder={field.secret && status.connected ? "שמור — השאירו ריק כדי לא לשנות" : undefined}
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
          </div>
        ))}

        <button type="submit" className="mv-btn-action" disabled={busy}>
          {status.connected ? "עדכן חיבור" : "חבר מרכזייה"}
        </button>
      </form>
    </section>
  );
}
