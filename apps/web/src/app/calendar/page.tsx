"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { hebrewDateFull, hebrewDateShort } from "@metavchim/shared";
import { NowStamp } from "../now-stamp";
import { AppointmentFollowUp } from "./appointment-followup";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useFeature } from "@/lib/use-features";
import { useRequireAuth } from "@/lib/use-auth";
import { TasksBoard } from "../tasks/tasks-board";
import { RecurrenceSection } from "./recurrence-section";
import { IconEdit } from "../icons";

/**
 * היומן לפי קובץ העיצוב: רשת שבועית ראשון–שישי עם בלוקי אירועים
 * צבועים לפי סוג, ומתחתיה "סיורים שהתקיימו — וטרם תועדה תוצאה"
 * עם תיעוד בלחיצה אחת.
 *
 * שתי לשוניות ולא מסך אחד ארוך: היומן והמשימות הם שני מצבי עבודה
 * שונים — "מה קורה השבוע" מול "מה עליי לעשות" — והמשימות היו נדחקות
 * לתחתית הדף מתחת לכל רשת השבוע.
 *
 * לצד כל תאריך לועזי מופיע התאריך העברי. מתווך בישראל עובד עם שני
 * לוחות במקביל: פגישה נקבעת ל-"רביעי ה-12", אבל "אחרי סוכות" הוא מה
 * שקובע מתי השוק זז.
 */

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  endsAt?: string;
  status: string;
  outcome?: string;
  notes?: string;
}

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור",
  meeting: "פגישה",
  call: "שיחה",
};

/* צבעי בלוק האירוע מהעיצוב: פגישה ירוקה, סיור ענברי; שיחה — ניטרלי */
const KIND_COLORS: Record<string, { fg: string; bg: string }> = {
  meeting: { fg: "#0C6E34", bg: "#E5FCEA" },
  viewing: { fg: "#7a5c1f", bg: "#f7efdd" },
  call: { fg: "#3F4742", bg: "#EDEFED" },
};

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];

const timeFmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });
const shortDateFmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" });
const longFmt = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** תחילת השבוע (יום ראשון 00:00) של תאריך נתון, בהיסט שבועות. */
function weekStart(offsetWeeks: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offsetWeeks * 7);
  return d;
}

type Tab = "calendar" | "tasks";

const editInputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-bg)",
} as const;

/**
 * עריכה/הזזה של פגישה עתידית — במקום, בלי לבטל ולפתוח מחדש.
 *
 * שינוי מועד עובר דרך `reschedule` (שומר את מונה הדחיות ואת הקשר
 * לנכס ולליד); כותרת והערות דרך העדכון הרגיל. כל בקשה נשלחת רק אם
 * משהו בתחומה באמת השתנה — הזזה לא "מעדכנת" כותרת שלא נגעו בה,
 * ותיקון כותרת לא נספר כדחייה.
 */
