"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { ApiError, apiPost } from "@/lib/api";
import { IconCheck, IconInfo, IconPin, IconX } from "../icons";
import { Notice } from "../notice";

/**
 * כרטיס ההצעה — **מה שהמערכת עומדת לעשות, לפני שהיא עושה אותו.**
 *
 * ## למה כרטיס אחד לכל הפעולות
 *
 * בסוכן הקודם לכל כוונה היה טיפול משלה במסך, ורוב הכוונות קיבלו
 * „המשך ←” שמעביר למסך אחר עם המשפט בפרמטר URL. שם החילוץ רץ
 * **מחדש**, בחוקים, ומה שהמודל הבין נזרק בדרך. המתווך דיבר פעם
 * אחת והמערכת ניתחה פעמיים — עם שתי תוצאות שונות.
 *
 * כאן ההצעה מגיעה מלאה, נערכת **במקום**, ונשלחת לביצוע בדיוק כפי
 * שהיא מוצגת. אין פירוש שני ואין ניווט באמצע.
 *
 * ## למה כל שדה נערך
 *
 * מודל טועה. כשהתיקון היחיד הוא „בטל ודבר שוב”, מתווך שרואה שדה
 * אחד שגוי מוותר על כל הפעולה — וזה מה שמלמד אותו להקליד ידנית
 * מלכתחילה. תיקון של תא אחד עולה שתי שניות.
 *
 * ## למה מוצג ממה כל שדה הובן
 *
 * „4 חדרים” לבדו אינו אומר אם המערכת שמעה או ניחשה. שורת הראיה
 * מתחת לערך מראה את המילים המקוריות, ולכן אפשר לסמוך על הכרטיס
 * בלי לקרוא את כולו — בודקים את מה שנראה חשוד.
 */

export interface ProposalField {
  key: string;
  label: string;
  value: unknown;
  display: string;
  source: "llm" | "rules" | "resolved" | "user";
  evidence?: string;
}

export interface Proposal {
  actionId: string;
  title: string;
  risk: "read" | "create" | "update" | "outbound";
  summary: string;
  fields: ProposalField[];
  missing: { key: string; label: string }[];
  warnings: string[];
  candidates?: { key: string; label: string; options: { id: string; label: string; detail?: string }[] };
  clarify?: string;
  fallback: boolean;
}

export interface ExecuteResult {
  href?: string;
  message: string;
  data?: unknown;
}

const SOURCE_LABEL: Record<ProposalField["source"], string> = {
  llm: "הובן מהמשפט",
  rules: "זוהה בכללים",
  resolved: "חושב במערכת",
  user: "הוקלד ידנית",
};

/** מה נדרש כדי לאשר, לפי כמה הפעולה יקרה אם היא שגויה. */
const CONFIRM_LABEL: Record<Proposal["risk"], string> = {
  read: "הצג תשובה",
  create: "צור",
  update: "עדכן",
  outbound: "המשך לשליחה",
};

