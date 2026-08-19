"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import {
  IconCalendar,
  IconClock,
  IconCloudSun,
  IconFlame,
  IconHome,
  IconMic,
  IconPhone,
  IconPin,
  IconSearch,
  IconSend,
  IconSnow,
  IconUser,
  IconUsers,
} from "../icons";
import { VoiceRecorder } from "../voice-recorder";

/**
 * מרכז הפקודות הקוליות — המתווך אומר משפט אחד, המערכת מזהה מה הוא
 * רוצה ומנתבת. הפעולה לעולם לא מתבצעת ישירות: תמיד מוצג "הבנתי: X"
 * עם אישור, כדי שדיבור לא יהפוך בטעות לפעולה מול לקוח.
 */

const ACTION_LABELS: Record<string, ReactNode> = {
  add_property: <><IconHome s={15} /> הוספת נכס</>,
  add_buyer: <><IconUser s={15} /> הוספת קונה</>,
  add_lead: <><IconPhone s={15} /> הוספת ליד</>,
  schedule_appointment: <><IconCalendar s={15} /> קביעת פגישה</>,
  add_task: <><IconClock s={15} /> תזכורת / משימה</>,
  query_buyers: <><IconUsers s={15} /> שאלה על המאגר</>,
  send_offer: <><IconSend s={15} /> שליחת הצעה ללקוח</>,
  search: <><IconSearch s={15} /> חיפוש</>,
  unknown: "לא זוהתה פקודה",
};

interface RouteResult {
  action: keyof typeof ACTION_LABELS;
  confidence: "high" | "low";
  matched?: string;
  query?: string;
  content: string;
  appointment?: { startsAt?: string; timeExplicit: boolean; kind: string };
  task?: { title: string; dueAt?: string; timeExplicit: boolean };
}

interface BuyerAnswer {
  hasMore: boolean;
  /** מקומות שנאמרו ואין להם אף קונה — מוצגים במפורש, ראו למטה */
  unmatchedPlaces: string[];
  criteria: { cities: string[]; roomsMin?: number; roomsMax?: number; budgetMaxShekels?: number };
  buyers: {
    id: string;
    name: string;
    cities: string[];
    roomsMin?: number;
    roomsMax?: number;
    budgetMaxAgorot?: number;
    maturity: string;
  }[];
}

const MATURITY_ICONS: Record<string, ReactNode> = {
  very_hot: <IconFlame s={15} />,
  hot: <IconFlame s={15} />,
  warm: <IconCloudSun s={15} />,
  cold: <IconSnow s={15} />,
};

const dateTimeFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "full", timeStyle: "short" });

/**
 * מה אפשר לומר — **משפטים שלמים כפי שמדברים**, לא מילות מפתח.
 *
 * "פתחו במילה מפורשת" שולח את המתווך לנסח כמו מכונה, וזה בדיוק מה
 * שגורם לו להפסיק לדבר. חמש הדוגמאות מכסות את חמש המשפחות שהמנוע
 * מזהה, כך שמי שקורא אותן יודע מה טווח היכולות בלי רשימת יכולות.
 */
const EXAMPLES = [
  "תוסיף קונה משה כהן, 4 חדרים בבני ברק עד 2.3 מיליון",
  "קבע פגישה מחר בעשר",
  "תזכיר לי מחר להתקשר לדוד",
  "מי מחפש 4 חדרים בגבעתיים?",
  "חפש את שרה לוי",
] as const;

