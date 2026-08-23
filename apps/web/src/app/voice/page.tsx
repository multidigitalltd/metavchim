"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useUserDismissed } from "@/lib/dismissed-panels";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMic, IconTarget } from "../icons";
import { VoiceRecorder } from "../voice-recorder";
import { Notice } from "../notice";
import { AgentResults } from "./results";
import { ProposalCard, type ExecuteResult, type Proposal } from "./proposal-card";

/**
 * הסוכן — משפט אחד נכנס, הצעה אחת יוצאת.
 *
 * ## מה השתנה
 *
 * המסך הקודם זיהה כוונה והעביר למסך אחר עם הטקסט בפרמטר URL. שם
 * החילוץ רץ מחדש בחוקים, ומה שהמודל הבין נזרק בדרך — כלומר המתווך
 * דיבר פעם אחת והמערכת ניתחה פעמיים, בשתי דרכים, עם שתי תוצאות.
 *
 * כאן הכול קורה במקום: ההצעה מגיעה מלאה, נערכת, ומאושרת. הניווט
 * קורה **אחרי** שנוצרה רשומה, אל הרשומה עצמה.
 *
 * ## למה שאילתה אינה מבקשת אישור
 *
 * „מי מחפש 4 חדרים בגבעתיים” אינה משנה דבר, ואישור עליה מאמן את
 * המתווך ללחוץ „אשר” בלי לקרוא. כשיגיע כרטיס שכן משנה משהו הוא
 * ילחץ עליו באותה מהירות. אישור שמופיע רק כשיש מה לאשר נשאר אישור.
 */

interface AgentCapability {
  id: string;
  title: string;
  examples: readonly string[];
}

/** תור בשיחה — נשלח לשרת כהקשר למשפטי המשך ("ומה עם רמת גן?"). */
interface HistoryTurn {
  transcript: string;
  action: string;
  params: Record<string, unknown>;
  resultSummary?: string;
}

interface Recommendation {
  priority: number;
  type: string;
  title: string;
  body: string;
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

function recHref(rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    case "appointment":
      return "/calendar";
    default:
      return null;
  }
}

/**
 * תקציר תוצאה לזיכרון השיחה — שמות, לפי הסדר שהוצגו.
 *
 * "תתקשר לראשון מהם" עובד רק אם המודל יודע מי הראשון; לכן התקציר
 * מונה את השמות ולא רק את הכמות. חמישה מספיקים — פנייה לרשומה
 * עמוק ברשימה נעשית בשם מלא ממילא.
 */
function summarizeData(data: unknown): string {
  const labels: string[] = [];
  const collect = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (labels.length >= 5 || typeof item !== "object" || item === null) return;
      const record = item as Record<string, unknown>;
      const label = record["name"] ?? record["title"] ?? record["marketingTitle"];
      if (typeof label === "string" && label !== "") labels.push(label);
    }
  };
  if (Array.isArray(data)) collect(data);
  else if (typeof data === "object" && data !== null) {
    for (const value of Object.values(data as Record<string, unknown>)) collect(value);
  }
  return labels.length > 0 ? `בין התוצאות, לפי הסדר: ${labels.join(", ")}` : "";
}


