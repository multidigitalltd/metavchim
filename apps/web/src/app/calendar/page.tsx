"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { TasksSection } from "./tasks-section";

/**
 * היומן לפי קובץ העיצוב: רשת שבועית ראשון–שישי עם בלוקי אירועים
 * צבועים לפי סוג, ומתחתיה "סיורים שהתקיימו — וטרם תועדה תוצאה"
 * עם תיעוד בלחיצה אחת.
 */

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  status: string;
  outcome?: string;
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

export default function CalendarPage() {
  const { loading: authLoading } = useRequireAuth();
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

  async function setOutcome(id: string, outcome: string) {
    await apiPatch(`/appointments/${id}`, { outcome });
    load();
  }

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
      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        <div className="mv-seg" role="group" aria-label="ניווט שבועות">
          <button type="button" onClick={() => setWeekOffset((w) => w - 1)}>→ שבוע קודם</button>
          <button type="button" aria-pressed={weekOffset === 0} onClick={() => setWeekOffset(0)}>
            השבוע
          </button>
          <button type="button" onClick={() => setWeekOffset((w) => w + 1)}>שבוע הבא ←</button>
        </div>
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
                      const href = a.propertyId
                        ? `/properties/${a.propertyId}`
                        : a.leadId
                          ? `/leads/${a.leadId}`
                          : null;
                      const block = (
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
                      );
                      return href ? (
                        <Link key={a.id} href={href} className="no-underline">
                          {block}
                        </Link>
                      ) : (
                        <div key={a.id}>{block}</div>
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
                  <div className="ms-auto flex flex-wrap items-center gap-[7px]">
                    {a.kind === "viewing" ? (
                      <>
                        <button type="button" className="mv-btn-soft" onClick={() => void setOutcome(a.id, "liked")}>
                          התקיים · מעוניין
                        </button>
                        <button type="button" className="mv-btn-plain" onClick={() => void setOutcome(a.id, "not_fit")}>
                          התקיים · לא מתאים
                        </button>
                        <button
                          type="button"
                          className="mv-btn-plain"
                          style={{ color: "var(--color-text-muted)" }}
                          onClick={() => void setStatus(a.id, "no_show")}
                        >
                          לא הגיע
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="mv-btn-soft" onClick={() => void setStatus(a.id, "completed")}>
                          התקיימה ✓
                        </button>
                        <button
                          type="button"
                          className="mv-btn-plain"
                          style={{ color: "var(--color-text-muted)" }}
                          onClick={() => void setStatus(a.id, "no_show")}
                        >
                          לא התקיימה
                        </button>
                      </>
                    )}
                  </div>
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
                        style={{ color: "var(--color-danger)" }}
                        onClick={() => {
                          if (window.confirm("לבטל את הפגישה?")) void setStatus(a.id, "cancelled");
                        }}
                      >
                        בטל
                      </button>
                    </span>
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

      <TasksSection />
    </>
  );
}
