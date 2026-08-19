"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { LoadError } from "../load-error";
import { IconPhone } from "../icons";
import { Notice } from "../notice";

/**
 * מספרים וירטואליים — **מאיפה הגיעה השיחה, לא רק ממי.**
 *
 * שיחה נכנסת אומרת מי התקשר; היא אינה אומרת מה גרם לו. משרד שמפרסם
 * בארבעה ערוצים אינו יודע איזה מהם עובד, ומשלם על כולם. מספר נפרד
 * לכל פרסום הופך את השאלה הזו לנתון שנאסף מעצמו.
 *
 * **שלושה שימושים, טופס אחד** — כי כולם אותה הגדרה: מספר, ומה
 * לעשות כשמתקשרים אליו.
 *
 * 1. מדידת קמפיין — עמודת "שיחות" היא הדוח.
 * 2. ניתוב לסוכן — הליד נפתח כבר משויך, במקום להמתין בערימה.
 * 3. זיהוי הנכס — מספר על שלט, והליד נפתח מקושר לנכס.
 *
 * הנכס נבחר לפי מזהה ולא מרשימה נפתחת: רשימת כל נכסי המשרד בטופס
 * הזה הייתה שאילתה כבדה בכל טעינה עבור שדה שרוב המשרדים לא ימלאו.
 * מי שכן — מעתיק מזהה מכרטיס הנכס.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

interface VirtualNumber {
  id: string;
  phone: string;
  label: string;
  leadSource: string;
  assignedToUserId: string | null;
  propertyId: string | null;
  isActive: boolean;
  callCount: number;
}

interface Payload {
  numbers: VirtualNumber[];
  users: { id: string; name: string }[];
}

const EMPTY = {
  phone: "",
  label: "",
  leadSource: "",
  assignedToUserId: "",
  propertyId: "",
};

export function VirtualNumbersSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<Payload>("/settings/virtual-numbers")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  function reset(): void {
    setForm({ ...EMPTY });
    setEditing(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      phone: form.phone,
      label: form.label,
      leadSource: form.leadSource,
      assignedToUserId: form.assignedToUserId === "" ? null : form.assignedToUserId,
      propertyId: form.propertyId === "" ? null : form.propertyId,
      isActive: true,
    };
    try {
      if (editing === null) await apiPost("/settings/virtual-numbers", body);
      else await apiPatch(`/settings/virtual-numbers/${editing}`, body);
      reset();
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** כיבוי והדלקה — הפעולה השכיחה, ולכן בלחיצה אחת ובלי טופס. */
  async function toggle(number: VirtualNumber): Promise<void> {
    setError(null);
    try {
      await apiPatch(`/settings/virtual-numbers/${number.id}`, {
        phone: number.phone,
        label: number.label,
        leadSource: number.leadSource,
        assignedToUserId: number.assignedToUserId,
        propertyId: number.propertyId,
        isActive: !number.isActive,
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    try {
      await apiDelete(`/settings/virtual-numbers/${id}`);
      setConfirmDeleteId(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    }
  }

  function edit(number: VirtualNumber): void {
    setEditing(number.id);
    setForm({
      phone: number.phone,
      label: number.label,
      leadSource: number.leadSource,
      assignedToUserId: number.assignedToUserId ?? "",
      propertyId: number.propertyId ?? "",
    });
  }

  if (failed) return <LoadError onRetry={load} />;

  return (
    <section
      aria-labelledby="virtual-numbers"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="virtual-numbers" className="mb-1 text-lg font-semibold">
        <IconPhone s={16} /> מספרים וירטואליים
      </h2>
      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מספר נפרד לכל פרסום. כל שיחה נספרת לפי המספר שאליו התקשרו, כך שרואים איזה
        ערוץ מביא לקוחות — והליד נפתח עם המקור, הסוכן והנכס הנכונים.
      </p>

      {data === null ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : (
        <>
          {data.numbers.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <table className="mv-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start">שם</th>
                    <th className="text-start">מספר</th>
                    <th className="text-start">מקור הליד</th>
                    <th className="text-start">סוכן</th>
                    <th className="text-start">שיחות</th>
                    <th className="text-start">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {data.numbers.map((number) => (
                    <tr key={number.id} style={{ opacity: number.isActive ? 1 : 0.55 }}>
                      <td>
                        {number.label}
                        {!number.isActive && (
                          <span className="mv-pill ms-2" style={{ fontSize: 14 }}>
                            מושבת
                          </span>
                        )}
                      </td>
                      <td dir="ltr">{number.phone}</td>
                      <td>{number.leadSource || number.label}</td>
                      <td>
                        {number.assignedToUserId === null
                          ? "—"
                          : (data.users.find((u) => u.id === number.assignedToUserId)?.name ??
                            "—")}
                      </td>
                      {/* המדידה שבשבילה כל התכונה קיימת */}
                      <td className="font-semibold">{number.callCount}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="mv-btn-plain" onClick={() => edit(number)}>
                            ערוך
                          </button>
                          <button
                            type="button"
                            className="mv-btn-plain"
                            onClick={() => void toggle(number)}
                          >
                            {number.isActive ? "השבת" : "הפעל"}
                          </button>
                          {/*
                            אישור לפני מחיקה — אף שההיסטוריה שורדת
                            במלואה: כל שיחה מחזיקה גם את המספר וגם את
                            השם כפי שהיה באותו רגע. מה שאובד הוא
                            ההגדרה עצמה, ולכן כיבוי עדיף כשהכוונה היא
                            להפעיל מחדש בעונה הבאה.
                          */}
                          {confirmDeleteId === number.id ? (
                            <>
                              <button
                                type="button"
                                className="mv-btn-plain"
                                style={{ color: "var(--color-danger)" }}
                                onClick={() => void remove(number.id)}
                              >
                                לאשר מחיקה
                              </button>
                              <button
                                type="button"
                                className="mv-btn-plain"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                ביטול
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="mv-btn-plain"
                              style={{ color: "var(--color-danger)" }}
                              onClick={() => setConfirmDeleteId(number.id)}
                            >
                              מחק
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="vn-label" className="mb-1 block text-sm font-medium">
                שם המספר
              </label>
              <input
                id="vn-label"
                required
                minLength={2}
                maxLength={60}
                placeholder="קמפיין פייסבוק ינואר"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="vn-phone" className="mb-1 block text-sm font-medium">
                המספר
              </label>
              <input
                id="vn-phone"
                required
                dir="ltr"
                placeholder="03-1234567"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="vn-source" className="mb-1 block text-sm font-medium">
                מקור הליד <span style={{ color: "var(--color-text-muted)" }}>(רשות)</span>
              </label>
              <input
                id="vn-source"
                maxLength={20}
                placeholder="ריק = שם המספר"
                value={form.leadSource}
                onChange={(e) => setForm({ ...form, leadSource: e.target.value })}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="vn-user" className="mb-1 block text-sm font-medium">
                שייך לסוכן <span style={{ color: "var(--color-text-muted)" }}>(רשות)</span>
              </label>
              <select
                id="vn-user"
                value={form.assignedToUserId}
                onChange={(e) => setForm({ ...form, assignedToUserId: e.target.value })}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                <option value="">לערימה המשותפת</option>
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vn-property" className="mb-1 block text-sm font-medium">
                מזהה נכס <span style={{ color: "var(--color-text-muted)" }}>(רשות)</span>
              </label>
              <input
                id="vn-property"
                dir="ltr"
                placeholder="מכרטיס הנכס"
                value={form.propertyId}
                onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
                className="rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : editing === null ? "הוסף מספר" : "שמור שינויים"}
            </Button>
            {editing !== null && (
              <button type="button" className="mv-btn-plain" onClick={reset}>
                ביטול
              </button>
            )}
          </form>
        </>
      )}

      {error !== null && (
        <Notice tone="danger">{error}</Notice>
      )}
    </section>
  );
}
