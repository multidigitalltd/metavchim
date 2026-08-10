"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  groupTasksByBucket,
  taskEntityHref,
  type TaskBucket,
} from "@metavchim/shared";
import { api, apiGet, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";

/**
 * לוח המשימות — רכיב אחד, שני מקומות.
 *
 * הוא מוצג גם במסך `/tasks` וגם בלשונית המשימות של היומן. שני מסכים
 * שמציגים משימות היו שתי רשימות שמתחילות להיפרד: אחת מקבלת עדיפות
 * והשנייה לא, אחת מציגה את הישות המקושרת והשנייה לא. אותו נימוק
 * בדיוק כמו `accessUntil` בחיוב — פונקציה אחת, לא שני חישובים
 * שאמורים להסכים.
 *
 * עד כה המשימות ישבו כקטע בתוך מסך היומן — רשימה שטוחה ממוינת לפי
 * תאריך, שבה מה שבאיחור נראה בדיוק כמו מה שבעוד שבועיים, רק גבוה
 * יותר. הקיבוץ לדליים הוא מה שהופך את זה מרשימה לסדר עבודה.
 *
 * המסך מכיל גם את מה שהקטע ההוא לא יכול היה: הטלה על סוכן אחר,
 * עדיפות, וקישור אל הלקוח או הנכס שהמשימה נוגעת בו.
 */

interface Task {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: string;
  priority: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  assignedToUserId: string;
  assigneeName?: string;
  assignedByName?: string;
  automatic: boolean;
  /** השרת אומר; המסך לא מנחש. */
  canEdit: boolean;
  createdAt: string;
}

interface Member {
  id: string;
  name: string;
}

const dueFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

/** הצבע של הדלי. באיחור אדום, היום כתום, השאר ניטרלי. */
const BUCKET_COLOR: Record<TaskBucket, string> = {
  overdue: "var(--color-danger)",
  today: "var(--color-warning)",
  week: "var(--color-text-muted)",
  later: "var(--color-text-muted)",
  someday: "var(--color-text-muted)",
};

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

/** ISO → ערך לשדה datetime-local (בזמן המקומי של הדפדפן). */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TasksBoard({ heading = "משימות" }: { heading?: string }) {
  const { user, loading } = useRequireAuth();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [scope, setScope] = useState("me");
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // טופס ההוספה
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignee, setAssignee] = useState("");

  const canAssign = can(user, "tasks.assign");
  const canViewAll = can(user, "tasks.view_all");

  /** המשימה שהטופס שלה פתוח — אחת בכל רגע, כמו הפולו-אפ ביומן. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Task[]>(`/tasks?assignee=${encodeURIComponent(scope)}`)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [scope]);

  useEffect(() => {
    if (loading) return;
    load();
  }, [loading, load]);

  useEffect(() => {
    if (loading || !canAssign) return;
    /*
     * רשימת הצוות נטענת רק למי שרשאי להטיל. לאחרים היא לא רק מיותרת
     * — היא גם רשימת שמות של המשרד שאין סיבה למסור.
     */
    apiGet<Member[]>("/tasks/assignees")
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [loading, canAssign]);

  async function onCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: title.trim(),
        ...(dueAt !== "" ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(priority !== "normal" ? { priority } : {}),
        ...(assignee !== "" ? { assignedToUserId: assignee } : {}),
      });
      setTitle("");
      setDueAt("");
      setPriority("normal");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הוספת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "עדכון המשימה נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string): Promise<void> {
    setBusy(true);
    try {
      await api(`/tasks/${id}`, { method: "DELETE" });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "מחיקת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const open = (tasks ?? []).filter((t) => t.status === "open");
  const done = (tasks ?? []).filter((t) => t.status === "done");
  const groups = groupTasksByBucket(open, new Date());

  function row(task: Task): React.JSX.Element {
    const href =
      task.entityType && task.entityId ? taskEntityHref(task.entityType, task.entityId) : null;
    return (
      <li
        key={task.id}
        className="flex flex-wrap items-start justify-between gap-2 rounded-xl border p-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex flex-1 items-start gap-3" style={{ minWidth: "240px" }}>
          <input
            type="checkbox"
            className="mt-1.5"
            checked={task.status === "done"}
            disabled={busy || !task.canEdit}
            onChange={() =>
              void patch(task.id, { status: task.status === "open" ? "done" : "open" })
            }
            aria-label={
              task.status === "open" ? `סמן כבוצע: ${task.title}` : `החזר לפתוחות: ${task.title}`
            }
          />
          <div className="flex-1">
            {/* הכותרת היא הכפתור: לחיצה פותחת את המשימה לעריכה */}
            {task.canEdit ? (
              <button
                type="button"
                className={`text-start ${task.status === "done" ? "line-through opacity-70" : "font-medium"}`}
                aria-expanded={editingId === task.id}
                onClick={() => setEditingId(editingId === task.id ? null : task.id)}
              >
                {task.title}
              </button>
            ) : (
              <span className={task.status === "done" ? "line-through opacity-70" : "font-medium"}>
                {task.title}
              </span>
            )}
            {task.notes && editingId !== task.id ? (
              <p className="m-0 mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {task.notes}
              </p>
            ) : null}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {task.dueAt ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  ⏰ {dueFmt.format(new Date(task.dueAt))}
                </span>
              ) : null}
              {task.priority === "high" ? (
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{ background: "var(--color-table-head)", color: "var(--color-danger)" }}
                >
                  דחוף
                </span>
              ) : null}
              {/* הקישור לישות — הנתון היה קיים מהיום הראשון ומעולם לא הוצג */}
              {href && task.entityLabel ? (
                <Link href={href} className="underline">
                  {task.entityLabel}
                </Link>
              ) : null}
              {scope !== "me" && task.assigneeName ? (
                <span style={{ color: "var(--color-text-muted)" }}>👤 {task.assigneeName}</span>
              ) : null}
              {task.assignedByName ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  הוטלה בידי {task.assignedByName}
                </span>
              ) : null}
              {task.automatic ? (
                <span style={{ color: "var(--color-text-muted)" }}>נוצרה אוטומטית</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {task.status === "open" && task.canEdit ? (
            <button
              type="button"
              onClick={() =>
                void patch(task.id, { priority: task.priority === "high" ? "normal" : "high" })
              }
              disabled={busy}
              className="text-sm underline"
              aria-label={
                task.priority === "high"
                  ? `בטל דחיפות: ${task.title}`
                  : `סמן כדחוף: ${task.title}`
              }
            >
              {task.priority === "high" ? "בטל דחיפות" : "סמן דחוף"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onDelete(task.id)}
            disabled={busy || !task.canEdit}
            className="text-sm underline"
            style={{ color: "var(--color-danger)" }}
          >
            מחק<span className="mv-visually-hidden"> את {task.title}</span>
          </button>
        </div>

        {editingId === task.id ? (
          <form
            className="mt-2 flex w-full flex-wrap items-end gap-2 border-t pt-3"
            style={{ borderColor: "var(--color-input-border)" }}
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              const due = String(f.get("dueAt") ?? "");
              const nextAssignee = String(f.get("assignee") ?? "");
              void patch(task.id, {
                title: String(f.get("title") ?? "").trim() || task.title,
                notes: String(f.get("notes") ?? "").trim(),
                // ריק = ניקוי המועד; null עובר ולידציה כ"אין מועד"
                dueAt: due === "" ? null : new Date(due).toISOString(),
                priority: String(f.get("priority") ?? task.priority),
                ...(canAssign && nextAssignee !== "" && nextAssignee !== task.assignedToUserId
                  ? { assignedToUserId: nextAssignee }
                  : {}),
              }).then(() => setEditingId(null));
            }}
          >
            <div className="flex-1" style={{ minWidth: "220px" }}>
              <label htmlFor={`et-${task.id}`} className="mb-1 block text-sm font-medium">כותרת</label>
              <input id={`et-${task.id}`} name="title" defaultValue={task.title} required maxLength={200} className="w-full rounded-lg border px-3 py-2" style={inputStyle} />
            </div>
            <div>
              <label htmlFor={`ed-${task.id}`} className="mb-1 block text-sm font-medium">מועד</label>
              <input id={`ed-${task.id}`} name="dueAt" type="datetime-local" defaultValue={toLocalInput(task.dueAt)} className="rounded-lg border px-3 py-2" style={inputStyle} />
            </div>
            <div>
              <label htmlFor={`ep-${task.id}`} className="mb-1 block text-sm font-medium">עדיפות</label>
              <select id={`ep-${task.id}`} name="priority" defaultValue={task.priority} className="rounded-lg border px-3 py-2" style={inputStyle}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            {canAssign && members.length > 0 ? (
              <div>
                <label htmlFor={`ea-${task.id}`} className="mb-1 block text-sm font-medium">אחראי</label>
                <select id={`ea-${task.id}`} name="assignee" defaultValue={task.assignedToUserId} className="rounded-lg border px-3 py-2" style={inputStyle}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="w-full">
              <label htmlFor={`en-${task.id}`} className="mb-1 block text-sm font-medium">הערות</label>
              <textarea id={`en-${task.id}`} name="notes" rows={2} maxLength={2000} defaultValue={task.notes ?? ""} className="w-full rounded-lg border px-3 py-2" style={inputStyle} />
            </div>
            <Button type="submit" disabled={busy}>שמור</Button>
            <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>ביטול</Button>
          </form>
        ) : null}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="m-0 text-2xl font-bold">
          {heading} {tasks ? `(${open.length})` : ""}
        </h1>
        {canViewAll ? (
          <div>
            <label htmlFor="scope" className="me-2 text-sm">
              מציג:
            </label>
            <select
              id="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="rounded-lg border px-3 py-2"
              style={inputStyle}
            >
              <option value="me">המשימות שלי</option>
              <option value="all">כל המשרד</option>
              {members
                .filter((m) => m.id !== user?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onCreate}
        className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex-1" style={{ minWidth: "220px" }}>
          <label htmlFor="task-title" className="mb-1 block text-sm font-medium">
            משימה חדשה
          </label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="למשל: להתקשר לבעל הנכס ברבי עקיבא"
            className="w-full rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="task-due" className="mb-1 block text-sm font-medium">
            מועד
          </label>
          <input
            id="task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-lg border px-3 py-2.5"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="task-priority" className="mb-1 block text-sm font-medium">
            עדיפות
          </label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="rounded-lg border px-3 py-2.5"
            style={inputStyle}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {canAssign && members.length > 0 ? (
          <div>
            <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium">
              אחראי
            </label>
            <select
              id="task-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="">אני</option>
              {members
                .filter((m) => m.id !== user?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        <Button type="submit" disabled={busy || title.trim() === ""}>
          הוסף
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {tasks === null ? (
        <p aria-live="polite">טוען משימות…</p>
      ) : open.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>אין משימות פתוחות — הכל נקי ✓</p>
      ) : (
        groups
          // דלי ריק אינו כותרת ריקה על המסך
          .filter((group) => group.tasks.length > 0)
          .map((group) => (
            <section key={group.bucket} className="mb-5" aria-labelledby={`b-${group.bucket}`}>
              <h2
                id={`b-${group.bucket}`}
                className="mb-2 text-sm font-bold"
                style={{ color: BUCKET_COLOR[group.bucket] }}
              >
                {group.label} ({group.tasks.length})
              </h2>
              <ul className="flex flex-col gap-2">{group.tasks.map(row)}</ul>
            </section>
          ))
      )}

      {done.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="text-sm underline"
          >
            {showDone ? "הסתר" : "הצג"} {done.length} משימות שבוצעו
          </button>
          {showDone ? <ul className="mt-2 flex flex-col gap-2">{done.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
