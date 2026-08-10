"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { IconDoc, IconEdit, IconWarning } from "./icons";

/**
 * שליחת הסכם לחתימה ומעקב אחריו — מוצג בכרטיס הקונה (הזמנה בכתב)
 * ובכרטיס הנכס (בלעדיות מול בעל הנכס).
 *
 * המתווך משלים כאן את הפרטים שהמערכת לא יכולה לדעת — דמי התיווך,
 * מועד התשלום, ובבלעדיות גם התקופה. אלה פרטי חובה בהזמנה בכתב, ולכן
 * הם נשאלים לפני השליחה ולא נשארים ריקים במסמך.
 */

interface AgreementRow {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  signedAt?: string;
  sentAt?: string;
  url: string;
  createdAt: string;
  canEmail: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "נשלח — ממתין לחתימה",
  viewed: "הלקוח פתח — טרם חתם",
  signed: "✓ נחתם",
  declined: "הלקוח דחה",
};

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

/** נכס לבחירה כשההסכם נשלח ממסך שאינו מזהה נכס בעצמו (כרטיס הקונה). */
interface PropertyOption {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  rooms?: number;
}

function propertyLabel(p: PropertyOption): string {
  const where = [p.street, p.neighborhood, p.city].filter(Boolean).join(", ");
  const rooms = p.rooms !== undefined ? `${p.rooms} חדרים` : "";
  return [rooms, where].filter(Boolean).join(" · ") || "נכס ללא כתובת";
}

