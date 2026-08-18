"use client";

import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";

/**
 * משימות אוטומטיות קבועות — ברמת המשרד.
 *
 * כל משרד עובד בקצב אחר: אחד עושה סבב טלפונים לכל הקונים בימי ראשון,
 * אחר מעדכן בעלי נכסים בראשון לחודש. עד כה מי שרצה כזה דבר היה צריך
 * לזכור אותו בעצמו — וזה בדיוק מה שנופל ברגע שיש לחץ.
 *
 * הרשימה גלויה לכל מי שמנהל יומן, כדי שסוכן יבין מאיפה הגיעה המשימה
 * שצצה אצלו; העריכה שמורה למי שמנהל את המשרד.
 */

interface Recurrence {
  id: string;
  title: string;
  notes?: string;
  frequency: "daily" | "weekly" | "monthly";
  weekdays: number[];
  dayOfMonth?: number;
  hour: number;
  minute: number;
  assignedToUserId?: string;
  isActive: boolean;
  description: string;
  nextRunAt: string | null;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;
const nextFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

const EMPTY = {
  title: "",
  notes: "",
  frequency: "weekly" as Recurrence["frequency"],
  weekdays: [0] as number[],
  dayOfMonth: 1,
  hour: 9,
  minute: 0,
};

export function RecurrenceSection(): React.JSX.Element {
  const { user } = useRequireAuth();
  // היכולת בפועל, כולל חריגים אישיים — לא ברירת המחדל של התפקיד
  const canManage = can(user, "settings.manage");

  const [rules, setRules] = useState<Recurrence[] | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    apiGet<Recurrence[]>("/task-recurrences")
      .then(setRules)
      .catch(() => setRules([]));
  }

