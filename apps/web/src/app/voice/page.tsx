"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useUserDismissed } from "@/lib/dismissed-panels";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMic } from "../icons";
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


export default function AgentPage(): React.JSX.Element {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  // סגירה ו"אל תציג יותר" (בקשת המשתמש) — נשמר למשתמש, בכל מכשיר
  const examplesBox = useUserDismissed("agent-examples");
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
        });
        setProposal(next);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : "לא הצלחתי לנתח את הבקשה");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function onDone(executed: ExecuteResult): void {
    setProposal(null);
    if (executed.message === "") return; // בוטל
    setResult(executed);
    setTranscript("");
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
      </header>

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
              {result.href !== undefined && result.data !== undefined ? (
                <>
                  {" "}
                  <a href={result.href} className="underline">
                    למסך המלא ←
                  </a>
                </>
              ) : null}
            </Notice>
          )}
          {result.data === undefined ? null : <AgentResults data={result.data} />}
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