export default function AgentPage(): React.JSX.Element {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  // סגירה ו"אל תציג יותר" (בקשת המשתמש) — נשמר למשתמש, בכל מכשיר
  const examplesBox = useUserDismissed("agent-examples");
  /**
   * זיכרון השיחה — רק מה ש**בוצע**, לא כל מה שהוצע. הצעה שבוטלה
   * אינה הקשר; פעולה שנעשתה כן. ארבעה תורות אחרונים מספיקים
   * ל"ומה עם…" בלי לנפח את הפרומפט.
   */
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  // "כדאי לטפל היום" — הסוכן פותח ביוזמה, לא רק ממתין לפקודה
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * ההצעה שממתינה לתיקון — „לא, 4 חדרים”.
   *
   * היא נשלחת יחד עם המשפט הבא כדי שהמודל יתקן במקום להתחיל מאפס,
   * וכך שדות שכבר הובנו אינם אובדים. מתאפסת ברגע שנשלחה.
   */
  const [priorForRefine, setPriorForRefine] = useState<{
    action: string;
    params: Record<string, unknown>;
  } | null>(null);
  /**
   * הקראת התשובות בקול — העדפה של המכשיר (כמו עוצמת שמע), לא של
   * החשבון: מי שמדליק באוזניות במשרד לא רוצה שהטלפון יקריא בבית לקוח.
   */
  const [tts, setTts] = useState(false);
  useEffect(() => {
    try {
      setTts(localStorage.getItem("agent-tts") === "on");
    } catch {
      /* דפדפן שחוסם אחסון — נשאר כבוי */
    }
  }, []);
  const speakOut = useCallback(
    (text: string) => {
      if (!tts || text.trim() === "" || typeof window === "undefined") return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "he-IL";
        window.speechSynthesis.speak(utterance);
      } catch {
        /* דפדפן בלי תמיכה — ההקראה פשוט לא קוראת */
      }
    },
    [tts],
  );

  /*
   * הדוגמאות נטענות מהשרת ולא מוקלדות כאן.
   *
   * הן נגזרות מהקטלוג ומסוננות לפי ההרשאות של המשתמש, ולכן סוכן
   * בלי הרשאת שליחה אינו רואה „שלח את הדירה למשה” — דוגמה שהייתה
   * מסתיימת אצלו בשגיאה. רשימה מוקלדת במסך הייתה מתיישנת ברגע
   * שנוספת פעולה.
   *
   * מוצגות שש נבחרות ולא כל הקטלוג (בקשת המשתמש): עשרים ומשהו
   * צ'יפים הם קיר טקסט שאיש אינו קורא. שש שמכסות את הסוגים —
   * חיפוש, שאילתה, קליטה, נכס, תזכורת ורשת — מלמדות את הרוחב,
   * והשאר מתגלה מהשימוש עצמו.
   */
  useEffect(() => {
    if (authLoading) return;
    const FEATURED = [
      "search",
      "find_buyers",
      "create_buyer",
      "create_property",
      "create_task",
      "share_property",
    ];
    apiGet<AgentCapability[]>("/agent/capabilities")
      .then((caps) => {
        const featured = caps.filter((cap) => FEATURED.includes(cap.id));
        // הרשאות קיצצו את הנבחרות? משלימים מהשאר עד שש
        const rest = caps.filter((cap) => !FEATURED.includes(cap.id));
        const picked = [...featured, ...rest].slice(0, 6);
        setExamples(picked.map((cap) => cap.examples[0]).filter(Boolean) as string[]);
      })
      .catch(() => setExamples([]));
    // אותן המלצות של המאמן בדשבורד — שלוש הדחופות, כפתיחה יזומה
    apiGet<Recommendation[]>("/coach/recommendations")
      .then((all) => setRecs(all.slice(0, 3)))
      .catch(() => setRecs([]));
  }, [authLoading]);

  const interpret = useCallback(
    async (text: string, prior?: { action: string; params: Record<string, unknown> }) => {
      if (text.trim().length < 2) {
        setError("אמרו או הקלידו משהו קודם");
        return;
      }
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const next = await apiPost<Proposal>("/agent/interpret", {
          transcript: text.trim(),
          ...(prior ? { prior } : {}),
          ...(history.length > 0 ? { history: history.slice(-6) } : {}),
        });
        /*
         * ברכה/שאלה כללית — תשובה שיחתית במקום כרטיס "לא הבנתי".
         * מוצגת כתוצאה רגילה; אין מה לאשר כי שום דבר לא מבוצע.
         */
        if (next.actionId === "unknown" && next.reply !== undefined && next.reply !== "") {
          setProposal(null);
          setResult({ message: next.reply });
          setTranscript("");
          speakOut(next.reply);
          return;
        }
        setProposal(next);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "לא הצלחתי לנתח את הבקשה");
      } finally {
        setBusy(false);
      }
    },
    [history, speakOut],
  );

  function onDone(executed: ExecuteResult, executedParams?: Record<string, unknown>): void {
    setProposal(null);
    if (executed.message === "") return; // בוטל
    /*
     * התור נכנס לזיכרון רק אחרי ביצוע אמיתי, עם הפרמטרים **שנשלחו
     * בפועל** — כולל עריכות ובחירת מועמד (ביקורת Codex). התקציר
     * כולל את שמות התוצאות לפי הסדר — זה מה שמאפשר "תתקשר לראשון
     * מהם" בתור הבא.
     */
    if (proposal !== null && proposal.actionId !== "unknown" && executedParams !== undefined) {
      const dataSummary = summarizeData(executed.data);
      setHistory((prev) => [
        ...prev.slice(-5),
        {
          transcript: transcript.trim(),
          action: proposal.actionId,
          params: executedParams,
          resultSummary: [executed.message, dataSummary]
            .filter((part) => part !== "")
            .join(". ")
            .slice(0, 600),
        },
      ]);
    }
    setResult(executed);
    setTranscript("");
    // ההקראה: המסקנה והתובנה, לא רשימת הנתונים כולה
    speakOut([executed.message, executed.insight].filter(Boolean).join(". "));
    /*
     * ניווט רק אחרי פעולה שיצרה או שינתה משהו. לשאילתה יש `href`
     * למסך המלא, אבל התשובה כבר כאן — ניווט אוטומטי היה זורק את
     * המתווך ממנה לפני שהספיק לקרוא.
     */
    if (executed.href !== undefined && executed.data === undefined) {
      router.push(executed.href);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconMic s={24} />
        </span>
        <div>
          <h1 className="m-0 text-[26px] font-extrabold leading-tight">הסוכן</h1>
          <p className="m-0 mt-1 text-[16px]" style={{ color: "var(--color-text-muted)" }}>
            דברו או הקלידו רגיל. אראה לכם מה הבנתי לפני שאעשה משהו.
          </p>
        </div>
        <button
          type="button"
          className="ms-auto self-start"
          aria-pressed={tts}
          aria-label={tts ? "כיבוי הקראת התשובות" : "הקראת התשובות בקול"}
          title={tts ? "הקראה פועלת — לחצו לכיבוי" : "הקראת התשובות בקול"}
          style={{ color: tts ? "var(--color-primary)" : "var(--color-text-muted)", lineHeight: 0 }}
          onClick={() => {
            const next = !tts;
            setTts(next);
            try {
              localStorage.setItem("agent-tts", next ? "on" : "off");
            } catch {
              /* דפדפן שחוסם אחסון — ההעדפה תחיה עד הרענון */
            }
            if (!next && typeof window !== "undefined") window.speechSynthesis?.cancel();
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 9v6h4l5 4V5L8 9H4z"
              fill="currentColor"
            />
            {tts ? (
              <path
                d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M16.5 9.5l5 5m0-5l-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </header>

      {/*
        הסוכן פותח ביוזמה: מה שהכי כדאי לטפל בו היום, מאותו מנוע
        המלצות של הדשבורד. מי שנכנס "רק לשאול משהו" רואה קודם את
        מה שמחכה לו — עוזר אמיתי לא רק עונה, הוא מזכיר.
      */}
      {recs.length === 0 ? null : (
        <section className="mv-example-box mb-5" aria-labelledby="agent-today">
          <h2 id="agent-today" className="m-0 mb-2.5 text-[15px] font-bold">
            <IconTarget s={15} /> כדאי לטפל היום:
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {recs.map((rec) => {
              const href = recHref(rec);
              return (
                <li key={`${rec.type}-${rec.entityId ?? rec.title}`} className="text-[14.5px]">
                  <span className="font-semibold">{rec.title}</span>
                  <span style={{ color: "var(--color-text-muted)" }}> — {rec.body}</span>{" "}
                  {href === null ? null : (
                    <a href={href} className="underline">
                      לטיפול ←
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {examples.length === 0 || examplesBox.hidden ? null : (
        <section className="mv-example-box mb-5" aria-labelledby="agent-examples">
          <div className="mb-2.5 flex items-center gap-2">
            <h2 id="agent-examples" className="m-0 text-[15px] font-bold">
              למשל, אפשר להגיד:
            </h2>
            <button
              type="button"
              className="ms-auto text-[14px] underline"
              style={{ color: "var(--color-text-muted)" }}
              onClick={examplesBox.never}
            >
              אל תציג יותר
            </button>
            <button
              type="button"
              aria-label="סגירת הדוגמאות"
              style={{ color: "var(--color-text-muted)", lineHeight: 0 }}
              onClick={examplesBox.close}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                className="mv-example-chip"
                onClick={() => {
                  setTranscript(example);
                  setProposal(null);
                  setResult(null);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </section>
      )}

      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      <VoiceRecorder
        value={transcript}
        onChange={(value) => {
          setTranscript(value);
          setProposal(null);
        }}
        label="מה לעשות?"
        placeholder='לדוגמה: "תוסיף קונה משה כהן 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית"'
        onError={setError}
      />

      {proposal === null ? (
        <Button onClick={() => void interpret(transcript)} disabled={busy} className="w-full">
          {busy ? "חושב…" : "מה לעשות עם זה?"}
        </Button>
      ) : proposal.actionId === "unknown" ? (
        <div className="mv-proposal">
          <p className="m-0 mb-2 font-semibold">לא הצלחתי לזהות מה לעשות</p>
          <p className="m-0 text-[15px]" style={{ color: "var(--color-text-muted)" }}>
            {proposal.clarify ??
              "אפשר לנסח אחרת, או ללחוץ על אחת הדוגמאות למעלה כדי לראות מה אני יודע לעשות."}
          </p>
          {/*
            **למה זה נכשל, ולא רק שזה נכשל.**

            כשמנוע ההבנה אינו זמין, מה שרץ הוא מנוע החוקים — הוא
            מזהה ניסוחים מוכרים בלבד, ולכן משפט סביר לחלוטין נדחה.
            בלי השורה הזו הכישלון נראה כמו תקלה במערכת או כמו משפט
            שגוי (דיווח המשתמש).

            "אינו זמין כרגע" ולא "אינו מוגדר": ה-fallback נדלק גם על
            כשל רגעי של הספק, והמסך אינו יודע להבדיל. הודעה שקובעת
            "לא מוגדר" בזמן תקלה חולפת שולחת את מנהל המשרד לתקן
            הגדרה תקינה (ביקורת Codex).
          */}
          {proposal.fallback ? (
            <p
              className="m-0 mt-2 text-[14.5px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              שירות ההבנה החכמה אינו זמין כרגע, ולכן זוהו רק ניסוחים
              מוכרים. אם זה חוזר על עצמו — בדקו את ההגדרה שלו במסך
              ההגדרות.
            </p>
          ) : null}
          {proposal.warnings.length === 0 ? null : (
            <ul className="mt-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              {proposal.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <ProposalCard
          proposal={proposal}
          transcript={transcript}
          onDone={onDone}
          onRefine={(params) => {
            setPriorForRefine({ action: proposal.actionId, params });
            setProposal(null);
            setTranscript("");
            setError(null);
            setResult({
              message: "אמרו מה לתקן — למשל „לא, 4 חדרים” או „תוסיף גם גבעתיים”",
            });
          }}
        />
      )}

      {result === null ? null : (
        <div className="mt-4">
          {result.message === "" ? null : (
            <Notice tone="success" onClose={() => setResult(null)}>
              {result.message}
              {result.href !== undefined && (result.data !== undefined || result.audio !== undefined) ? (
                <>
                  {" "}
                  <a href={result.href} className="underline">
                    למסך המלא ←
                  </a>
                </>
              ) : null}
            </Notice>
          )}
          {/* התובנה לפני הרשימה: המסקנה קודם, הפירוט למי שרוצה */}
          {result.insight === undefined ? null : (
            <p
              className="mb-2 mt-3 rounded-lg px-4 py-2.5 text-[15.5px] font-semibold"
              style={{ background: "var(--color-primary-soft)" }}
            >
              {result.insight}
            </p>
          )}
          {result.data === undefined ? null : <AgentResults data={result.data} />}
          {/*
            צעד ההמשך המוצע — לחיצה שולחת אותו כמשפט חדש דרך אותו
            מסלול הבנה⟵אישור. שום דבר אינו מבוצע מהלחיצה עצמה.
          */}
          {result.suggestion === undefined || result.suggestion === "" ? null : (
            <button
              type="button"
              className="mv-example-chip mt-3"
              disabled={busy}
              onClick={() => {
                const next = result.suggestion ?? "";
                setResult(null);
                setTranscript(next);
                void interpret(next);
              }}
            >
              אפשר להמשיך: „{result.suggestion}”
            </button>
          )}
        </div>
      )}

      {/*
        „שלחו את התיקון” מופיע רק אחרי בקשת תיקון, כדי שהמסך לא
        יציע פעולה שאין לה הקשר.
      */}
      {priorForRefine !== null && proposal === null && transcript.trim().length > 1 ? (
        <Button
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => {
            const prior = priorForRefine;
            setPriorForRefine(null);
            void interpret(transcript, prior);
          }}
        >
          שלחו את התיקון
        </Button>
      ) : null}
    </div>
  );
}
