"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { DictationControls } from "./dictation-field";
import { IconMic } from "./icons";
import { Notice } from "./notice";
import { AgentResults } from "./voice/results";
import { ProposalCard, type ExecuteResult, type Proposal } from "./voice/proposal-card";

/**
 * הסוכן בדשבורד — שורה אחת שעונה על „מה עכשיו”.
 *
 * ## למה זה כמעט ריק עכשיו
 *
 * הגרסה הקודמת הייתה 564 שורות שחזרו על כל מה שיש במסך `/voice`:
 * אותה רשימת כוונות, אותן תוויות, אותו טיפול לכל פעולה בנפרד. שתי
 * מימושים לאותו דבר נפרדים ברגע שאחד מהם מתוקן — וזה מה שקרה:
 * שתי פעולות פשוט נזרקו מכאן למסך המלא, ומי שניסה אותן מהדשבורד
 * נחת במקום אחר וחזר.
 *
 * עכשיו שניהם קוראים לאותו נתיב ומרנדרים את אותו `ProposalCard`.
 * מה שהמסך המלא יודע לעשות — גם כאן, בלי לזכור לעדכן פעמיים.
 *
 * ## ההרשאות
 *
 * הן נבדקות בשרת ומוחזרות מ-`/agent/capabilities`, ולכן הדשבורד
 * אינו צריך להעביר דגלים ואינו יכול לטעות בהם. כפתור שמחזיר 403
 * גרוע מכפתור שאינו קיים.
 */

interface AgentCapability {
  id: string;
  title: string;
  examples: readonly string[];
}

export function VoiceConsole(): React.JSX.Element | null {
  const router = useRouter();
  const [text, setText] = useState("");
  /** טקסט הבסיס להכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    apiGet<AgentCapability[]>("/agent/capabilities")
      .then((caps) =>
        setSuggestions(caps.slice(0, 4).map((cap) => cap.examples[0]).filter(Boolean) as string[]),
      )
      .catch(() => setSuggestions([]));
  }, []);

  async function interpret(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setError("אמרו או הקלידו משהו קודם");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setProposal(await apiPost<Proposal>("/agent/interpret", { transcript: trimmed }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "לא הצלחתי לנתח את הבקשה");
    } finally {
      setBusy(false);
    }
  }

  function onDone(executed: ExecuteResult): void {
    setProposal(null);
    if (executed.message === "") return; // בוטל
    setResult(executed);
    setText("");
    setBase("");
    if (executed.href !== undefined && executed.data === undefined) {
      router.push(executed.href);
    }
  }

  return (
    /*
     * mv-agent ולא mv-card: המשתמש ביקש שהאזור יהיה תחום, צבעוני
     * ומזמין — כרטיס לבן בין כרטיסים לבנים אינו אף אחד מהשלושה.
     * הרקע, המסגרת והתג בצבע הראשי אומרים "כאן מדברים עם המערכת".
     */
    <section className="mv-agent mb-4" aria-labelledby="agent-console-title">
      <div className="mv-agent-head">
        <span className="mv-agent-badge" aria-hidden="true">
          <IconMic s={21} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="agent-console-title" className="mv-agent-title">
            מה עכשיו?
          </h2>
          <p className="mv-agent-sub">
            דברו או כתבו — הסוכן יקלוט, יחפש ויעדכן בשבילכם.
          </p>
        </div>
        <Link href="/voice" className="mv-agent-link">
          {/* שברון ולא חץ — „a text link with a chevron” (§17).
              ‎`dir="ltr"` כי U+2039 הוא תו מראה, וב-RTL היה מתהפך. */}
          למסך הסוכן <span aria-hidden="true" dir="ltr">‹</span>
        </Link>
      </div>

      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="mv-field mv-agent-field"
          style={{ flex: "1 1 260px" }}
          value={text}
          placeholder='למשל: "תוסיף קונה משה כהן, 4 חדרים בבני ברק עד 2.3 מיליון"'
          aria-label="מה לעשות?"
          onChange={(e) => {
            setText(e.target.value);
            setBase(e.target.value);
            setProposal(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void interpret();
          }}
        />
        {/*
          `onIdle` מאפס את טקסט הבסיס בסוף סבב ההקלטה. בלעדיו הקלטה
          שנייה באותו שדה נכתבת על הראשונה במקום להתווסף אחריה.
        */}
        <DictationControls
          onAppend={(spoken) => {
            setText(base === "" ? spoken : `${base} ${spoken}`);
            setProposal(null);
          }}
          onIdle={() => setBase(text)}
        />
        <button type="button" className="mv-btn-action" disabled={busy} onClick={() => void interpret()}>
          {busy ? "חושב…" : "קדימה"}
        </button>
      </div>

      {suggestions.length === 0 || proposal !== null ? null : (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="mv-example-chip"
              onClick={() => {
                setText(suggestion);
                setBase(suggestion);
                setProposal(null);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {proposal === null ? null : proposal.actionId === "unknown" ? (
        <p className="mt-3 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
          {proposal.clarify ?? "לא הצלחתי לזהות מה לעשות. אפשר לנסח אחרת."}
          {/* אותה הבחנה כמו במסך המלא: למה זה נכשל, לא רק שזה נכשל */}
          {proposal.fallback
            ? " שירות ההבנה החכמה אינו זמין כרגע, ולכן זוהו רק ניסוחים מוכרים."
            : ""}
        </p>
      ) : (
        <div className="mt-3">
          <ProposalCard proposal={proposal} onDone={onDone} />
        </div>
      )}

      {result === null ? null : (
        <div className="mt-3">
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
          {result.data === undefined ? null : <AgentResults data={result.data} />}
        </div>
      )}
    </section>
  );
}