function EditAppointment({
  appointment,
  onDone,
  onCancel,
}: {
  appointment: AppointmentRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const start = new Date(appointment.startsAt);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const initialDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const initialTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const initialDuration = appointment.endsAt
    ? Math.max(15, Math.round((new Date(appointment.endsAt).getTime() - start.getTime()) / 60_000))
    : 60;

  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(initialDuration);
  const [title, setTitle] = useState(appointment.title ?? "");
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const timeChanged =
        date !== initialDate || time !== initialTime || duration !== initialDuration;
      if (timeChanged) {
        await apiPost(`/appointments/${appointment.id}/reschedule`, {
          startsAt: new Date(`${date}T${time}`).toISOString(),
          durationMinutes: duration,
        });
      }
      const detailsChanged =
        title.trim() !== (appointment.title ?? "") || notes.trim() !== (appointment.notes ?? "");
      if (detailsChanged) {
        await apiPatch(`/appointments/${appointment.id}`, {
          ...(title.trim() !== (appointment.title ?? "") ? { title: title.trim() } : {}),
          ...(notes.trim() !== (appointment.notes ?? "") ? { notes: notes.trim() } : {}),
        });
      }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "השמירה נכשלה");
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
      {error ? (
        <p role="alert" className="mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>תאריך</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-2 py-1.5" style={editInputStyle} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>שעה</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg border px-2 py-1.5" style={editInputStyle} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>משך (דקות)</span>
          <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-24 rounded-lg border px-2 py-1.5"
            style={editInputStyle}
          />
        </label>
      </div>
      <label className="mb-2 flex flex-col gap-1 text-sm">
        <span>כותרת</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="rounded-lg border px-2 py-1.5" style={editInputStyle} />
      </label>
      <label className="mb-3 flex flex-col gap-1 text-sm">
        <span>הערות</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} className="rounded-lg border px-2 py-1.5" style={editInputStyle} />
      </label>
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "שומר…" : "שמור שינויים"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>ביטול</Button>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useState<Tab>("calendar");
  const [items, setItems] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const load = useCallback(() => {
    // כולל 14 יום אחורה — סיורים שהסתיימו מופיעים לתיעוד תוצאה
    const from = weekStart(-2);
    const to = weekStart(3);
    apiGet<AppointmentRow[]>(`/appointments?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setItems)
      .catch(() => setError("טעינת היומן נכשלה"));
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  // העלאת הקלטה מוצגת רק כשהתמלול כלול במסלול — שדה שמוביל ל-403
  // גרוע משדה שלא קיים
  const canTranscribe = useFeature("transcription");

  /** איזו פגישה פתוחה לטיפול, ובאיזה מצב. אחת בכל רגע — לא רשת טפסים. */
  const [followUp, setFollowUp] = useState<{ id: string; mode: "reschedule" | "document" } | null>(
    null,
  );
  /** איזו פגישה קרובה פתוחה לעריכה/הזזה. */
  const [editing, setEditing] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    await apiPatch(`/appointments/${id}`, { status });
    load();
  }

  const start = weekStart(weekOffset);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  /* שישה טורי ימים, ראשון–שישי */
  const days = DAY_NAMES.map((name, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    const events = (items ?? [])
      .filter((a) => {
        const t = new Date(a.startsAt);
        return t >= date && t < next && a.status !== "cancelled";
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { name, date, isToday: date.getTime() === today.getTime(), events };
  });

  /* סיורים שעברו וטרם תועדה תוצאה — הרשימה מהעיצוב */
  const pendingTours = (items ?? [])
    .filter(
      (a) =>
        a.status === "scheduled" && new Date(a.startsAt) < new Date() && a.outcome === undefined,
    )
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return (
    <>
      {/* לשוניות — יומן ומשימות. tablist ולא קישורים: שתי תצוגות של
          אותו מסך, בלי ניווט ובלי טעינה מחדש. */}
      <div className="mv-seg mb-[14px]" role="tablist" aria-label="תצוגת היומן">
        <button
          type="button"
          role="tab"
          id="tab-calendar"
          aria-selected={tab === "calendar"}
          aria-controls="panel-calendar"
          aria-pressed={tab === "calendar"}
          onClick={() => setTab("calendar")}
        >
          יומן
        </button>
        <button
          type="button"
          role="tab"
          id="tab-tasks"
          aria-selected={tab === "tasks"}
          aria-controls="panel-tasks"
          aria-pressed={tab === "tasks"}
          onClick={() => setTab("tasks")}
        >
          משימות
        </button>
      </div>

      {tab === "tasks" ? (
        <div id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
          {/* אותו לוח בדיוק כמו במסך /tasks — לא עותק שיתחיל להיפרד */}
          <TasksBoard heading="המשימות שלי" />
          <RecurrenceSection />
        </div>
      ) : (
      <div id="panel-calendar" role="tabpanel" aria-labelledby="tab-calendar">
      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        <div className="mv-seg" role="group" aria-label="ניווט שבועות">
          <button type="button" onClick={() => setWeekOffset((w) => w - 1)}>→ שבוע קודם</button>
          <button type="button" aria-pressed={weekOffset === 0} onClick={() => setWeekOffset(0)}>
            השבוע
          </button>
          <button type="button" onClick={() => setWeekOffset((w) => w + 1)}>שבוע הבא ←</button>
        </div>
        {/* התאריך העברי של תחילת השבוע — הקשר ללוח שהמתווך חי בו */}
        {hebrewDateFull(start) ? (
          <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            {hebrewDateFull(start)}
          </span>
        ) : null}
        {/* ועכשיו — התאריך המלא והשעה, אותו רכיב כמו בדשבורד */}
        <NowStamp className="text-[12.5px]" />
        <Link href="/calendar/new" className="mv-btn-action ms-auto">
          + פגישה חדשה
        </Link>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען יומן…</p>
      ) : (
        <>
          {/* רשת השבוע — במובייל נגללת לרוחב בתוך הכרטיס */}
          <div className="mv-list-card mb-[18px] overflow-x-auto">
            <div style={{ minWidth: 720 }}>
              <div
                className="grid"
                style={{ gridTemplateColumns: "repeat(6,1fr)", borderBottom: "1px solid var(--color-card-head-border)" }}
              >
                {days.map((d) => (
                  <div
                    key={d.name}
                    className="px-3 py-[11px] text-center"
                    style={{
                      borderInlineStart: "1px solid var(--color-row-border)",
                      background: d.isToday ? "var(--color-primary-soft)" : "var(--color-surface)",
                    }}
                  >
                    <div className="text-[13px] font-extrabold" style={{ color: d.isToday ? "var(--color-primary)" : "var(--color-text)" }}>
                      {d.name}
                    </div>
                    <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                      {shortDateFmt.format(d.date)}
                    </div>
                    {/* התאריך העברי — תוספת, ולכן ריק כשההמרה לא זמינה */}
                    {hebrewDateShort(d.date) ? (
                      <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {hebrewDateShort(d.date)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(6,1fr)", minHeight: 280 }}>
                {days.map((d) => (
                  <div
                    key={d.name}
                    className="flex flex-col gap-[7px] px-2 py-[9px]"
                    style={{
                      borderInlineStart: "1px solid var(--color-row-border)",
                      background: d.isToday ? "#fbfdfb" : "var(--color-surface)",
                    }}
                  >
                    {d.events.map((a) => {
                      const colors = KIND_COLORS[a.kind] ?? KIND_COLORS["call"]!;
                      /*
                       * הלחיצה פותחת את הפגישה עצמה לעריכה — לא את
                       * הנכס או הליד; אליהם יש קישורים בתוך מסך
                       * העריכה. קודם פגישה בלי קישור לא הגיבה בכלל.
                       */
                      return (
                        <Link key={a.id} href={`/calendar/${a.id}/edit`} className="no-underline">
                          <div
                            className="rounded-lg px-[9px] py-[7px]"
                            style={{ background: colors.bg, lineHeight: 1.3 }}
                          >
                            <div className="text-[11.5px] font-extrabold" style={{ color: colors.fg }}>
                              {timeFmt.format(new Date(a.startsAt))} · {KIND_LABELS[a.kind] ?? a.kind}
                            </div>
                            <div className="text-[12.5px] font-bold" style={{ color: "#212722" }}>
                              {a.title ?? ""}
                              {a.outcome ? " ✓" : ""}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* סיורים ופגישות שהתקיימו — וטרם תועדה תוצאה */}
          {pendingTours.length > 0 ? (
            <section className="mv-list-card mb-[18px] px-5 py-4" aria-labelledby="pending-tours-heading">
              <h2 id="pending-tours-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
                סיורים שהתקיימו — וטרם תועדה תוצאה
              </h2>
              <p className="m-0 mb-2.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                תיעוד קצר עכשיו חוסך שכחה אחר כך. לחיצה אחת — והליד מתעדכן אוטומטית.
              </p>
              {pendingTours.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 py-[11px]"
                  style={{ borderBottom: "1px solid var(--color-row-border)" }}
                >
                  <div style={{ lineHeight: 1.35 }}>
                    <div className="text-sm font-bold">
                      {a.title ?? KIND_LABELS[a.kind] ?? a.kind}
                    </div>
                    <div className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                      {longFmt.format(new Date(a.startsAt))}
                    </div>
                  </div>
                  {/*
                    שני הכפתורים פותחים טופס ולא כותבים סטטוס ונגמרים:
                    "לא התקיימה" צריכה מועד חדש, ו"התקיימה" צריכה לדעת
                    מה קרה בה. הקיצור של לחיצה אחת איבד את שניהם.
                  */}
                  <div className="ms-auto flex flex-wrap items-center gap-[7px]">
                    <button
                      type="button"
                      className="mv-btn-soft"
                      aria-expanded={followUp?.id === a.id && followUp.mode === "document"}
                      onClick={() => setFollowUp({ id: a.id, mode: "document" })}
                    >
                      התקיימה ✓
                    </button>
                    <button
                      type="button"
                      className="mv-btn-plain"
                      style={{ color: "var(--color-text-muted)" }}
                      aria-expanded={followUp?.id === a.id && followUp.mode === "reschedule"}
                      onClick={() => setFollowUp({ id: a.id, mode: "reschedule" })}
                    >
                      לא התקיימה — קבע מחדש
                    </button>
                  </div>
                  {followUp?.id === a.id ? (
                    <AppointmentFollowUp
                      appointment={a}
                      mode={followUp.mode}
                      canTranscribe={canTranscribe}
                      onCancel={() => setFollowUp(null)}
                      onDone={() => {
                        setFollowUp(null);
                        void load();
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {/* ביטול פגישה עתידית — מהרשימה הקומפקטית מתחת לרשת */}
          {(() => {
            const upcoming = (items ?? [])
              .filter((a) => a.status === "scheduled" && new Date(a.startsAt) >= new Date())
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .slice(0, 8);
            if (upcoming.length === 0) return null;
            return (
              <section className="mv-list-card mb-[18px] px-5 py-4" aria-labelledby="upcoming-heading">
                <h2 id="upcoming-heading" className="m-0 mb-2.5" style={{ fontSize: 15.5, fontWeight: 800 }}>
                  הפגישות הקרובות
                </h2>
                {upcoming.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 py-[9px]"
                    style={{ borderBottom: "1px solid var(--color-row-border)" }}
                  >
                    <span className="text-[13px] font-extrabold" style={{ color: "var(--color-primary)" }}>
                      {longFmt.format(new Date(a.startsAt))}
                    </span>
                    <span className="text-sm font-bold">
                      {a.title ?? KIND_LABELS[a.kind] ?? a.kind}
                    </span>
                    <span className="ms-auto flex gap-2">
                      {a.propertyId ? (
                        <Link href={`/properties/${a.propertyId}`} className="mv-btn-plain">לנכס</Link>
                      ) : null}
                      {a.leadId ? (
                        <Link href={`/leads/${a.leadId}`} className="mv-btn-plain">לליד</Link>
                      ) : null}
                      <button
                        type="button"
                        className="mv-btn-plain"
                        aria-expanded={editing === a.id}
                        onClick={() => setEditing(editing === a.id ? null : a.id)}
                      >
                        <IconEdit s={15} /> ערוך / הזז
                      </button>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        style={{ color: "var(--color-danger)" }}
                        onClick={() => {
                          if (window.confirm("לבטל את הפגישה?")) void setStatus(a.id, "cancelled");
                        }}
                      >
                        בטל
                      </button>
                    </span>
                    {editing === a.id ? (
                      <EditAppointment
                        appointment={a}
                        onCancel={() => setEditing(null)}
                        onDone={() => {
                          setEditing(null);
                          load();
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </section>
            );
          })()}

          {items.length === 0 ? (
            <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              <p className="mb-3 text-lg font-semibold">אין פגישות מתוכננות</p>
              <Link href="/calendar/new">
                <Button>קבע פגישה ראשונה</Button>
              </Link>
            </div>
          ) : null}
        </>
      )}
      </div>
      )}
    </>
  );
}
