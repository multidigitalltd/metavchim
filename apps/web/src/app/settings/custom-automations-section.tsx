"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  CONDITION_OPERATORS,
  describeRule,
  type AutomationCondition,
  type AutomationRuleInput,
  type AutomationTrigger,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { IconBolt, IconPlus, IconX } from "../icons";
import { Notice } from "../notice";

/**
 * אוטומציות שהמשרד בונה בעצמו.
 *
 * המסך שמעליו מציג את שמונה האוטומציות המובנות — קטלוג סגור שאפשר
 * לכבות ולכוון. כאן נבנות החדשות: טריגר, תנאים, פעולה.
 *
 * הבנייה בשלושה שלבים ולא בטופס אחד ארוך, כי זה סדר החשיבה: **מתי**
 * זה קורה, **על מה** מתוך זה, ו**מה לעשות**. טופס שמציג את שדות
 * התנאי לפני בחירת הטריגר היה מציג שדות ריקים שאין להם משמעות.
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: AutomationCondition[];
  action: AutomationRuleInput["action"];
  createdAt: string;
}

interface Payload {
  triggers: AutomationTrigger[];
  rules: RuleRow[];
  users: { id: string; name: string }[];
  /** המכסה של המסלול והשימוש בפועל — כולל המשימות הקבועות. */
  quota?: { used: number; limit: number | null };
}

const BLANK: AutomationRuleInput = {
  name: "",
  enabled: true,
  trigger: "",
  conditions: [],
  action: { kind: "task", assignedToUserId: "", title: "", dueInDays: 1 },
};