  useEffect(load, []);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/task-recurrences", {
        title: draft.title.trim(),
        ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
        frequency: draft.frequency,
        ...(draft.frequency === "weekly" ? { weekdays: draft.weekdays } : {}),
        ...(draft.frequency === "monthly" ? { dayOfMonth: draft.dayOfMonth } : {}),
        hour: draft.hour,
        minute: draft.minute,
      });
      setDraft(EMPTY);
      setAdding(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הכלל נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /*
   * השהיה/הפעלה דרך נתיב ייעודי ולא דרך העריכה המלאה.
   *
   * `PATCH /:id` מחליף את כל השדות, ולכן שליחה חלקית מכאן הייתה
   * מוחקת שדה שנשכח — למשל הסוכן שהוקצה, וכלל של אדם אחד היה הופך
   * בשקט לכלל של כל המשרד (ביקורת Codex).
   */
  async function toggle(rule: Recurrence): Promise<void> {
    await apiPatch(`/task-recurrences/${rule.id}/active`, { isActive: !rule.isActive });
    load();
  }

  async function remove(rule: Recurrence): Promise<void> {
    if (!window.confirm(`למחוק את הכלל "${rule.title}"? משימות שכבר נוצרו יישארו.`)) return;
    await apiDelete(`/task-recurrences/${rule.id}`);
    load();
  }

  function toggleWeekday(day: number): void {
    setDraft((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter((d) => d !== day)
        : [...prev.weekdays, day],
    }));
  }

  return (
    <section className="mv-list-card mt-[18px] px-5 py-4" aria-labelledby="recurrence-heading">
      <h2 id="recurrence-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        משימות אוטומטיות קבועות
      </h2>
      <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        כלל אחד — והמשימה נוצרת מעצמה בכל פעם. בלי סוכן מוגדר, כל סוכן פעיל מקבל עותק
        משלו.
      </p>

      {error ? (
        <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {rules === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rules.length === 0 ? (
        <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          אין עדיין כללים. לדוגמה: &quot;סבב טלפונים לקונים חמים&quot; בכל יום ראשון ב-09:00.
        </p>
      ) : (
        rules.map((rule) => (
          <div
            key={rule.id}
            className="flex flex-wrap items-center gap-3 py-[10px]"
            style={{
              borderBottom: "1px solid var(--color-row-border)",
              opacity: rule.isActive ? 1 : 0.55,
            }}
          >
            <div style={{ lineHeight: 1.35 }}>
              <div className="text-sm font-bold">{rule.title}</div>
              <div className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                {rule.description}
                {rule.isActive && rule.nextRunAt
                  ? ` · הבא: ${nextFmt.format(new Date(rule.nextRunAt))}`
                  : rule.isActive
                    ? ""
                    : " · מושהה"}
              </div>
            </div>
            {canManage ? (
              <span className="ms-auto flex flex-wrap gap-2">
                <button type="button" className="mv-btn-plain" onClick={() => void toggle(rule)}>
                  {rule.isActive ? "השהה" : "הפעל"}
                </button>
                <button
                  type="button"
                  className="mv-btn-plain"
                  style={{ color: "var(--color-danger)" }}
                  onClick={() => void remove(rule)}
                >
                  מחק
                </button>
              </span>
            ) : null}
          </div>
        ))
      )}

      {!canManage ? null : adding ? (
        <div className="mt-3 grid gap-2.5" style={{ maxWidth: 460 }}>
          <label className="text-xs font-semibold">
            מה לעשות
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={200}
              placeholder="סבב טלפונים לקונים חמים"
              className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
              style={inputStyle}
            />
          </label>

          <label className="text-xs font-semibold">
            כל כמה זמן
            <select
              value={draft.frequency}
              onChange={(e) =>
                setDraft({ ...draft, frequency: e.target.value as Recurrence["frequency"] })
              }
              className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
              style={inputStyle}
            >
              <option value="daily">כל יום</option>
              <option value="weekly">בימים מסוימים בשבוע</option>
              <option value="monthly">פעם בחודש</option>
            </select>
          </label>

          {draft.frequency === "weekly" ? (
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1 text-xs font-semibold">באילו ימים</legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((name, day) => (
                  <label key={name} className="flex items-center gap-1 text-[12.5px]">
                    <input
                      type="checkbox"
                      checked={draft.weekdays.includes(day)}
                      onChange={() => toggleWeekday(day)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {draft.frequency === "monthly" ? (
            <label className="text-xs font-semibold">
              באיזה יום בחודש
              <input
                type="number"
                min={1}
                max={31}
                value={draft.dayOfMonth}
                onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) || 1 })}
                className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
                style={inputStyle}
                aria-describedby="day-of-month-hint"
              />
              <span
                id="day-of-month-hint"
                className="mt-1 block text-[11.5px] font-normal"
                style={{ color: "var(--color-text-muted)" }}
              >
                31 יופיע ביום האחרון של חודש קצר, ולא ידלג עליו.
              </span>
            </label>
          ) : null}

          <label className="text-xs font-semibold">
            באיזו שעה
            <input
              type="time"
              value={`${String(draft.hour).padStart(2, "0")}:${String(draft.minute).padStart(2, "0")}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":");
                setDraft({ ...draft, hour: Number(h) || 0, minute: Number(m) || 0 });
              }}
              className="mt-1 w-full rounded-lg border px-2.5 py-2 text-sm font-normal"
              style={inputStyle}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-btn-action"
              disabled={busy || draft.title.trim().length < 2}
              onClick={() => void save()}
            >
              {busy ? "שומר…" : "צור כלל"}
            </button>
            <button type="button" className="mv-btn-plain" onClick={() => setAdding(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="mv-btn-plain mt-3" onClick={() => setAdding(true)}>
          + כלל חדש
        </button>
      )}

      {/*
        סוכן בלי הרשאת ניהול רואה את הכללים אך אינו יוצר אותם. עד כה
        פשוט לא הופיע כאן דבר — מי שחיפש את "משימות אוטומטיות קבועות"
        הסיק שהיכולת לא קיימת, במקום להבין שהיא שמורה למנהל.
      */}
      {canManage ? null : (
        <p className="m-0 mt-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          יצירת כללים קבועים שמורה למנהל המשרד. המשימות שנוצרות מהכללים מגיעות
          אליכם ללוח המשימות כרגיל.
        </p>
      )}
    </section>
  );
}