export function AgreementsPanel({
  contactId,
  kind,
  propertyId,
  title,
}: {
  contactId: string;
  kind: "brokerage" | "exclusivity";
  propertyId?: string;
  title: string;
}) {
  const [rows, setRows] = useState<AgreementRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  /** ההסכם שנמצא כרגע בשליחה — כדי לא לנטרל את כל השורות בבת אחת */
  const [sending, setSending] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [unfilled, setUnfilled] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  /*
   * ריק = "השתמש בברירת המחדל של המשרד".
   *
   * קודם ישבו כאן מחרוזות קשיחות ("2% ממחיר העסקה"), והן נשלחו
   * לשרת גם כשהמתווך לא נגע בשדה. כיוון שערכי הבקשה גוברים על
   * הגדרות המשרד, משרד שהגדיר עמלה אחרת קיבל בשקט את הקשיחה —
   * ותנאים כספיים שגויים נקפאו ונחתמו (ביקורת Codex).
   */
  const [fee, setFee] = useState("");
  const [payment, setPayment] = useState("");
  const [period, setPeriod] = useState("");
  /** הנכס שההסכם חל עליו — נבחר כאן כשהמסך לא מספק אותו */
  const [chosenProperty, setChosenProperty] = useState("");
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);

  function load(): void {
    apiGet<AgreementRow[]>(`/agreements/contact/${contactId}`)
      .then((all) => setRows(all.filter((row) => row.kind === kind)))
      .catch(() => setRows([]));
  }

  useEffect(load, [contactId, kind]);

  /*
   * ההזמנה בכתב נוקבת בנכס מסוים — היא מתארת אותו, ושער ההצעות
   * מחפש חתימה על אותו נכס בדיוק. מכרטיס הקונה אין נכס בהקשר, ולכן
   * הוא נבחר כאן; בלי הבחירה המסמך היה נוצר בלי תיאור, מחיר וסוג
   * עסקה — ולא היה פותח שום הצעה (ביקורת Codex).
   */
  const needsProperty = propertyId === undefined;

  useEffect(() => {
    if (!open || !needsProperty || properties !== null) return;
    apiGet<{ items: PropertyOption[] }>("/properties?limit=100")
      .then((res) => setProperties(res.items))
      .catch(() => setProperties([]));
  }, [open, needsProperty, properties]);

  const effectiveProperty = propertyId ?? chosenProperty;

  async function send(): Promise<void> {
    if (needsProperty && chosenProperty === "") {
      setError("בחרו את הנכס שההסכם חל עליו");
      return;
    }
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const res = await apiPost<{ id: string; url: string; unfilled: string[]; reused: boolean }>(
        "/agreements",
        {
          kind,
          contactId,
          // שדה ריק לא נשלח כלל: ערך בבקשה גובר על הגדרות המשרד,
          // ולכן "" היה מוחק את ברירת המחדל במקום ליפול אליה
          ...(effectiveProperty !== "" ? { propertyId: effectiveProperty } : {}),
          values: {
            ...(fee.trim() !== "" ? { דמי_תיווך: fee.trim() } : {}),
            ...(payment.trim() !== "" ? { מועד_תשלום: payment.trim() } : {}),
            ...(kind === "exclusivity" && period.trim() !== ""
              ? { תקופת_בלעדיות: period.trim() }
              : {}),
          },
        },
      );
      setLink(res.url);
      setCreatedId(res.id);
      setUnfilled(res.unfilled);
      setOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת ההסכם נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * שליחה בפועל.
   *
   * וואטסאפ נפתח בלשונית חדשה עם ההודעה מוכנה — הדפדפן חייב לפתוח
   * אותה בתוך אותו טיפול באירוע? לא: `window.open` אחרי `await`
   * נחסם בחלק מהדפדפנים כחלון קופץ, ולכן הלשונית נפתחת מיד ורק אחר
   * כך מקבלת כתובת.
   */
  async function deliver(id: string, channel: "whatsapp" | "email"): Promise<void> {
    setSending(id);
    setError(null);
    setSentNote(null);
    const tab = channel === "whatsapp" ? window.open("", "_blank", "noopener") : null;
    try {
      const res = await apiPost<{ waUrl?: string; sentTo?: string }>(
        `/agreements/${id}/send`,
        { channel },
      );
      if (channel === "whatsapp" && res.waUrl) {
        if (tab) tab.location.href = res.waUrl;
        else window.open(res.waUrl, "_blank", "noopener");
        setSentNote("וואטסאפ נפתח עם ההודעה — נותר ללחוץ שלח");
      } else if (res.sentTo) {
        setSentNote(`ההסכם נשלח לכתובת ${res.sentTo}`);
      }
      load();
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
    } finally {
      setSending(null);
    }
  }

  const signed = rows?.some((row) => row.status === "signed") ?? false;

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {signed ? (
          <span
            className="rounded-full px-3 py-1 text-sm font-medium"
            style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
          >
            ✓ נחתם
          </span>
        ) : null}
      </div>

      {rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          עדיין לא נשלח הסכם.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <span>{STATUS_LABELS[row.status] ?? row.status}</span>
              {row.status !== "signed" && row.status !== "declined" ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={sending === row.id}
                    onClick={() => void deliver(row.id, "whatsapp")}
                  >
                    שלח בוואטסאפ
                  </Button>
                  {/* מייל רק כשיש כתובת — טלפון הוא שדה חובה, אימייל אינו */}
                  {row.canEmail ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={sending === row.id}
                      onClick={() => void deliver(row.id, "email")}
                    >
                      שלח במייל
                    </Button>
                  ) : null}
                  <a href={row.url} target="_blank" rel="noopener noreferrer" className="underline">
                    קישור לחתימה
                  </a>
                  {row.sentAt ? (
                    <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                      נשלח {new Date(row.sentAt).toLocaleDateString("he-IL")}
                    </span>
                  ) : null}
                </>
              ) : null}
              {row.status === "signed" ? (
                /* המסמך החתום עצמו — עד כה החתימה נשמרה ולא היה מה להראות */
                <a href={`/agreements/${row.id}/document`} className="underline">
                  <IconDoc s={15} /> המסמך החתום
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {sentNote ? (
        <p className="mb-2" aria-live="polite" style={{ color: "var(--color-success)" }}>
          {sentNote}
        </p>
      ) : null}

      {link ? (
        <div
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-success)" }}
        >
          <p className="mb-1 font-medium">ההסכם מוכן — שלחו אותו ללקוח:</p>
          {createdId ? (
            <div className="mb-2 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={sending === createdId}
                onClick={() => void deliver(createdId, "whatsapp")}
              >
                שלח בוואטסאפ
              </Button>
            </div>
          ) : null}
          <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            או העתיקו את הקישור:
          </p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
            {link}
          </a>
          {unfilled.length > 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
              <IconWarning s={15} /> פרטים שלא הושלמו במסמך: {unfilled.map((f) => f.replace(/_/gu, " ")).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-3">
          {needsProperty ? (
            <div>
              <label htmlFor={`prop-${kind}`} className="mb-1 block font-medium">
                הנכס שההסכם חל עליו
              </label>
              <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                ההזמנה בכתב מתארת נכס מסוים, וחתימה עליה פותחת הצעות על אותו נכס.
              </p>
              <select
                id={`prop-${kind}`}
                value={chosenProperty}
                onChange={(event) => setChosenProperty(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                <option value="">בחרו נכס…</option>
                {(properties ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {propertyLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor={`fee-${kind}`} className="mb-1 block font-medium">
              דמי תיווך
            </label>
            <input
              id={`fee-${kind}`}
              value={fee}
              placeholder="ברירת המחדל של המשרד"
              onChange={(event) => setFee(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`pay-${kind}`} className="mb-1 block font-medium">
              מועד תשלום
            </label>
            <input
              id={`pay-${kind}`}
              value={payment}
              placeholder="ברירת המחדל של המשרד"
              onChange={(event) => setPayment(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {kind === "exclusivity" ? (
            <div>
              <label htmlFor="period" className="mb-1 block font-medium">
                תקופת הבלעדיות
              </label>
              <input
                id="period"
                value={period}
                placeholder="ברירת המחדל של המשרד"
                onChange={(event) => setPeriod(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void send()}>
              {busy ? "מכין…" : "צור קישור לחתימה"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <IconEdit s={15} /> שלח הסכם לחתימה
        </Button>
      )}
    </section>
  );
}