export function CustomAutomationsSection() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationRuleInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    apiGet<Payload>("/settings/automation-rules")
      .then(setData)
      .catch(() => setError("טעינת האוטומציות שלכם נכשלה"));
  }

  useEffect(load, []);

  const trigger = data?.triggers.find((t) => t.event === draft?.trigger) ?? null;
  const quota = data?.quota ?? null;
  /*
   * שרת ישן אינו מחזיר `quota`, ואז אין חסימה — עדיף מסך שמאפשר
   * ומקבל שגיאה מהשרת מאשר מסך שחוסם בלי סיבה.
   */
  const full = quota !== null && quota.limit !== null && quota.used >= quota.limit;

  function startNew() {
    setEditingId(null);
    setError(null);
    setDraft({ ...BLANK, action: { ...BLANK.action } });
  }

  function startEdit(rule: RuleRow) {
    setEditingId(rule.id);
    setError(null);
    setDraft({
      name: rule.name,
      enabled: rule.enabled,
      trigger: rule.trigger,
      conditions: rule.conditions,
      action: rule.action,
    });
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === null) await apiPost("/settings/automation-rules", draft);
      else await apiPatch(`/settings/automation-rules/${editingId}`, draft);
      setDraft(null);
      setEditingId(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: RuleRow) {
    setError(null);
    try {
      await apiPatch(`/settings/automation-rules/${rule.id}`, {
        name: rule.name,
        enabled: !rule.enabled,
        trigger: rule.trigger,
        conditions: rule.conditions,
        action: rule.action,
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
  }

  async function remove(rule: RuleRow) {
    if (!window.confirm(`למחוק את "${rule.name}"? הפעולה אינה הפיכה.`)) return;
    setError(null);
    try {
      await apiDelete(`/settings/automation-rules/${rule.id}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    }
  }

  function setCondition(index: number, patch: Partial<AutomationCondition>) {
    setDraft((d) =>
      d === null
        ? d
        : {
            ...d,
            conditions: d.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
          },
    );
  }

  if (data === null) {
    return (
      <section className="mv-card">
        <p aria-live="polite">טוען…</p>
      </section>
    );
  }

  return (
    <section className="mv-card" id="custom-automations">
      <h2 className="mb-1 text-lg font-semibold">
        <IconBolt s={17} /> האוטומציות שלכם
      </h2>
      <p className="mb-3 text-[15.5px]" style={{ color: "var(--color-text-soft)" }}>
        מה שהמערכת לא עושה מעצמה ואתם רוצים שתעשה. בוחרים מתי זה קורה, על
        מה מתוך זה, ומה לעשות.
      </p>

      {/*
        המכסה מוצגת תמיד ולא רק כשהיא נגמרה: משרד שרואה 3/5 יודע
        שיש לו מקום, ומשרד שרואה 5/5 מבין למה הכפתור חסום — במקום
        לגלות את זה רק בשגיאה אחרי שבנה כלל שלם.
      */}
      {quota !== null && quota.limit !== null ? (
        <p className="mb-3 text-[14.5px]" style={{ color: full ? "var(--color-danger)" : "var(--color-text-muted)" }}>
          {quota.used} מתוך {quota.limit} אוטומציות בשימוש — כולל המשימות
          האוטומטיות הקבועות.
        </p>
      ) : null}

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {data.rules.length === 0 && draft === null ? (
        <p className="mb-3 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
          עדיין לא בניתם אוטומציות. לדוגמה: „ליד חדש מוואטסאפ ⟵ משימה לחזור
          אליו היום”.
        </p>
      ) : null}

      <ul className="mb-3 flex list-none flex-col gap-2.5 p-0">
        {data.rules.map((rule) => (
          <li
            key={rule.id}
            className="rounded-lg border p-3"
            style={{
              borderColor: "var(--color-border)",
              /* כלל כבוי נראה כבוי — אחרת המסך משקר */
              opacity: rule.enabled ? 1 : 0.6,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <b>{rule.name}</b>
                <p className="m-0 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                  {describeRule({
                    name: rule.name,
                    enabled: rule.enabled,
                    trigger: rule.trigger,
                    conditions: rule.conditions,
                    action: rule.action,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="ghost" onClick={() => void toggle(rule)}>
                  {rule.enabled ? "כבה" : "הפעל"}
                </Button>
                <Button variant="ghost" onClick={() => startEdit(rule)}>
                  ערוך
                </Button>
                <Button variant="ghost" onClick={() => void remove(rule)}>
                  <span style={{ color: "var(--color-danger)" }}>מחק</span>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {draft === null ? (
        <Button onClick={startNew} disabled={full}>
          <IconPlus s={15} /> אוטומציה חדשה
        </Button>
      ) : (
        <div
          className="rounded-xl border p-3"
          style={{ borderColor: "var(--color-primary)", background: "var(--color-bg)" }}
        >
          <div className="mb-3">
            <label htmlFor="rule-name" className="mb-1 block font-medium">
              שם האוטומציה
            </label>
            <input
              id="rule-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="למשל: ליד מוואטסאפ — מענה באותו יום"
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </div>

          {/* ---------- 1. מתי ---------- */}
          <div className="mb-3">
            <label htmlFor="rule-trigger" className="mb-1 block font-medium">
              1 · מתי זה קורה
            </label>
            <select
              id="rule-trigger"
              value={draft.trigger}
              /* החלפת טריגר מאפסת את התנאים: הם נשענים על שדותיו,
                 ותנאי שנשאר משדה קודם היה נדחה בשמירה בלי שברור למה */
              onChange={(e) => setDraft({ ...draft, trigger: e.target.value, conditions: [] })}
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            >
              <option value="">בחרו אירוע…</option>
              {data.triggers.map((t) => (
                <option key={t.event} value={t.event}>
                  {t.label}
                </option>
              ))}
            </select>
            {trigger !== null ? (
              <p className="mt-1 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                {trigger.description}
              </p>
            ) : null}
          </div>

          {/* ---------- 2. על מה ---------- */}
          {trigger !== null && trigger.fields.length > 0 ? (
            <div className="mb-3">
              <span className="mb-1 block font-medium">2 · על מה מתוך זה (לא חובה)</span>
              <p className="mb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                בלי תנאים — האוטומציה תרוץ בכל פעם. כל תנאי מצמצם: שני תנאים
                פירושם ששניהם צריכים להתקיים.
              </p>
              {draft.conditions.map((condition, index) => {
                const field = trigger.fields.find((f) => f.key === condition.field);
                const operators = CONDITION_OPERATORS.filter((o) =>
                  field ? (o.types as readonly string[]).includes(field.type) : false,
                );
                return (
                  <div key={index} className="mb-2 flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label="שדה"
                      value={condition.field}
                      onChange={(e) => setCondition(index, { field: e.target.value })}
                      className="rounded-lg border px-2 py-1.5"
                      style={inputStyle}
                    >
                      {trigger.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="אופרטור"
                      value={condition.operator}
                      onChange={(e) =>
                        setCondition(index, {
                          operator: e.target.value as AutomationCondition["operator"],
                        })
                      }
                      className="rounded-lg border px-2 py-1.5"
                      style={inputStyle}
                    >
                      {operators.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="ערך"
                      value={condition.value}
                      list={field?.suggestions ? `sugg-${index}` : undefined}
                      onChange={(e) => setCondition(index, { value: e.target.value })}
                      className="rounded-lg border px-2 py-1.5"
                      style={inputStyle}
                    />
                    {field?.suggestions ? (
                      <datalist id={`sugg-${index}`}>
                        {field.suggestions.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    ) : null}
                    <button
                      type="button"
                      aria-label="הסר תנאי"
                      className="mv-btn-plain"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          conditions: draft.conditions.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <IconX s={14} />
                    </button>
                  </div>
                );
              })}
              {draft.conditions.length < 10 ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const first = trigger.fields[0];
                    if (!first) return;
                    const operator = CONDITION_OPERATORS.find((o) =>
                      (o.types as readonly string[]).includes(first.type),
                    );
                    setDraft({
                      ...draft,
                      conditions: [
                        ...draft.conditions,
                        { field: first.key, operator: operator?.value ?? "eq", value: "" },
                      ],
                    });
                  }}
                >
                  <IconPlus s={14} /> תנאי
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* ---------- 3. מה לעשות ---------- */}
          <div className="mb-3">
            <span className="mb-1 block font-medium">3 · מה לעשות</span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["task", "פתיחת משימה"],
                  ["notify", "התראה במערכת"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={draft.action.kind === kind}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      action:
                        kind === "task"
                          ? { kind: "task", assignedToUserId: "", title: "", dueInDays: 1 }
                          : { kind: "notify", userId: "", title: "", body: "" },
                    })
                  }
                  className="rounded-lg border px-3 py-1"
                  style={
                    draft.action.kind === kind
                      ? {
                          borderColor: "var(--color-primary)",
                          background: "var(--color-primary-soft)",
                          color: "var(--color-primary)",
                        }
                      : { borderColor: "var(--color-input-border)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="text-[14.5px]">
                <span className="mb-1 block font-medium">למי</span>
                <select
                  value={
                    draft.action.kind === "task"
                      ? draft.action.assignedToUserId
                      : draft.action.userId
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      action:
                        draft.action.kind === "task"
                          ? { ...draft.action, assignedToUserId: e.target.value }
                          : { ...draft.action, userId: e.target.value },
                    })
                  }
                  className="rounded-lg border px-2 py-1.5"
                  style={inputStyle}
                >
                  <option value="">בחרו סוכן…</option>
                  {data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex-1 text-[14.5px]" style={{ minWidth: "200px" }}>
                <span className="mb-1 block font-medium">
                  {draft.action.kind === "task" ? "כותרת המשימה" : "כותרת ההתראה"}
                </span>
                <input
                  value={draft.action.title}
                  /* פיצול מפורש ולא spread על האיחוד: TypeScript אינו
                     מצמצם `...union` והתוצאה הייתה טיפוס שמכיל שדות
                     משתי הפעולות בבת אחת */
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      action:
                        draft.action.kind === "task"
                          ? { ...draft.action, title: e.target.value }
                          : { ...draft.action, title: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border px-2 py-1.5"
                  style={inputStyle}
                />
              </label>

              {draft.action.kind === "task" ? (
                <label className="text-[14.5px]">
                  <span className="mb-1 block font-medium">מועד יעד (ימים)</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={draft.action.dueInDays}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        action:
                          draft.action.kind === "task"
                            ? { ...draft.action, dueInDays: Number(e.target.value) }
                            : draft.action,
                      })
                    }
                    className="w-24 rounded-lg border px-2 py-1.5"
                    style={inputStyle}
                  />
                </label>
              ) : (
                <label className="flex-1 text-[14.5px]" style={{ minWidth: "200px" }}>
                  <span className="mb-1 block font-medium">גוף ההתראה</span>
                  <input
                    value={draft.action.body}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        action:
                          draft.action.kind === "notify"
                            ? { ...draft.action, body: e.target.value }
                            : draft.action,
                      })
                    }
                    className="w-full rounded-lg border px-2 py-1.5"
                    style={inputStyle}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "שומר…" : editingId === null ? "צור אוטומציה" : "שמור שינויים"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}

      <p className="m-0 mt-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        אוטומציה חדשה חלה על אירועים שיקרו מכאן והלאה. פעולות על לקוח — מייל
        או וואטסאפ — אינן זמינות עדיין.
      </p>
    </section>
  );
}
