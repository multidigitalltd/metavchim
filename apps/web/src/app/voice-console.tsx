"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiPost } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { DictationControls } from "./dictation-field";
import {
  IconCalendar,
  IconClock,
  IconHome,
  IconPhone,
  IconSearch,
  IconSend,
  IconUser,
  IconUsers,
} from "./icons";

/**
 * הסוכן הקולי בדשבורד — שורה אחת שעונה על "מה עכשיו".
 *
 * עד כה הקול חי במסך נפרד (`/voice`), ומי שלא נכנס אליו לא ידע
 * שהוא קיים. הדשבורד הוא המסך היחיד שכולם פותחים, ולכן זה המקום.
 *
 * **כל היכולות כאן, ולא חלקן.** בגרסה הראשונה שתי פקודות — תזכורת
 * ושאלה על המאגר — נזרקו למסך הקול המלא, ומי שניסה אותן מהדשבורד
 * נחת במסך אחר וחזר. פקודה שעובדת רק לפעמים מלמדת שלא כדאי לנסות,
 * ואז גם השאר לא בשימוש. תשע הפעולות שהמנוע מכיר נענות מכאן.
 *
 * **אותו מנוע בדיוק** (`/voice/route`) ואותו כלל אישור: פעולה
 * שנוגעת בלקוח לעולם אינה מתבצעת בלחיצה אחת. קליטה ופגישה מגיעות
 * למסך הייעודי שבו מאשרים ומשלימים; תזכורת מוצגת כאן עם כפתור
 * אישור מפורש; שאלה על המאגר היא קריאה בלבד ולכן נענית מיד.
 */

interface RouteResult {
  action: string;
  content: string;
  query?: string;
  confidence?: "high" | "low";
  task?: { title: string; dueAt?: string; timeExplicit?: boolean };
  appointment?: { startsAt?: string; kind?: string };
}

interface BuyerAnswer {
  hasMore: boolean;
  buyers: {
    id: string;
    name: string;
    cities: string[];
    maturity: string;
    roomsMin?: number;
    roomsMax?: number;
    budgetMaxAgorot?: number;
  }[];
}

/** מה שהמנוע הבין — מוצג לפני כל פעולה, גם כשהיא רק ניווט. */
const ACTION_LABELS: Record<string, React.ReactNode> = {
  add_property: (
    <>
      <IconHome s={14} /> הוספת נכס
    </>
  ),
  add_buyer: (
    <>
      <IconUser s={14} /> הוספת קונה
    </>
  ),
  add_lead: (
    <>
      <IconPhone s={14} /> הוספת ליד
    </>
  ),
  schedule_appointment: (
    <>
      <IconCalendar s={14} /> קביעת פגישה
    </>
  ),
  add_task: (
    <>
      <IconClock s={14} /> תזכורת
    </>
  ),
  query_buyers: (
    <>
      <IconUsers s={14} /> שאלה על המאגר
    </>
  ),
  send_offer: (
    <>
      <IconSend s={14} /> שליחת הצעה
    </>
  ),
  search: (
    <>
      <IconSearch s={14} /> חיפוש
    </>
  ),
};

/**
 * ההצעות המהירות. הניסוח נבחר כדי שהמנוע יזהה אותו בביטחון גבוה —
 * צ'יפ שנופל ל"לא הבנתי" מלמד את המשתמש שלא כדאי לנסות.
 */
const SUGGESTIONS: { label: string; fill?: string; href?: string }[] = [
  { label: "הכנס נכס חדש", fill: "תוסיף נכס חדש" },
  { label: "קבע סיור מחר", fill: "קבע סיור מחר ב-10:00" },
  { label: "שלח תזכורות ללידים", fill: "תזכיר לי לחזור ללידים שממתינים" },
  { label: "מצא התאמות חדשות", href: "/matches" },
];

/**
 * כל מה שאפשר לומר, עם דוגמה לכל יכולת.
 *
 * מוסתר מאחורי "מה עוד אפשר לומר?" ולא פרוש תמיד: רשימה בת תשע
 * שורות מעל כל דשבורד היא רעש. אבל היא חייבת להיות נגישה — משתמש
 * שלא יודע מה מותר לומר משתמש בשתי פקודות ומפסיק.
 */
const CAPABILITIES: [label: string, example: string][] = [
  ["הוספת נכס", "תוסיף נכס חדש בבני ברק, 4 חדרים, 2 מיליון"],
  ["הוספת קונה", "קונה חדש שמחפש 3 חדרים בפתח תקווה עד מיליון וחצי"],
  ["הוספת ליד", "ליד חדש, דיברתי עם משה מהאתר"],
  ["קביעת פגישה או סיור", "קבע סיור עם יעקב מחר ב-4"],
  ["תזכורת ומשימה", "תזכיר לי להתקשר לדנה ביום ראשון"],
  ["שאלה על המאגר", "מי מחפש 4 חדרים בגבעתיים?"],
  ["שליחת הצעה ללקוח", "שלח את הדירה ברבי עקיבא למשה"],
  ["חיפוש", "חפש את שרה כהן"],
];

