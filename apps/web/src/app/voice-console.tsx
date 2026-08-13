"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiPost } from "@/lib/api";
import { DictationControls } from "./dictation-field";

/**
 * הסוכן הקולי בדשבורד — שורה אחת שעונה על "מה עכשיו".
 *
 * עד כה הקול חי במסך נפרד (`/voice`), ומי שלא נכנס אליו לא ידע
 * שהוא קיים. הדשבורד הוא המסך היחיד שכולם פותחים, ולכן זה המקום.
 *
 * **אותו מנוע בדיוק** (`/voice/route`) ואותו מסלול אישור: הפקודה
 * מנותבת, והמשתמש מגיע למסך הייעודי כדי לאשר ולהשלים פרטים. פקודה
 * שמבצעת פעולה בלי אישור היא בדיוק מה שגורם לאנשים לפחד לדבר
 * למערכת.
 *
 * הצ'יפים הם **הצעות ניסוח**, לא כפתורי פעולה: הם ממלאים את התיבה
 * ומריצים את אותו ניתוב. כך אין ולו כפתור אחד שמבטיח משהו שהמנוע
 * אינו יודע לעשות — וגם מי שלא יודע איך לנסח לומד מהם את השפה.
 */

interface RouteResult {
  action: string;
  content: string;
  query?: string;
  confidence?: string;
  task?: { title: string; dueAt?: string };
  appointment?: { startsAt?: string; kind?: string };
}

/**
 * ההצעות. הניסוח נבחר כדי שהמנוע יזהה אותו בביטחון גבוה — צ'יפ
 * שנופל ל"לא הבנתי" מלמד את המשתמש שלא כדאי לנסות.
 *
 * "מצא התאמות" אינו פקודה קולית אלא מסך: אין מה לנתב, ולכן הוא
 * מנווט ישירות במקום להעמיד פנים.
 */
const SUGGESTIONS: { label: string; fill?: string; href?: string }[] = [
  { label: "הכנס נכס חדש", fill: "תוסיף נכס חדש" },
  { label: "קבע סיור מחר", fill: "קבע סיור מחר ב-10:00" },
  { label: "שלח תזכורות ללידים", fill: "תזכיר לי לחזור ללידים שממתינים" },
  { label: "מצא התאמות חדשות", href: "/matches" },
];

export function VoiceConsole() {
  const router = useRouter();
  const [text, setText] = useState("");
  /** טקסט הבסיס להכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);

  /** ניתוב הפקודה, ואז מעבר למסך שבו מאשרים — לעולם לא ביצוע שקט. */
  async function run(command: string): Promise<void> {
    const trimmed = command.trim();
    if (trimmed.length < 2) {
      setError("אמרו או הקלידו משהו קודם");
      return;
    }
    setBusy(true);
    setError(null);
    setUnclear(false);
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
        case "unknown":
          /*
           * המנוע מחזיר `unknown` כפעולה — לא כשגיאת HTTP. הבהרה
           * במקום היא הדבר הנכון: העברה למסך אחר רק כדי לומר שם
           * "לא הבנתי" היא טלטול של המשתמש בלי סיבה.
           */
          setUnclear(true);
          setBusy(false);
          return;
        default:
          /*
           * משימה ושאלה על המאגר נשארות במסך הקול המלא: שם יש אישור
           * לפני יצירה ותצוגת תשובה, וכאן אין מקום להן בשורה אחת.
           */
          router.push(`/voice?t=${encodeURIComponent(trimmed)}`);
          return;
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ניתוח הפקודה נכשל");
      setBusy(false);
    }
  }

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

      <div className="mt-2.5 flex flex-wrap gap-1.5">
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
      </div>

      {unclear ? (
        <p className="m-0 mt-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          לא הצלחתי להבין מה לעשות. נסו לנסח כמו בהצעות למעלה — למשל &quot;תוסיף נכס
          חדש בבני ברק&quot;.
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
