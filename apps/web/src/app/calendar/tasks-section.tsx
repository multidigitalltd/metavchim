"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { api, apiGet, apiPost } from "@/lib/api";

/**
 * משימות ותזכורות (מודול 7): רשימת "לעשות" אישית לצד היומן. משימה עם
 * מועד יעד מקבלת תזכורת אוטומטית בפעמון ההתראות במועד.
 */

interface Task {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: string;
}

const dueFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

export function TasksSection() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    apiGet<Task[]>("/tasks")
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  async function refresh(): Promise<void> {
    setTasks(await apiGet<Task[]>("/tasks"));
  }

  async function onCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: title.trim(),
        ...(dueAt !== "" ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      setTitle("");
      setDueAt("");
      await refresh();
    } catch {
      setError("הוספת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(task: Task): Promise<void> {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: task.status === "open" ? "done" : "open" }),
      });
      await refresh();
    } catch {
      setError("עדכון המשימה נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(taskId: string): Promise<void> {
    setBusy(true);
    try {
      await api(`/tasks/${taskId}`, { method: "DELETE" });
      await refresh();
    } catch {
      setError("מחיקת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const open = (tasks ?? []).filter((t) => t.status === "open");
  const done = (tasks ?? []).filter((t) => t.status === "done");
  const now = Date.now();

  return (
    <section aria-labelledby="tasks-heading" className="mb-8">
      <h2 id="tasks-heading" className="mb-3 text-lg font-semibold">
        📌 המשימות שלי {tasks ? `(${open.length})` : ""}
      </h2>

      <form onSubmit={onCreate} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex-1" style={{ minWidth: "220px" }}>
          <label htmlFor="task-title" className="mb-1 block text-sm font-medium">
            משימה חדשה
          </label>
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="למשל: להתקשר לבעל הנכס ברבי עקיבא"
            className="w-full rounded-md border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
        </div>
        <div>
          <label htmlFor="task-due" className="mb-1 block text-sm font-medium">
            תזכורת (אופציונלי)
          </label>
          <input
            id="task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-md border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
        </div>
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
      ) : open.length === 0 && done.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>אין משימות — הכל נקי ✓</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {open.map((t) => {
              const overdue = t.dueAt !== undefined && new Date(t.dueAt).getTime() < now;
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
                  style={{
                    borderColor: overdue ? "var(--color-danger)" : "var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={busy}
                      onChange={() => onToggle(t)}
                      aria-label={`סמן כבוצע: ${t.title}`}
                    />
                    <span>
                      <span className="font-medium">{t.title}</span>
                      {t.dueAt ? (
                        <span
                          className="ms-2 text-sm"
                          style={{ color: overdue ? "var(--color-danger)" : "var(--color-text-muted)" }}
                        >
                          ⏰ {dueFmt.format(new Date(t.dueAt))}
                          {overdue ? " — באיחור" : ""}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    disabled={busy}
                    className="text-sm underline"
                    style={{ color: "var(--color-danger)" }}
                  >
                    מחק<span className="mv-visually-hidden"> את {t.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {done.length > 0 ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="text-sm underline"
              >
                {showDone ? "הסתר" : "הצג"} {done.length} משימות שבוצעו
              </button>
              {showDone ? (
                <ul className="mt-2 flex flex-col gap-2">
                  {done.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
                      style={{ borderColor: "var(--color-border)", opacity: 0.7 }}
                    >
                      <label className="flex flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked
                          disabled={busy}
                          onChange={() => onToggle(t)}
                          aria-label={`החזר לפתוחות: ${t.title}`}
                        />
                        <s>{t.title}</s>
                      </label>
                      <button
                        type="button"
                        onClick={() => onDelete(t.id)}
                        disabled={busy}
                        className="text-sm underline"
                        style={{ color: "var(--color-danger)" }}
                      >
                        מחק<span className="mv-visually-hidden"> את {t.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
