"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { LoadError } from "../load-error";
import { Notice } from "../notice";
import { formatDate } from "@/lib/format";

/**
 * קודי קופון להצטרפות.
 *
 * שני סוגים, ובכוונה: **אחוז הנחה** על התשלום הראשון, ו**ימים חינם**
 * שמתווספים לתקופת הניסיון. השני הוא "חינם לתקופה" — בהרשמה עצמה אין
 * תשלום שאפשר להנחות, ולכן ימים הם הדרך היחידה לתת תקופה חינם.
 *
 * המונה "מומש X פעמים" הוא המספר היחיד שבודקים אחרי שמפרסמים קוד,
 * ולכן הוא בשורה עצמה ולא במסך נפרד.
 */

interface Coupon {
  code: string;
  kind: "percent" | "free_days";
  percentOff: number | null;
  freeDays: number | null;
  planCode: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  isActive: boolean;
  description: string;
  note: string;
}

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

export function CouponsSection(): React.JSX.Element {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [kind, setKind] = useState<"percent" | "free_days">("percent");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* „עדיין אין קופונים” על תקלת רשת מזמין ליצור מחדש קוד שכבר קיים. */
  const [loadFailed, setLoadFailed] = useState(false);

  function load(): void {
    setLoadFailed(false);
    apiGet<{ coupons: Coupon[] }>("/platform/coupons")
      .then((res) => setCoupons(res.coupons))
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = Number(form.get("value") ?? 0);
    const max = String(form.get("maxRedemptions") ?? "").trim();
    const expires = String(form.get("expiresAt") ?? "").trim();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await apiPost("/platform/coupons", {
        code: String(form.get("code") ?? "").trim(),
        description: String(form.get("note") ?? "").trim(),
        kind,
        ...(kind === "percent" ? { percentOff: value } : { freeDays: value }),
        ...(max !== "" ? { maxRedemptions: Number(max) } : {}),
        /*
         * התפוגה נשלחת כסוף היום שנבחר ולא כתחילתו: מי שכותב "בתוקף
         * עד 31.12" מתכוון שכל ה-31 בפנים.
         */
        ...(expires !== "" ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}),
      });
      setMessage("✓ הקופון נשמר");
      event.currentTarget.reset();
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function disable(code: string): Promise<void> {
    if (!window.confirm(`לכבות את הקוד ${code}? הוא יפסיק להתקבל בהרשמות חדשות.`)) return;
    try {
      await apiDelete(`/platform/coupons/${encodeURIComponent(code)}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הכיבוי נכשל");
    }
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="coupons-heading">
      <h2 id="coupons-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        קודי קופון
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        משרד שנרשם ומזין קוד מקבל הנחה על התשלום הראשון, או ימי ניסיון נוספים.
        הקוד אינו תלוי רישיות או מקפים.
      </p>

      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : null}
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <form onSubmit={(e) => void save(e)} className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="cp-code" className="mb-1 block text-sm font-semibold">
            קוד
          </label>
          <input
            id="cp-code"
            name="code"
            required
            maxLength={40}
            dir="ltr"
            placeholder="WELCOME20"
            className="w-36 rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="cp-kind" className="mb-1 block text-sm font-semibold">
            סוג
          </label>
          <select
            id="cp-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "percent" | "free_days")}
            className="rounded-lg border px-3 py-2.5"
            style={inputStyle}
          >
            <option value="percent">אחוז הנחה</option>
            <option value="free_days">ימים חינם</option>
          </select>
        </div>
        <div>
          <label htmlFor="cp-value" className="mb-1 block text-sm font-semibold">
            {kind === "percent" ? "אחוז" : "ימים"}
          </label>
          <input
            id="cp-value"
            name="value"
            type="number"
            required
            min={1}
            max={kind === "percent" ? 100 : 730}
            defaultValue={kind === "percent" ? 20 : 30}
            className="w-24 rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="cp-max" className="mb-1 block text-sm font-semibold">
            מגבלת שימושים
          </label>
          <input
            id="cp-max"
            name="maxRedemptions"
            type="number"
            min={1}
            placeholder="ללא"
            className="w-28 rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="cp-exp" className="mb-1 block text-sm font-semibold">
            בתוקף עד
          </label>
          <input
            id="cp-exp"
            name="expiresAt"
            type="date"
            className="rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div className="flex-1" style={{ minWidth: "160px" }}>
          <label htmlFor="cp-note" className="mb-1 block text-sm font-semibold">
            הערה (פנימית)
          </label>
          <input
            id="cp-note"
            name="note"
            maxLength={200}
            placeholder="למשל: כנס מתווכים 2026"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <button type="submit" className="mv-btn-action" disabled={busy}>
          {busy ? "שומר…" : "שמור קופון"}
        </button>
      </form>

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את הקופונים" onRetry={load} />
      ) : coupons === null ? (
        <p aria-live="polite">טוען…</p>
      ) : coupons.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>עדיין אין קופונים.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {coupons.map((c) => (
            <li
              key={c.code}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5 text-[length:var(--type-caption-lg)]"
              style={{
                borderColor: "var(--color-border)",
                opacity: c.isActive ? 1 : 0.55,
              }}
            >
              <code dir="ltr" style={{ fontWeight: 800 }}>
                {c.code}
              </code>
              <span>{c.description}</span>
              <span style={{ color: "var(--color-text-muted)" }}>
                מומש {c.redemptions}
                {c.maxRedemptions !== null ? ` מתוך ${c.maxRedemptions}` : ""}
              </span>
              {c.planCode ? (
                <span style={{ color: "var(--color-text-muted)" }}>מסלול {c.planCode}</span>
              ) : null}
              {c.expiresAt ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  עד {formatDate(c.expiresAt)}
                </span>
              ) : null}
              {c.note ? <span style={{ color: "var(--color-text-muted)" }}>· {c.note}</span> : null}
              {c.isActive ? (
                <button
                  type="button"
                  className="mv-btn-plain ms-auto"
                  onClick={() => void disable(c.code)}
                >
                  כבה
                </button>
              ) : (
                <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
                  כבוי
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
