"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { ApiError, apiPost } from "@/lib/api";
import { agentResultRefs, agentTurnRefs, type AgentHistoryRef } from "@metavchim/shared";
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
  candidates?: {
    key: string;
    idKey: string;
    label: string;
    options: { id: string; label: string; detail?: string }[];
    /** `unsaid` — לא נאמר על מי מדובר; `not_found` — נאמר ולא נמצא. */
    reason?: "unsaid" | "not_found";
  };
  clarify?: string;
  /** תשובה שיחתית לברכה/שאלה כללית — מוצגת במקום "לא הבנתי" */
  reply?: string;
  fallback: boolean;
  /** צעדי המשך — משפט אחד שביקש כמה פעולות, אישור אחד לכולן */
  followUps?: Proposal[];
}

export interface ExecuteResult {
  href?: string;
  message: string;
  data?: unknown;
  /** משפט תובנה על תוצאות שאילתה — מוצג מעל הרשימה */
  insight?: string;
  /** צעד המשך מוצע — לחיצה שולחת אותו כמשפט חדש, דרך אותו אישור */
  suggestion?: string;
  /**
   * הקלטה שהתוצאה מצביעה עליה.
   *
   * במסך אין נגן משלנו — ההשמעה היא במסך השיחות, שם היא כבר
   * קיימת. השדה כאן קיים כדי שהקישור למסך יופיע גם לתוצאה שאין
   * לה `data` (הקלטה בלי תקציר), ולא רק כטקסט בלי דרך להגיע
   * אליה (ביקורת Codex).
   */
  audio?: { callId: string; label: string };
  /**
   * הרשומה שהפעולה נגעה בה — הכרטיס שנפתח, הקונה שנוצר.
   *
   * המזהה נשאר בין הדפדפן לשרת ואינו מגיע לפרומפט; הוא מה שהופך
   * „תזכיר לי להתקשר אליה” לשיוך במקום לחיפוש טקסט.
   */
  ref?: AgentHistoryRef;
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
  transcript,
  onDone,
  onRefine,
}: {
  proposal: Proposal;
  /** המשפט המקורי — נשלח לביצוע כדי שהשרת ינסח תובנה על שאילתות */
  transcript?: string;
  /**
   * `executedParams` — הפרמטרים **שנשלחו בפועל**, כולל עריכות
   * ובחירת מועמד. זיכרון השיחה נבנה מהם ולא מההצעה המקורית: תיקון
   * ידני של עיר או בחירת רשומה הם חלק ממה שבוצע (ביקורת Codex).
   */
  /**
   * ‎`refs` נבנות **כאן** ולא אצל הקורא, כי רק כאן ידועות תוצאות
   * צעדי ההמשך: התוצאה המצטברת נושאת הודעה אחת, ובה כבר אין
   * ‎`ref`‎ ואין `data` של אף צעד (ביקורת Codex).
   */
  onDone: (
    result: ExecuteResult,
    executedParams?: Record<string, unknown>,
    refs?: AgentHistoryRef[],
  ) => void;
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
    /*
     * שדות שהושלמו ידנית מגיעים מהתיבה כמחרוזת, והשרת מקבל טיפוסים
     * (`num()` דוחה "2300000" כמחרוזת בשקט). ההמרה כאן, ברגע
     * השליחה: מספר נקי ⟵ number, ערים ⟵ רשימה, ריק ⟵ לא נשלח.
     */
    for (const missing of proposal.missing) {
      const raw = merged[missing.key];
      if (typeof raw !== "string") continue;
      const value = looseValue(missing.key, raw);
      if (value === undefined) delete merged[missing.key];
      else merged[missing.key] = value;
    }
    if (chosen !== null && proposal.candidates !== undefined) {
      // השרת אומר תחת איזה מפתח נשלחת הבחירה — לא ניחוש לפי הפעולה
      merged[proposal.candidates.idKey] = chosen;
    }
    return merged;
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const sent = params();
      const primary = await apiPost<ExecuteResult>("/agent/execute", {
        action: proposal.actionId,
        params: sent,
        // המשפט המקורי — בלעדיו השרת לא מנסח תובנה על שאילתות
        ...(transcript !== undefined && transcript.trim() !== ""
          ? { transcript: transcript.trim() }
          : {}),
      });
      const followUps = proposal.followUps ?? [];
      /*
       * שורות התוצאה נלקחות מהראשית בלבד — הן מה שהמתווך **ראה**.
       * לצעד המשך יש הודעה בתוך ההודעה המצטברת, לא רשימה על המסך.
       */
      const shown = agentResultRefs(primary.data);
      if (followUps.length === 0) {
        onDone(primary, sent, agentTurnRefs([primary.ref], shown));
        return;
      }
      /*
       * צעדי ההמשך רצים **אחרי** שהראשי הצליח ולפי הסדר — "תקבע לו
       * סיור" יכול למצוא את הקונה רק אחרי שהוא נוצר. כישלון באמצע
       * אינו מוחק את מה שכבר בוצע (אי אפשר), ולכן הוא מדווח בשקיפות
       * במקום להיראות כאילו הכול הצליח.
       */
      const messages = [primary.message];
      /*
       * מהמאוחר לקדום: „תוסיף קונה דנה ותזכיר לי להתקשר אליה” ואז
       * „תסגור אותה” מתכוון למשימה, לא לקונה. `agentTurnRefs` שומרת
       * על הסדר, ו-`matchHistoryRef` בוחרת את הראשון.
       */
      const acted: (AgentHistoryRef | undefined)[] = [primary.ref];
      let failure: string | null = null;
      for (const step of followUps) {
        try {
          const stepParams: Record<string, unknown> = {};
          for (const field of step.fields) stepParams[field.key] = field.value;
          const done = await apiPost<ExecuteResult>("/agent/execute", {
            action: step.actionId,
            params: stepParams,
          });
          messages.push(done.message);
          // רק צעד שהצליח — הפניה לרשומה שלא נוצרה היא שיוך לכלום
          acted.unshift(done.ref);
        } catch (err: unknown) {
          failure = `„${step.title}” לא בוצע: ${
            err instanceof ApiError ? err.message : "שגיאה"
          }`;
          break;
        }
      }
      onDone(
        {
          message:
            failure === null
              ? messages.join(" · ")
              : `${messages.join(" · ")} · ${failure}`,
          // בכישלון חלקי לא מנווטים — ניווט היה מסתיר את ההודעה
          ...(failure === null && primary.href !== undefined ? { href: primary.href } : {}),
        },
        sent,
        agentTurnRefs(acted, shown),
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
          <h2 id="proposal-title" className="m-0 text-[length:var(--type-screen-title)] font-bold">
            {proposal.title}
          </h2>
          {proposal.summary === "" ? null : (
            <p className="m-0 mt-1 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
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
        <p className="text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
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

      {/*
        השדות שלא זוהו — תיבות ריקות להשלמה, לא רק שורת "חסר עדיין".
        המשתמש ביקש בדיוק את זה: מי שרואה "חסר: שם" נאלץ לבטל ולדבר
        שוב; מי שרואה תיבה ריקה מקליד את השם וממשיך.
      */}
      {proposal.missing.length === 0 ? null : (
        <div className="mt-2">
          <p className="m-0 mb-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            <IconPin s={14} /> לא זוהה בדיבור — אפשר להשלים כאן:
          </p>
          <dl className="mv-proposal-grid">
            {proposal.missing.map((missing) => (
              <div key={missing.key} className="mv-proposal-row">
                <dt className="mv-proposal-label">{missing.label}</dt>
                <dd className="mv-proposal-value">
                  <input
                    className="mv-field"
                    value={String(edits[missing.key] ?? "")}
                    aria-label={missing.label}
                    placeholder={LIST_KEYS.has(missing.key) ? "מופרדות בפסיק" : ""}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [missing.key]: e.target.value }))
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/*
        זיהוי הישות — הפעולה חסומה עד לבחירה.
        „שלח לשרה” כששתי שרה קיימות הוא בדיוק המקרה שבו טעות שקטה
        מגיעה לאדם הלא נכון, ולכן אין כאן ברירת מחדל.
      */}
      {proposal.candidates === undefined ? null : (
        <fieldset className="mv-proposal-choice">
          <legend className="text-[length:var(--type-body-sm)] font-semibold">{proposal.candidates.label}</legend>
          {noCandidates ? (
            <p className="m-0 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-danger)" }}>
              {proposal.candidates.reason === "unsaid"
                ? 'לא הבנתי על מי מדובר. לחצו „תקנו אותי” ואמרו את השם.'
                : "לא נמצאה רשומה מתאימה במאגר. אפשר לחפש ידנית ולהמשיך משם."}
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

      {/*
        צעדי המשך — "תוסיף קונה משה ותקבע לו סיור" באישור אחד.
        מוצגים לקריאה בלבד: מי שרוצה לערוך צעד המשך מריץ אותו
        בנפרד; המקרה הנפוץ הוא אישור של מה שנאמר, לא עריכה.
      */}
      {proposal.followUps === undefined || proposal.followUps.length === 0 ? null : (
        <div className="mt-3">
          <p className="m-0 mb-1 text-[length:var(--type-caption-lg)] font-semibold">
            וגם, באותו אישור:
          </p>
          {proposal.followUps.map((step, i) => (
            <div
              key={`${step.actionId}-${i}`}
              className="mb-2 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <p className="m-0 text-[length:var(--type-body-sm)] font-semibold">
                {step.title}
                {step.summary === "" ? null : (
                  <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    — {step.summary}
                  </span>
                )}
              </p>
              {step.fields.length === 0 ? null : (
                <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                  {step.fields.map((f) => `${f.label}: ${f.display}`).join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void confirm()} disabled={busy || needsChoice || noCandidates}>
          <IconCheck s={15} />{" "}
          {busy
            ? "מבצע…"
            : proposal.followUps !== undefined && proposal.followUps.length > 0
              ? `אשר את הכול (${proposal.followUps.length + 1} פעולות)`
              : CONFIRM_LABEL[proposal.risk]}
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
  /*
   * מזהה רשומה שנפתר מהמאגר (buyerId, cardId…) מוצג ואינו נערך:
   * עריכה של הטקסט המוצג הייתה שולחת את **השם** במקום המזהה,
   * והביצוע היה נכשל או פוגע ברשומה אחרת (ביקורת Codex). תיקון
   * הבחירה נעשה בניסוח מחדש („תקנו אותי”), לא בהקלדה על מזהה.
   */
  if (field.key.endsWith("Id")) return false;
  return typeof field.value === "string" || typeof field.value === "number";
}

/** טקסט מהתיבה ⟵ הטיפוס שהשדה נושא. */
function coerce(field: ProposalField, raw: string): unknown {
  if (typeof field.value !== "number") return raw;
  const parsed = Number(raw.replace(/[^\d.-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : field.value;
}

/** מפתחות שהשרת מצפה בהם לרשימה — פסיקים בתיבה מתפרקים לאיברים. */
const LIST_KEYS = new Set(["cities", "neighborhoods", "mustFeatures"]);

/**
 * מפתחות מספריים — **לפי שם המפתח, לא לפי צורת הקלט.**
 *
 * המרה לפי צורה הפכה טלפון שהוקלד ("0501234567") למספר: האפס
 * המוביל נפל, והשרת — שקורא טלפון כמחרוזת — דחה את הערך ודיווח
 * שהטלפון עדיין חסר (ביקורת Codex). רק מפתח שידוע כמספרי מומר;
 * טלפון, שם ועיר נשארים מחרוזת גם כשהם ספרות בלבד.
 */
const NUMERIC_KEY =
  /Shekels$|^rooms(?:Min|Max)?$|^areaSqm(?:Min)?$|^floor$|^totalFloors$|^commissionSplit$/u;

/**
 * השלמה ידנית של שדה חסר ⟵ הטיפוס שהשרת מצפה לו.
 *
 * אין כאן `field.value` ללמוד ממנו את הטיפוס — השדה לא זוהה בכלל.
 * ההכרעה לפי שם המפתח: מפתח רשימה מתפרק בפסיקים, מפתח מספרי מומר
 * ל-number ("2,300,000" כולל פסיקי אלפים), וכל השאר מחרוזת. ריק
 * אינו נשלח — שדה שלא הושלם נשאר חסר, בדיוק כמו קודם.
 */
function looseValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (LIST_KEYS.has(key)) {
    const items = trimmed.split(",").map((item) => item.trim()).filter((item) => item !== "");
    return items.length > 0 ? items : undefined;
  }
  if (NUMERIC_KEY.test(key)) {
    const parsed = Number(trimmed.replace(/[^\d.-]/gu, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return trimmed;
}
