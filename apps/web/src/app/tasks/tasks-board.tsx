"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  groupTasksByBucket,
  jerusalemLocalInputValue,
  jerusalemWallErrorMessage,
  openTasksSummary,
  quickDueOptions,
  resolveJerusalemLocalInput,
  snoozeTaskDue,
  taskEntityHref,
  type TaskBucket,
  JERUSALEM_TZ,
} from "@metavchim/shared";
import { api, apiGet, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import {
  IconBolt,
  IconCalendar,
  IconCheck,
  IconClock,
  IconList,
  IconPlus,
  IconUser,
  IconWarning,
} from "../icons";
import { DictateFor } from "../dictation-field";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

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

const dueFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ, dateStyle: "short", timeStyle: "short" });

/** הצבע של הדלי. באיחור אדום, היום כתום, השאר ניטרלי. */
const BUCKET_COLOR: Record<TaskBucket, string> = {
  overdue: "var(--color-danger)",
  today: "var(--color-warning)",
  week: "var(--color-text-muted)",
  later: "var(--color-text-muted)",
  someday: "var(--color-text-muted)",
};

/**
 * ‎**הגוון והאייקון של הדלי — אותה שפה שבה נצבע כל שאר המערכת.**
 *
 * כותרת צבועה לבדה מבדילה בין הדליים רק אחרי שקוראים אותה. אריח
 * מגוון עם סמל מאתר את הקבוצה הנכונה בגלילה **לפני** המילים, וזה
 * ההבדל בין רשימה לסדר עבודה.
 */
const BUCKET_TINT: Record<TaskBucket, string> = {
  overdue: "mv-domain-peach",
  today: "mv-domain-amber",
  week: "mv-domain-blue",
  later: "mv-domain-neutral",
  someday: "mv-domain-neutral",
};

const BUCKET_ICON: Record<TaskBucket, React.JSX.Element> = {
  overdue: <IconWarning s={17} />,
  today: <IconClock s={17} />,
  week: <IconCalendar s={17} />,
  later: <IconCalendar s={17} />,
  someday: <IconList s={17} />,
};

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

/**
 * ISO → ערך לשדה `datetime-local`, **בשעון ישראל**.
 *
 * ‎`getHours()` נתן את שעת המכשיר: משימה שמועדה 10:00 בישראל נפתחה
 * על 03:00 בניו-יורק, ושמירה החזירה 10:00 ניו-יורקית — 17:00
 * בישראל. סימטרי, ולכן בלתי נראה במכשיר אחד ושגוי בכל אחר.
 */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  return jerusalemLocalInputValue(new Date(iso));
}

