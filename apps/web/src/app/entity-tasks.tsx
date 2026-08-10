"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { api, apiGet, apiPost, ApiError } from "@/lib/api";
import { IconCheck, IconClock, IconUser } from "./icons";

/**
 * המשימות של לקוח או נכס — בתוך הכרטיס שלו.
 *
 * הקישור `entityType`/`entityId` היה בנתונים מהיום הראשון: משימות
 * שנוצרו מ-SLA של ליד, מפולו-אפ אחרי סיור ומנכס שירד משיווק כולן
 * נשאו אותו. הוא פשוט מעולם לא הוצג — כלומר המערכת ידעה "יש משהו
 * פתוח על הלקוח הזה" ולא סיפרה לאיש.
 *
 * ההיקף כאן הוא **כל המשרד** ולא רק שלי, בכוונה: כרטיס שמראה רק את
 * המשימות שלי על אותו לקוח משקר — הוא נראה כמו "אין מה לעשות" בזמן
 * שסוכן אחר כבר קבע איתו פגישה.
 */

interface Task {
  id: string;
  title: string;
  dueAt?: string;
  status: string;
  priority: string;
  assigneeName?: string;
  automatic: boolean;
  /** השרת אומר; המסך לא מנחש. משימה של עמית אינה ניתנת לשינוי. */
  canEdit: boolean;
}

const dueFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

export function EntityTasks({
  entityType,
  entityId,
}: {
  entityType: "lead" | "buyer" | "property";
  entityId: string;
}): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Task[]>(`/tasks/for/${entityType}/${entityId}`)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [entityType, entityId]);

  useEffect(load, [load]);

  async function onCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: title.trim(),
        // הקישור נקבע כאן ולא נבחר בטופס — המשימה נוצרה מתוך הכרטיס
        entityType,
        entityId,
        ...(dueAt !== "" ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      setTitle("");
      setDueAt("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הוספת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(task: Task): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: task.status === "open" ? "done" : "open" }),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "עדכון המשימה נכשל");
    } finally {
      setBusy(false);
    }
  }

  const open = (tasks ?? []).filter((t) => t.status === "open");
  const now = Date.now();

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby={`tasks-${entityId}`}
    >
      <h2 id={`tasks-${entityId}`} className="mb-3 text-lg font-semibold">
        <IconCheck s={16} /> משימות {tasks ? `(${open.length})` : ""}
      </h2>

      {error ? (
        <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {tasks === null ? (
        <p aria-live="polite">טוען…</p>
      ) : tasks.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          אין משימות פתוחות על הכרטיס הזה.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {tasks.map((task) => {
            const overdue =
              task.status === "open" && task.dueAt !== undefined && new Date(task.dueAt).getTime() < now;
            return (
              <li key={task.id} className="flex flex-wrap items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1.5"
                  checked={task.status === "done"}
                  disabled={busy || !task.canEdit}
                  onChange={() => void toggle(task)}
                  aria-label={
                    task.canEdit
                      ? task.status === "open"
                        ? `סמן כבוצע: ${task.title}`
                        : `החזר לפתוחות: ${task.title}`
                      : `${task.title} — משימה של סוכן אחר, לא ניתנת לשינוי`
                  }
                />
                <div>
                  <span className={task.status === "done" ? "line-through opacity-70" : ""}>
                    {task.title}
                  </span>
                  <div className="flex flex-wrap gap-x-3 text-sm">
                    {task.dueAt ? (
                      <span
                        style={{
                          color: overdue ? "var(--color-danger)" : "var(--color-text-muted)",
                        }}
                      >
                        <IconClock s={15} /> {dueFmt.format(new Date(task.dueAt))}
                        {overdue ? " — באיחור" : ""}
                      </span>
                    ) : null}
                    {/* מי אחראי — הכרטיס מציג את משימות כל המשרד */}
                    {task.assigneeName ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        <IconUser s={15} /> {task.assigneeName}
                      </span>
                    ) : null}
                    {task.priority === "high" ? (
                      <span style={{ color: "var(--color-danger)" }}>דחוף</span>
                    ) : null}
                    {task.automatic ? (
                      <span style={{ color: "var(--color-text-muted)" }}>אוטומטית</span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: "180px" }}>
          <label htmlFor={`nt-${entityId}`} className="mb-1 block text-sm font-medium">
            משימה חדשה
          </label>
          <input
            id={`nt-${entityId}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="למשל: לחזור אליו מחר בבוקר"
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>
        <div>
          <label htmlFor={`nd-${entityId}`} className="mb-1 block text-sm font-medium">
            מועד
          </label>
          <input
            id={`nd-${entityId}`}
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>
        <Button type="submit" disabled={busy || title.trim() === ""}>
          הוסף
        </Button>
      </form>
    </section>
  );
}
