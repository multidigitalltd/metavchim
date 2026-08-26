"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { api, apiGet, apiPost, ApiError } from "@/lib/api";
import { IconCheck, IconClock, IconUser } from "./icons";
import { LoadError } from "./load-error";
import { Notice } from "./notice";
import {
  JERUSALEM_TZ,
  jerusalemWallErrorMessage,
  quickDueOptions,
  resolveJerusalemLocalInput,
  suggestedPropertyTasks,
} from "@metavchim/shared";

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

const dueFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ, dateStyle: "short", timeStyle: "short" });

export function EntityTasks({
  entityType,
  entityId,
  suggestFrom,
}: {
  entityType: "lead" | "buyer" | "property";
  entityId: string;
  /**
   * שדות המוכנות שחסרים בכרטיס — המקור ל„משימות מוצעות” (SPEC-4c §6).
   *
   * ‎**מגיע מבחוץ ואינו מחושב כאן**, כי זה בדיוק אותו `missingFields`
   * שמניע את ציון המוכנות בכרטיס. חישוב שני היה יכול לסתור את
   * הראשון, וההצעה הייתה שולחת את המתווך להשלים שדה שהכרטיס מציג
   * כמלא.
   */
  suggestFrom?: readonly string[];
}): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ‎**„עכשיו” כמצב, ולא קריאה לשעון בכל רינדור.**
   *
   * ‎`quickDueOptions` נקרא את השעון רק כשריאקט במקרה מרנדר. טופס
   * שנשאר פתוח מעבר ל-18:00 המשיך להציג „היום” — והבטחנו במפורש
   * לא להציע מועד שחלף (ביקורת Codex). הצ'יפ מאמת מחדש בלחיצה,
   * וכאן נשמר הרגע שלפיו הרשימה מוצגת.
   */
  const [clock, setClock] = useState(() => new Date());

  /* „אין משימות פתוחות על הכרטיס הזה” אינו מה שאומרים על טעינה שנכשלה. */
  const [loadFailed, setLoadFailed] = useState(false);

  /*
   * ‎**מחזירה הבטחה, כדי שאפשר יהיה להמתין לה.**
   *
   * כשהיא נקראה בלי `await`, `busy` התנקה לפני שהרשימה התרעננה —
   * כלומר ההצעה שנלחצה נשארה על המסך ופעילה, ולחיצה שנייה בזמן
   * טעינה איטית ייצרה משימה כפולה (ביקורת Codex).
   */
  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      setTasks(await apiGet<Task[]>(`/tasks/for/${entityType}/${entityId}`));
      /* השעון מתעדכן עם הרשימה — ראו `now` למטה */
      setClock(new Date());
    } catch {
      setLoadFailed(true);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === "") return;
    /*
     * המועד נקרא בשעון ישראל, כמו שהוא מוצג בשדה. `new Date(dueAt)`
     * פירש אותו בשעון המכשיר, ולכן מתווך בחו"ל שבחר 10:00 שמר שעה
     * אחרת לגמרי — והשדה הזה נעלם ממני בסבב הקודם (ביקורת Codex).
     */
    let due: string | undefined;
    if (dueAt !== "") {
      const resolved = resolveJerusalemLocalInput(dueAt, null);
      if (!resolved.ok) {
        setError(jerusalemWallErrorMessage(resolved.reason));
        return;
      }
      due = resolved.at.toISOString();
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: title.trim(),
        // הקישור נקבע כאן ולא נבחר בטופס — המשימה נוצרה מתוך הכרטיס
        entityType,
        entityId,
        ...(due !== undefined ? { dueAt: due } : {}),
      });
      setTitle("");
      setDueAt("");
      await load();
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
      /* אותו נימוק כמו בשני הכותבים האחרים — ראו `load` */
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "עדכון המשימה נכשל");
    } finally {
      setBusy(false);
    }
  }

  const open = (tasks ?? []).filter((t) => t.status === "open");
  const done = (tasks ?? []).filter((t) => t.status !== "open");
  const now = Date.now();

  /*
   * ‎**ההצעות נגזרות ממה שחסר, ומנוקות ממה שכבר נפתח.**
   *
   * הכותרות הפתוחות נשלחות פנימה כדי שהצעה שנלחצה לא תישאר למעלה
   * ותיפתח פעמיים.
   */
  const suggestions =
    suggestFrom === undefined
      ? []
      : suggestedPropertyTasks(suggestFrom, open.map((t) => t.title));

  const quickDue = quickDueOptions(clock);

  /*
   * ‎**האימות בלחיצה הוא זה שמחייב.** הרשימה המוצגת יכולה להיות
   * דקה מיושנת; מה שנקבע בפועל נגזר משעון שנקרא **ברגע הלחיצה**.
   * אם המועד כבר חלף, הצ'יפ פשוט נעלם מהרשימה במקום לקבוע פיגור.
   */
  function chooseQuickDue(key: string): void {
    const fresh = new Date();
    setClock(fresh);
    const option = quickDueOptions(fresh).find((o) => o.key === key);
    if (option !== undefined) setDueAt(option.value);
  }

  async function addSuggested(title: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", { title, entityType, entityId });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הוספת המשימה נכשלה");
    } finally {
      setBusy(false);
    }
  }

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
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {loadFailed ? (
        <div className="mb-3">
          <LoadError message="לא הצלחנו לטעון את המשימות" onRetry={load} />
        </div>
      ) : tasks === null ? (
        <p aria-live="polite">טוען…</p>
      ) : open.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          אין משימות פתוחות על הכרטיס הזה.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {open.map((task) => {
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
          />
        </div>
        <Button type="submit" disabled={busy || title.trim() === ""}>
          הוסף
        </Button>
      </form>

      {/*
        ‎**„מועד מהיר” — SPEC-4c §6.**

        שדה `datetime-local` הוא ארבע פעולות, ומתווך שמקליד משימה בין
        שתי שיחות לא יעשה אותן — כלומר המשימה נשמרת בלי מועד, ומשימה
        בלי מועד אינה מזכירה לאיש דבר.

        המועדים מחושבים ב-`@metavchim/shared` ולא כאן: „מחר בבוקר”
        הוא 09:00 בשעון **ישראל**, ו„מחר” הוא היום הישראלי הבא — שאינו
        „עוד 24 שעות” בליל מעבר שעון. מועד שכבר חלף אינו מוצע.
      */}
      {quickDue.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            מועד מהיר
          </span>
          {quickDue.map((option) => (
            <button
              key={option.key}
              type="button"
              className="mv-chip"
              aria-pressed={dueAt === option.value}
              onClick={() => chooseQuickDue(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        ‎**„משימות מוצעות לנכס הזה” — SPEC-4c §6.**

        האפיון נוקב בכלל אחד: „Only ever suggest something the record
        actually lacks”. הוא מובטח בבנייה — המקור הוא `missingFields`
        שהשרת מחשב, אותו שדה שמניע את ציון המוכנות בכרטיס — ולכן
        ההצעה אינה יכולה לסתור את מה שהמתווך רואה שם.
      */}
      {suggestions.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">משימות מוצעות לנכס הזה</h3>
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.field}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="font-semibold">{suggestion.title}</span>
                <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {suggestion.reason}
                </span>
                <button
                  type="button"
                  className="mv-chip ms-auto"
                  disabled={busy}
                  onClick={() => void addSuggested(suggestion.title)}
                >
                  הוסף
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        ‎**„משימות שהושלמו” — כרטיס משלהן.**

        הן היו מעורבות ברשימה הפתוחה, וזה הפך „מה פתוח עליי” לשאלה
        שדורשת קריאה של כל השורות. מה שהושלם אינו נעלם — הוא נשמר עם
        המועד — אבל הוא אינו מתחרה על תשומת הלב עם מה שעוד לא נעשה.
      */}
      {/*
        ‎**מוצג רק כשהרשימה באמת נטענה.** „עוד לא הושלמו משימות” על
        טעינה שנכשלה או שטרם חזרה הוא אותו „לא ידוע” שנקרא כ„לא”.
      */}
      {tasks !== null && !loadFailed ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">
            משימות שהושלמו{done.length > 0 ? ` (${done.length})` : ""}
          </h3>
          {done.length === 0 ? (
            /*
              ‎**המצב הריק כאן מלמד ולא מתנצל.** האפיון מבקש אותו
              במפורש, והסיבה נכונה: בלעדיו המתווך שמסמן משימה
              כבוצעה רואה אותה נעלמת מהרשימה ואינו יודע לאן. השורה
              הזו אומרת מראש לאן.
            */
            <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
              משימה שתסומן כבוצעה תישמר כאן, עם התאריך והשעה שבהם הושלמה.
            </p>
          ) : (
          <ul className="flex flex-col gap-2">
            {done.map((task) => (
              <li key={task.id} className="flex flex-wrap items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1.5"
                  checked
                  disabled={busy || !task.canEdit}
                  onChange={() => void toggle(task)}
                  aria-label={
                    task.canEdit
                      ? `החזר לפתוחות: ${task.title}`
                      : `${task.title} — משימה של סוכן אחר, לא ניתנת לשינוי`
                  }
                />
                <div>
                  <span className="line-through opacity-70">{task.title}</span>
                  {task.dueAt ? (
                    <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                      <IconClock s={15} /> {dueFmt.format(new Date(task.dueAt))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