export function VoiceConsole({
  canCreateTask,
  canQueryBuyers,
}: {
  /*
   * שתי היכולות שנענות **כאן** תלויות בהרשאה, ולכן היא נבדקת לפני
   * שמציגים כפתור: `POST /tasks` דורש `calendar.manage` ושאילתת
   * המאגר דורשת `buyers.view_own`. כפתור שמחזיר 403 גרוע מכפתור
   * שאינו קיים — וזו בדיוק התקלה שכבר תוקנה פעמיים במסכים אחרים.
   *
   * מגיעות כ-props מהדשבורד, שכבר החזיק את המשתמש: קריאת `auth/me`
   * שנייה מרכיב-בן היא בקשה מיותרת בכל טעינת דשבורד.
   */
  canCreateTask: boolean;
  canQueryBuyers: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  /** טקסט הבסיס להכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);
  /** פעולה שנענית כאן ולא בניווט — תזכורת או שאלה על המאגר. */
  const [result, setResult] = useState<RouteResult | null>(null);
  const [answer, setAnswer] = useState<BuyerAnswer | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function reset(): void {
    setResult(null);
    setAnswer(null);
    setTaskDone(false);
    setUnclear(false);
    setError(null);
  }

  /** ניתוב הפקודה. ניווט למסך שבו מאשרים, או מענה כאן — אף פעם לא ביצוע שקט. */
  async function run(command: string): Promise<void> {
    const trimmed = command.trim();
    if (trimmed.length < 2) {
      setError("אמרו או הקלידו משהו קודם");
      return;
    }
    setBusy(true);
    reset();
    try {
      const route = await apiPost<RouteResult>("/voice/route", { transcript: trimmed });
      const content = encodeURIComponent(route.content || trimmed);
      switch (route.action) {
        case "add_property":
          router.push(`/properties/voice?t=${content}`);
          return;
        case "add_buyer":
          router.push(`/buyers/voice?t=${content}`);
          return;
        case "add_lead":
          router.push(`/leads/voice?t=${content}`);
          return;
        case "schedule_appointment": {
          const params = new URLSearchParams({ notes: route.content || trimmed });
          if (route.appointment?.startsAt) params.set("startsAt", route.appointment.startsAt);
          if (route.appointment?.kind) params.set("kind", route.appointment.kind);
          router.push(`/calendar/new?${params.toString()}`);
          return;
        }
        case "send_offer":
          router.push(`/voice/offer?t=${encodeURIComponent(trimmed)}`);
          return;
        case "search":
          router.push(`/search?q=${encodeURIComponent(route.query ?? route.content)}`);
          return;
        case "add_task":
          /*
           * נשארת כאן עם אישור מפורש. ניווט למסך אחר רק כדי ללחוץ
           * "צור תזכורת" הוא טלטול; ויצירה בלי אישור היא בדיוק מה
           * שגורם לאנשים לפחד לדבר למערכת.
           */
          if (!canCreateTask) {
            setError("אין לכם הרשאה ליצור משימות — פנו לבעל המשרד");
            setBusy(false);
            return;
          }
          setResult(route);
          setBusy(false);
          return;
        case "query_buyers": {
          /*
           * שאלה היא קריאה בלבד ולכן נענית מיד — בלי כפתור "הצג
           * תשובה" שרק מוסיף לחיצה למי שכבר שאל.
           */
          if (!canQueryBuyers) {
            setError("אין לכם הרשאה לצפות בקונים");
            setBusy(false);
            return;
          }
          setResult(route);
          try {
            setAnswer(
              await apiPost<BuyerAnswer>("/voice/query-buyers", { transcript: trimmed }),
            );
          } catch (err: unknown) {
            setError(err instanceof ApiError ? err.message : "השאילתה נכשלה");
          }
          setBusy(false);
          return;
        }
        default:
          /*
           * המנוע מחזיר `unknown` כפעולה — לא כשגיאת HTTP. הבהרה
           * במקום היא הדבר הנכון: העברה למסך אחר רק כדי לומר שם
           * "לא הבנתי" היא טלטול של המשתמש בלי סיבה.
           */
          setUnclear(true);
          setBusy(false);
          return;
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ניתוח הפקודה נכשל");
      setBusy(false);
    }
  }

  /** יצירת התזכורת — דרך מסלול המשימות הרגיל, אחרי האישור. */
  async function createTask(): Promise<void> {
    if (!result?.task) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: result.task.title,
        ...(result.task.dueAt ? { dueAt: result.task.dueAt } : {}),
      });
      setTaskDone(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת התזכורת נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const dateFmt = new Intl.DateTimeFormat("he-IL", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  });

  return (
    <section
      aria-labelledby="voice-console-heading"
      className="mb-6 rounded-2xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="voice-console-heading" className="mv-visually-hidden">
        הסוכן הקולי
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run(text);
            }
          }}
          placeholder="תגידי לי מה לעשות"
          aria-label="פקודה לסוכן"
          className="mv-field grow"
          style={{ minWidth: 180 }}
          disabled={busy}
        />
        {/* המיקרופון של המערכת — אותו רכיב שבכל שדה טקסט */}
        <DictationControls
          disabled={busy}
          onAppend={(spoken) => setText(`${base}${base ? " " : ""}${spoken}`)}
          onIdle={() => setBase(text)}
        />
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy || text.trim().length < 2}
          onClick={() => void run(text)}
        >
          {busy ? "מנתח…" : "דברי איתי"}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="mv-chip"
            disabled={busy}
            onClick={() => {
              if (s.href !== undefined) {
                router.push(s.href);
                return;
              }
              setText(s.fill ?? "");
              setBase(s.fill ?? "");
              void run(s.fill ?? "");
            }}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className="mv-btn-plain text-[13px]"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "סגור" : "מה עוד אפשר לומר?"}
        </button>
      </div>

      {showAll ? (
        <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-[13px]">
          {CAPABILITIES.map(([label, example]) => (
            <li key={label}>
              <button
                type="button"
                className="text-start underline"
                style={{ color: "var(--color-text-muted)" }}
                onClick={() => {
                  setText(example);
                  setBase(example);
                  setShowAll(false);
                }}
              >
                <b style={{ color: "var(--color-text)" }}>{label}</b> — „{example}”
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---- מה שנענה כאן ---- */}
      {result !== null ? (
        <div
          className="mt-3 rounded-xl border p-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <p className="m-0 mb-2 text-[13px] font-bold">
            הבנתי: {ACTION_LABELS[result.action] ?? result.action}
            {result.confidence === "low" ? (
              <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                {" "}
                — ניחוש לפי ההקשר, בדקו שזה מה שהתכוונתם
              </span>
            ) : null}
          </p>

          {result.action === "add_task" && result.task ? (
            taskDone ? (
              <p className="m-0 text-[13.5px] font-medium" style={{ color: "var(--color-success)" }}>
                ✓ התזכורת נוצרה{result.task.dueAt ? " — תקבלו התראה במועד" : ""}.{" "}
                <a href="/tasks" className="underline">
                  לכל המשימות ←
                </a>
              </p>
            ) : (
              <>
                <p className="m-0 mb-1 text-[14px] font-medium">{result.task.title}</p>
                {result.task.dueAt ? (
                  <p className="m-0 mb-2 text-[13px]">
                    {dateFmt.format(new Date(result.task.dueAt))}
                    {result.task.timeExplicit === false ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" "}
                        (שעה לא נאמרה — נבחרה 10:00)
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="m-0 mb-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                    בלי מועד — תופיע ברשימה, בלי התראה מתוזמנת.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="mv-btn-action"
                    disabled={busy}
                    onClick={() => void createTask()}
                  >
                    {busy ? "יוצר…" : "צור תזכורת"}
                  </button>
                  <button type="button" className="mv-btn-plain" onClick={reset}>
                    ביטול
                  </button>
                </div>
              </>
            )
          ) : null}

          {result.action === "query_buyers" ? (
            answer === null ? (
              <p className="m-0 text-[13px]" aria-live="polite">
                בודק במאגר…
              </p>
            ) : answer.buyers.length === 0 ? (
              <p className="m-0 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                לא נמצאו קונים שמתאימים לקריטריונים האלה.
              </p>
            ) : (
              <>
                <p className="m-0 mb-1.5 text-[13px] font-medium">
                  {answer.hasMore
                    ? `נמצאו יותר מ-${answer.buyers.length} — מוצגים הראשונים:`
                    : `נמצאו ${answer.buyers.length} קונים:`}
                </p>
                <ul className="flex list-none flex-col gap-1 p-0">
                  {answer.buyers.map((b) => (
                    <li key={b.id} className="text-[13.5px]">
                      <a href={`/buyers/${b.id}`} className="font-medium underline">
                        {b.name}
                      </a>
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" · "}
                        {[
                          b.roomsMin !== undefined
                            ? b.roomsMax !== undefined && b.roomsMax !== b.roomsMin
                              ? `${b.roomsMin}–${b.roomsMax} חדרים`
                              : `${b.roomsMin} חדרים`
                            : null,
                          b.cities.join(" / ") || null,
                          b.budgetMaxAgorot !== undefined
                            ? `עד ${formatPrice(b.budgetMaxAgorot)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
        </div>
      ) : null}

      {unclear ? (
        <p className="m-0 mt-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          לא הצלחתי להבין מה לעשות. נסו לנסח כמו באחת הדוגמאות שב&quot;מה עוד אפשר
          לומר?&quot; למעלה.
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="m-0 mt-2 text-[13px]" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