export default function VoiceCommandPage() {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [answer, setAnswer] = useState<BuyerAnswer | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (transcript.trim().length < 2) {
      setError("אמרו או הקלידו משהו קודם");
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer(null);
    setTaskDone(false);
    try {
      const result = await apiPost<RouteResult>("/voice/route", { transcript: transcript.trim() });
      setRoute(result);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ניתוח הפקודה נכשל");
    } finally {
      setBusy(false);
    }
  }

  /** תזכורת — נוצרת כאן, אחרי האישור, דרך מסלול המשימות הרגיל. */
  async function createTask() {
    if (!route?.task) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/tasks", {
        title: route.task.title,
        ...(route.task.dueAt ? { dueAt: route.task.dueAt } : {}),
      });
      setTaskDone(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת התזכורת נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** שאלה על המאגר — התשובה מוצגת כאן, לא במסך אחר. */
  async function fetchAnswer() {
    setBusy(true);
    setError(null);
    try {
      setAnswer(
        await apiPost<BuyerAnswer>("/voice/query-buyers", { transcript: transcript.trim() }),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השאילתה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** מעבר למסך הייעודי עם התוכן — שם מאשרים ומשלימים פרטים. */
  function proceed() {
    if (!route) return;
    const content = encodeURIComponent(route.content || transcript.trim());
    switch (route.action) {
      case "add_property":
        router.push(`/properties/voice?t=${content}`);
        break;
      case "add_buyer":
        router.push(`/buyers/voice?t=${content}`);
        break;
      case "add_lead":
        router.push(`/leads/voice?t=${content}`);
        break;
      case "schedule_appointment": {
        const params = new URLSearchParams({ notes: route.content || transcript.trim() });
        if (route.appointment?.startsAt) params.set("startsAt", route.appointment.startsAt);
        if (route.appointment?.kind) params.set("kind", route.appointment.kind);
        router.push(`/calendar/new?${params.toString()}`);
        break;
      }
      case "send_offer":
        // מסך אישור ייעודי — הזיהוי מול המאגר נעשה שם, והשליחה
        // דורשת לחיצה מפורשת על ההתאמה הנכונה
        router.push(`/voice/offer?t=${encodeURIComponent(transcript.trim())}`);
        break;
      case "search":
        router.push(`/search?q=${encodeURIComponent(route.query ?? route.content)}`);
        break;
      default:
        break;
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      {/*
        כותרת גדולה עם אייקון בעיגול, ולא שורת טקסט עם מיקרופון קטן
        לידה. זה המסך היחיד במערכת שמבקש מהמשתמש **לדבר**, וזו פעולה
        שאנשים מהססים לפניה — מסך קטן ומרוסן נקרא כמו טופס, ומסך
        שמזמין נקרא כמו הזמנה.
      */}
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconMic s={24} />
        </span>
        <div>
          <h1 className="m-0 text-[26px] font-extrabold leading-tight">הסוכן הקולי</h1>
          <p className="m-0 mt-1 text-[16px]" style={{ color: "var(--color-text-muted)" }}>
            דברו רגיל. אני אזהה מה צריך לעשות ואכין את המסך — כלום לא נשמר בלי שתאשרו.
          </p>
        </div>
      </header>

      {/*
        הדוגמאות כצ׳יפים לחיצים ולא כפסקה. פסקה עם חמישה ציטוטים
        במרכאות נקראת כהוראות הפעלה שצריך ללמוד; חמישה משפטים לחוצים
        נקראים כ"אפשר גם ככה" — וזה ההבדל בין מי שמנסה למי שסוגר את
        המסך. לחיצה ממלאת את השדה, כדי שאפשר יהיה לראות מה קורה בלי
        לדבר בכלל.
      */}
      <section className="mv-example-box mb-5" aria-labelledby="voice-examples-heading">
        <h2 id="voice-examples-heading" className="m-0 mb-2.5 text-[15px] font-bold">
          למשל, אפשר להגיד:
        </h2>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="mv-example-chip"
              onClick={() => {
                setTranscript(example);
                setRoute(null);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <VoiceRecorder
        value={transcript}
        onChange={(v) => {
          setTranscript(v);
          setRoute(null);
        }}
        label="מה לעשות?"
        placeholder='לדוגמה: "תוסיף קונה משה כהן 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית"'
        onError={setError}
      />

      {route ? (
        <div
          className="mb-4 rounded-xl border p-4"
          style={{
            borderColor: route.action === "unknown" ? "var(--color-danger)" : "var(--color-primary)",
            background: "var(--color-surface)",
          }}
        >
          <p className="mb-1 font-semibold">
            הבנתי: {ACTION_LABELS[route.action] ?? route.action}
            {route.confidence === "low" && route.action !== "unknown" ? (
              <span className="font-normal" style={{ color: "var(--color-text-muted)" }}> (ניחוש — ודאו שזה נכון)</span>
            ) : null}
          </p>
          {route.action === "unknown" ? (
            /*
              הדוגמאות הן משפטים שלמים כפי שאומרים אותם, ולא רשימת
              מילות מפתח: "פתחו במילה מפורשת" שולח את המתווך לנסח
              כמו מכונה, וזה בדיוק מה שגורם לו להפסיק לדבר.
            */
            <p style={{ color: "var(--color-text-muted)" }}>
              לא הצלחתי לזהות פעולה. אפשר לומר משפט רגיל — למשל
              &quot;פגישה עם שמוליק מחר בעשר&quot;, &quot;תוסיף נכס דירת 4 חדרים
              ברמת גן&quot;, &quot;דיברתי עם יוסי שמחפש דירה&quot; או
              &quot;חפש את משה כהן&quot;.
            </p>
          ) : (
            <>
              <p className="mb-1" style={{ color: "var(--color-text-muted)" }}>
                {route.action === "search"
                  ? `חיפוש: ${route.query || route.content}`
                  : route.content}
              </p>
              {route.appointment?.startsAt ? (
                <p className="mb-3 font-medium">
                  <IconCalendar s={15} /> {dateTimeFmt.format(new Date(route.appointment.startsAt))}
                  {route.appointment.timeExplicit ? null : (
                    <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                      {" "}(שעה לא נאמרה — נבחרה 10:00, אפשר לשנות)
                    </span>
                  )}
                </p>
              ) : route.action === "schedule_appointment" ? (
                <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
                  לא זוהה תאריך — תבחרו אותו במסך הבא.
                </p>
              ) : null}

              {route.action === "add_task" && route.task ? (
                taskDone ? (
                  <p className="font-medium" style={{ color: "var(--color-success)" }}>
                    ✓ התזכורת נוצרה{route.task.dueAt ? " — תקבלו התראה במועד" : ""}.{" "}
                    <a href="/calendar" className="underline">ליומן ולמשימות ←</a>
                  </p>
                ) : (
                  <>
                    <p className="mb-1 font-medium"><IconPin s={15} /> {route.task.title}</p>
                    {route.task.dueAt ? (
                      <p className="mb-3">
                        <IconClock s={15} /> {dateTimeFmt.format(new Date(route.task.dueAt))}
                        {route.task.timeExplicit ? null : (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            {" "}(שעה לא נאמרה — נבחרה 10:00)
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
                        בלי מועד — המשימה תופיע ברשימה, בלי התראה מתוזמנת.
                      </p>
                    )}
                    <Button onClick={() => void createTask()} disabled={busy}>
                      {busy ? "יוצר…" : "צור תזכורת"}
                    </Button>
                  </>
                )
              ) : route.action === "query_buyers" ? (
                answer ? (
                  <div>
                    {/*
                      מקום שנאמר ואין לו אף קונה — נאמר בפירוש ובראש.
                      קודם הוא פשוט נשמט מהשאילתה, והמתווך קיבל את כל
                      הקונים בארץ בתור "התשובה" בלי שום סימן שהמקום
                      ששאל עליו לא נלקח בחשבון.
                    */}
                    {answer.unmatchedPlaces.length > 0 && (
                      <p className="mb-2 font-medium" style={{ color: "var(--color-danger)" }}>
                        אין במאגר אף קונה ב{answer.unmatchedPlaces.join(" / ")}.
                      </p>
                    )}
                    {answer.buyers.length === 0 ? (
                      answer.unmatchedPlaces.length === 0 && (
                        <p style={{ color: "var(--color-text-muted)" }}>
                          לא נמצאו קונים שמתאימים לקריטריונים האלה.
                        </p>
                      )
                    ) : (
                      <>
                        <p className="mb-2 font-medium" style={{ color: "var(--color-success)" }}>
                          {answer.hasMore
                            ? `✓ נמצאו יותר מ-${answer.buyers.length} — מוצגים ${answer.buyers.length} הראשונים (הרשימה המלאה במסך הקונים):`
                            : `✓ נמצאו ${answer.buyers.length} קונים:`}
                        </p>
                        <ul className="flex flex-col gap-2">
                          {answer.buyers.map((b) => (
                            <li key={b.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
                              <a href={`/buyers/${b.id}`} className="font-medium underline">
                                {MATURITY_ICONS[b.maturity] ?? ""} {b.name}
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
                    )}
                  </div>
                ) : (
                  <Button onClick={() => void fetchAnswer()} disabled={busy}>
                    {busy ? "בודק במאגר…" : "הצג תשובה"}
                  </Button>
                )
              ) : (
                <Button onClick={proceed}>המשך →</Button>
              )}
            </>
          )}
        </div>
      ) : (
        <Button onClick={() => void analyze()} disabled={busy} className="w-full">
          {busy ? "מנתח…" : "מה לעשות עם זה?"}
        </Button>
      )}
    </div>
  );
}