export function ProposalCard({
  proposal,
  onDone,
  onRefine,
}: {
  proposal: Proposal;
  onDone: (result: ExecuteResult) => void;
  /** תיקון בדיבור — „לא, 4 חדרים”. ההצעה הקודמת נשלחת כהקשר. */
  onRefine?: (params: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * הצעה חדשה מאפסת את התיקונים. בלי זה ערך שהמתווך הקליד על ההצעה
   * הקודמת היה שורד אל החדשה ומזהם אותה בשקט.
   */
  useEffect(() => {
    setEdits({});
    setChosen(null);
    setError(null);
  }, [proposal]);

  const needsChoice = proposal.candidates !== undefined && chosen === null;
  const noCandidates =
    proposal.candidates !== undefined && proposal.candidates.options.length === 0;

  function params(): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const field of proposal.fields) merged[field.key] = field.value;
    Object.assign(merged, edits);
    if (chosen !== null) {
      merged[proposal.actionId === "update_property" ? "propertyId" : "buyerId"] = chosen;
    }
    return merged;
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await apiPost<ExecuteResult>("/agent/execute", {
          action: proposal.actionId,
          params: params(),
        }),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-proposal" aria-labelledby="proposal-title">
      <header className="mv-proposal-head">
        <div>
          <h2 id="proposal-title" className="m-0 text-[19px] font-bold">
            {proposal.title}
          </h2>
          {proposal.summary === "" ? null : (
            <p className="m-0 mt-1 text-[15px]" style={{ color: "var(--color-text-muted)" }}>
              {proposal.summary}
            </p>
          )}
        </div>
        {/*
          „זוהה בכללים” מוצג כשהמנוע הדטרמיניסטי הכריע — כלומר
          Gemini לא היה זמין. זה משנה כמה לבדוק את הכרטיס, ולכן
          זה נאמר ולא נבלע.
        */}
        {proposal.fallback ? (
          <span className="mv-pill" title="הבנת השפה לא הייתה זמינה — הזיהוי נעשה בכללים">
            <IconInfo s={14} /> זיהוי בסיסי
          </span>
        ) : null}
      </header>

      {proposal.clarify === undefined ? null : (
        <Notice tone="info">{proposal.clarify}</Notice>
      )}
      {proposal.warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}
      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {proposal.fields.length === 0 ? (
        <p className="text-[15px]" style={{ color: "var(--color-text-muted)" }}>
          לא זוהו פרטים במשפט. אפשר להשלים אותם במסך הבא.
        </p>
      ) : (
        <dl className="mv-proposal-grid">
          {proposal.fields.map((field) => (
            <div key={field.key} className="mv-proposal-row">
              <dt className="mv-proposal-label">{field.label}</dt>
              <dd className="mv-proposal-value">
                {isEditable(field) ? (
                  <input
                    className="mv-field"
                    value={String(edits[field.key] ?? field.display)}
                    aria-label={field.label}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [field.key]: coerce(field, e.target.value) }))
                    }
                  />
                ) : (
                  <span className="font-medium">{field.display}</span>
                )}
                {field.evidence === undefined ? null : (
                  <span className="mv-proposal-evidence" title={SOURCE_LABEL[field.source]}>
                    „{field.evidence}”
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {proposal.missing.length === 0 ? null : (
        <p className="mt-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
          <IconPin s={14} /> חסר עדיין: {proposal.missing.map((m) => m.label).join(" · ")}
        </p>
      )}

      {/*
        זיהוי הישות — הפעולה חסומה עד לבחירה.
        „שלח לשרה” כששתי שרה קיימות הוא בדיוק המקרה שבו טעות שקטה
        מגיעה לאדם הלא נכון, ולכן אין כאן ברירת מחדל.
      */}
      {proposal.candidates === undefined ? null : (
        <fieldset className="mv-proposal-choice">
          <legend className="text-[15px] font-semibold">{proposal.candidates.label}</legend>
          {noCandidates ? (
            <p className="m-0 text-[15px]" style={{ color: "var(--color-danger)" }}>
              לא נמצאה רשומה מתאימה במאגר. אפשר לחפש ידנית ולהמשיך משם.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {proposal.candidates.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="mv-chip"
                  aria-pressed={chosen === option.id}
                  onClick={() => setChosen(option.id)}
                >
                  {option.label}
                  {option.detail === undefined ? null : (
                    <span style={{ color: "var(--color-text-muted)" }}> · {option.detail}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void confirm()} disabled={busy || needsChoice || noCandidates}>
          <IconCheck s={15} /> {busy ? "מבצע…" : CONFIRM_LABEL[proposal.risk]}
        </Button>
        {onRefine === undefined ? null : (
          <Button variant="ghost" onClick={() => onRefine(params())}>
            תקנו אותי — אמרו מה לשנות
          </Button>
        )}
        <Button variant="ghost" onClick={() => onDone({ message: "" })}>
          <IconX s={15} /> ביטול
        </Button>
      </div>
    </section>
  );
}

/**
 * מה נערך ומה לא.
 *
 * רשימות וערכי בחירה מוצגים בתווית העברית שלהם, ותיבת טקסט עליהם
 * הייתה מזמינה את המתווך להקליד „חם מאוד” לשדה שמצפה ל-`hot`.
 * הם ניתנים לתיקון במסך הכרטיס עצמו, אחרי היצירה, שם יש להם פקד
 * אמיתי.
 */
function isEditable(field: ProposalField): boolean {
  return typeof field.value === "string" || typeof field.value === "number";
}

/** טקסט מהתיבה ⟵ הטיפוס שהשדה נושא. */
function coerce(field: ProposalField, raw: string): unknown {
  if (typeof field.value !== "number") return raw;
  const parsed = Number(raw.replace(/[^\d.-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : field.value;
}