/*
 * ‎**סירוב אינו „אין מועד”.**
 *
 * הגרסה הראשונה החזירה `null` על כל סירוב, ושני הנתיבים פירשו אותו
 * כהיעדר: היצירה שלחה `undefined` ופתחה משימה בלי מועד, והעריכה
 * שלחה `null` ו**מחקה מועד קיים** — בשקט, כי המשתמש בחר שעה
 * שנראתה לו תקינה לגמרי (ביקורת Codex). אובדן נתון, שנכנס דווקא
 * בתיקון שנועד למנוע אובדן נתונים.
 *
 * הסיבה נשמרת ועולה למסך; המוטציה לא נשלחת בכלל.
 */

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

  /** „מועד מדויק, עדיפות ואחראי” — סגור עד שמבקשים אותו. */
  const [detailsOpen, setDetailsOpen] = useState(false);

  /*
   * ‎**הרגע נקבע אחרי ההרכבה ולא בזמן הרינדור.**
   *
   * הצ׳יפים נגזרים מ„עכשיו”, והשרת והדפדפן מרנדרים בשתי נקודות זמן
   * שונות — „היום 18:00” שכבר חלף בשרת עדיין קיים בלקוח, וההידרציה
   * נשברת על רשימה באורך אחר. `null` עד ההרכבה הוא מה שמוודא ששני
   * הצדדים מסכימים: בשרת אין צ׳יפים כלל.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  /*
   * „הכל נקי ✓” נאמר גם כשהטעינה נכשלה. זו ההודעה שהכי מסוכן
   * לשקר בה: מי שראה אותה סגר את המסך והלך, בזמן שיש לו משימות
   * שממתינות.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    apiGet<Task[]>(`/tasks?assignee=${encodeURIComponent(scope)}`)
      .then(setTasks)
      .catch(() => setLoadFailed(true));
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
        ...(due !== undefined ? { dueAt: due } : {}),
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

  /** מחזיר האם הצליח — טופס העריכה נסגר רק על הצלחה, לא על שגיאה. */
  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
      return true;
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "עדכון המשימה נכשל");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * ‎**„דחה” — מחר בבוקר, בלחיצה אחת.**
   *
   * הרגע מגיע מ-`snoozeTaskDue` ולא מחשבון מקומי: הוא נשען על אותו
   * צ׳יפ „מחר בבוקר”, ולכן שניהם אינם יכולים להיפרד.
   */
  async function onSnooze(id: string): Promise<void> {
    const at = snoozeTaskDue(new Date());
    if (at === null) {
      setError("לא הצלחנו לחשב מועד לדחייה");
      return;
    }
    await patch(id, { dueAt: at.toISOString() });
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
  /* נספר מהקיבוץ ולא בתנאי נפרד — גבול „באיחור” מוגדר שם, פעם אחת. */
  const overdueCount = groups.find((g) => g.bucket === "overdue")?.tasks.length ?? 0;

  /**
   * שורת משימה.
   *
   * `bucket` נכנס פנימה כדי לצבוע את הפס בהתחלה: דחיפות שנקראת רק
   * מהכותרת שמעל מחייבת לגלול חזרה כדי לדעת מה זה, ופס צבע בקצה
   * השורה עונה על זה במבט.
   */
  function row(task: Task, bucket?: TaskBucket): React.JSX.Element {
    const href =
      task.entityType && task.entityId ? taskEntityHref(task.entityType, task.entityId) : null;
    return (
      <li
        key={task.id}
        className="mv-task-row"
        data-done={task.status === "done" ? "on" : undefined}
        /*
         * הפס בקצה נצבע לכל דלי ולא רק לשניים הדחופים: שורה שנגללה
         * הרחק מהכותרת שמעל איבדה כל סימן לאיזו קבוצה היא שייכת,
         * והצבע הוא מה שמחזיר את זה במבט.
         */
        style={
          bucket !== undefined && task.status === "open"
            ? { borderInlineStartColor: BUCKET_COLOR[bucket], borderInlineStartWidth: 3 }
            : undefined
        }
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
                  <IconClock s={15} /> {dueFmt.format(new Date(task.dueAt))}
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
                <span style={{ color: "var(--color-text-muted)" }}><IconUser s={15} /> {task.assigneeName}</span>
              ) : null}
              {task.assignedByName ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  הוטלה בידי {task.assignedByName}
                </span>
              ) : null}
              {/* תגית ולא טקסט אפור: „מי פתח את המשימה הזו” היא השאלה
                  הראשונה על שורה שהמתווך אינו זוכר שכתב */}
              {task.automatic ? (
                <span className="mv-pill mv-domain-violet">
                  <IconBolt s={13} /> נוצרה אוטומטית
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {/*
          ‎**שתי הפעולות שנעשות בפועל — ככפתורים, ולא כקישורים בטקסט.**
          ‎„בוצע” ו„דחה” הן מה שקורה לרוב המכריע של המשימות; קישור
          מודגש בשורת טקסט אינו נראה כמו משהו שלוחצים עליו, וכל
          השאר (דחיפות, מחיקה) חי בטופס העריכה שנפתח בלחיצה על
          הכותרת.
        */}
        <div className="flex flex-wrap items-center gap-2">
          {task.status === "open" && task.canEdit ? (
            <>
              <button
                type="button"
                className="mv-btn-soft"
                disabled={busy}
                onClick={() => void patch(task.id, { status: "done" })}
              >
                <IconCheck s={15} /> סמן בוצע
                <span className="mv-visually-hidden">: {task.title}</span>
              </button>
              <button
                type="button"
                className="mv-btn-plain"
                disabled={busy}
                onClick={() => void onSnooze(task.id)}
              >
                <IconCalendar s={15} /> דחה
                <span className="mv-visually-hidden"> את {task.title} למחר בבוקר</span>
              </button>
            </>
          ) : null}
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
              /*
                * ריק = ניקוי מכוון של המועד, וזה נשלח כ-`null`.
                * סירוב הוא דבר אחר לגמרי: שעה שאינה קיימת אינה
                * „בלי מועד”, ושליחתה כ-`null` הייתה **מוחקת מועד
                * קיים** בשקט.
                */
              let nextDueAt: string | null = null;
              if (due !== "") {
                const resolved = resolveJerusalemLocalInput(
                  due,
                  task.dueAt !== undefined ? new Date(task.dueAt) : null,
                );
                if (!resolved.ok) {
                  setError(jerusalemWallErrorMessage(resolved.reason));
                  return;
                }
                nextDueAt = resolved.at.toISOString();
              }
              void patch(task.id, {
                title: String(f.get("title") ?? "").trim() || task.title,
                notes: String(f.get("notes") ?? "").trim(),
                dueAt: nextDueAt,
                priority: String(f.get("priority") ?? task.priority),
                ...(canAssign && nextAssignee !== "" && nextAssignee !== task.assignedToUserId
                  ? { assignedToUserId: nextAssignee }
                  : {}),
              }).then((ok) => {
                if (ok) setEditingId(null);
              });
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
            {/*
              ‎**המחיקה כאן ולא בשורה.** בשורה היא הייתה לחיצה אחת
              מ„סמן בוצע”, על פעולה שאין ממנה חזרה — ובשורה שנקראת
              במהירות זו טעות שקורית. מי שפתח את הטופס כבר מתכוון
              לשנות את המשימה הזו.
            */}
            <button
              type="button"
              onClick={() => void onDelete(task.id)}
              disabled={busy}
              className="mv-btn-plain mv-btn-plain--danger"
              style={{ marginInlineStart: "auto" }}
            >
              מחק<span className="mv-visually-hidden"> את {task.title}</span>
            </button>
          </form>
        ) : null}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="m-0 text-2xl font-bold">{heading}</h1>
          {/*
            ‎**שורת מצב במילים, במקום מונה בתגית.**

            ‎„4” לצד הכותרת הוא נתון ניטרלי שאיש אינו פועל לפיו.
            ‎„4 משימות פתוחות · אחת באיחור” אומר גם כמה **וגם אם יש
            בעיה** — וזה מה שקובע אם המתווך גולל או סוגר את המסך.
            הניסוח עצמו נבדק ב-shared ולא נבנה כאן במחרוזת.
          */}
          {tasks ? (
            <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
              {openTasksSummary(open.length, overdueCount)}
            </p>
          ) : null}
        </div>
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
        className="mv-card mv-card--pad mb-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="mv-tile mv-domain-green" aria-hidden="true">
            <IconPlus s={18} />
          </span>
          <h2 className="m-0" style={{ fontSize: "var(--type-button)", fontWeight: 800 }}>
            משימה חדשה
          </h2>
        </div>

        {/*
          ‎**שורה אחת: מה לעשות, ולחצן אחד להוסיף.**

          הטופס הקודם העמיד ארבעה פקדים בשורה — מועד, עדיפות ואחראי
          לצד הכותרת — ולכן כל משימה נראתה כמו טופס למלא. שלושת אלה
          נדרשים במיעוט המשימות, והם עברו מאחורי „מועד ופרטים”. מה
          שנשאר גלוי הוא מה שבאמת מוקלד בכל פעם.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="task-title" className="mv-visually-hidden">
            משימה חדשה
          </label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="למשל: להתקשר לבעל הנכס ברבי עקיבא"
            className="mv-control"
            style={{ flex: "1 1 260px" }}
          />
          {/* הכתבה לשדה עצמו — משימה נאמרת מהר יותר משהיא נכתבת,
              והמתווך מקליד אותה בין שתי שיחות */}
          <DictateFor targetId="task-title" />
          <button
            type="button"
            className="mv-btn-plain"
            aria-expanded={detailsOpen}
            aria-controls="task-details"
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <IconCalendar s={15} /> מועד ופרטים
          </button>
          <button type="submit" className="mv-control-go" disabled={busy || title.trim() === ""}>
            הוסף משימה
          </button>
        </div>

        {/*
          ‎**הצ׳יפים הם המסלול הנפוץ, לא קיצור דרך.**

          שדה `datetime-local` הוא ארבע פעולות, ולכן משימות נשמרו בלי
          מועד — ומשימה בלי מועד אינה מגיעה לשום דלי שדוחף לפעולה.
          הרשימה נגזרת מ-`quickDueOptions`, שמשמיטה מועד שכבר חלף:
          לחיצה אחת לא יכולה לייצר משימה שנולדה באיחור.
        */}
        {now ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {quickDueOptions(now).map((option) => {
              const picked = dueAt === option.value;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={picked ? "mv-btn-soft" : "mv-btn-plain"}
                  style={{ borderRadius: 999 }}
                  aria-pressed={picked}
                  onClick={() => setDueAt(picked ? "" : option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {detailsOpen ? (
          <div
            id="task-details"
            className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
            style={{ borderColor: "var(--color-input-border)" }}
          >
            <div>
              <label htmlFor="task-due" className="mb-1 block text-sm font-medium">
                מועד מדויק
              </label>
              <input
                id="task-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mv-control"
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
                className="mv-control"
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
                  className="mv-control"
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
          </div>
        ) : null}
      </form>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את המשימות" onRetry={load} />
      ) : tasks === null ? (
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
                className="mb-2 flex items-center gap-2"
                style={{ fontSize: "var(--type-button)", fontWeight: 800 }}
              >
                {/* אריח מגוון עם סמל, ולא נקודה: הוא מאתר את הקבוצה
                    הנכונה בגלילה לפני שקוראים את המילים */}
                <span className={`mv-tile ${BUCKET_TINT[group.bucket]}`} aria-hidden="true">
                  {BUCKET_ICON[group.bucket]}
                </span>
                {group.label}
                <span className="mv-chip">{group.tasks.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.tasks.map((task) => row(task, group.bucket))}
              </ul>
            </section>
          ))
      )}

      {/*
        ‎**„הושלמו” היא כותרת כמו כל דלי אחר, ולא קישור בשולי המסך.**

        לראות מה נסגר הוא חלק ממה שגורם לחזור למסך — וגם הדרך היחידה
        לבטל סימון שגוי. היא נשארת מקופלת כברירת מחדל, כי מה שנעשה
        אינו מה שצריך תשומת לב עכשיו.
      */}
      {done.length > 0 ? (
        <section className="mt-6" aria-labelledby="b-done">
          <h2
            id="b-done"
            className="mb-2 flex items-center gap-2"
            style={{ fontSize: "var(--type-button)", fontWeight: 800 }}
          >
            <span className="mv-tile mv-domain-green" aria-hidden="true">
              <IconCheck s={17} />
            </span>
            הושלמו
            <span className="mv-chip">{done.length}</span>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              aria-controls="done-list"
              className="text-sm underline"
              style={{ fontWeight: 600 }}
            >
              {showDone ? "הסתר" : "הצג"}
            </button>
          </h2>
          {showDone ? (
            <ul id="done-list" className="flex flex-col gap-2">
              {done.map((task) => row(task))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
