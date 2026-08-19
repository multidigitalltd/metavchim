"use client";

import { useState, type KeyboardEvent } from "react";
import {
  MAX_REFERRAL_RATING,
  MAX_REFERRAL_RATING_COMMENT,
  MIN_REFERRAL_RATING,
  REFERRAL_RATING_LABELS,
  overallRatingScore,
  ratingDimensionsFor,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiPost } from "@/lib/api";
import { DictateFor } from "../dictation-field";
import { IconStar } from "../icons";

/**
 * דירוג הדדי על הפניית לקוח — **ממד לכל שאלה, לא כוכב אחד לכל.**
 *
 * התמורה על ההפניה משולמת ברגע הקליטה ולא על עסקה שנסגרה, ואין
 * החזרים — הדירוג הוא המנגנון היחיד שמייקר הפניית זבל. לכן הוא
 * יושב בדיוק בשני המקומות שבהם רואים הפניה שהסתיימה: כרטיס הליד של
 * המפנה, והלוח של הקולט.
 *
 * ציון יחיד לא עשה את העבודה: "3 מתוך 5" אינו אומר אם הפרטים היו
 * שגויים או שהלקוח פשוט לא ענה — שתי בעיות שונות לגמרי, שאחת מהן
 * באשמת המפנה והשנייה לא. הממדים (`ratingDimensionsFor`) הופכים את
 * הדירוג למידע שאפשר לפעול לפיו, והציון הכולל נגזר מהם בשרת ולא
 * נמסר מהמסך.
 *
 * שני הצדדים מדרגים, אבל רק דירוג הקולט נספר למוניטין המפנה —
 * אחרת משרד היה מדרג את ההפניות של עצמו חמישה כוכבים.
 */
export interface ReferralRatingValue {
  /** הציון הכולל בכוכבים, כפי שחושב בשרת. */
  score: number;
  /** הציון בכל ממד — המפתחות הם `ratingDimensionsFor(role)`. */
  scores: Record<string, number>;
  comment?: string;
}

const STARS = Array.from(
  { length: MAX_REFERRAL_RATING - MIN_REFERRAL_RATING + 1 },
  (_, index) => MIN_REFERRAL_RATING + index,
);

/**
 * שורת כוכבים אחת — ממד אחד.
 *
 * קבוצת רדיו ולא ערימת כפתורים: קורא מסך צריך לשמוע "3 מתוך 5",
 * ומקלדת עוברת על החמישה בחצים — לא ב-Tab חמש פעמים. לכן tabindex
 * נודד: רק הכוכב הנבחר (או הראשון, כשעוד לא נבחר) נמצא בסדר ה-Tab.
 */
function StarRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  /**
   * ניווט בחצים בתוך הקבוצה.
   *
   * המסך בעברית ולכן החצים הפוכים ויזואלית: „ימינה” מקטין ו„שמאלה”
   * מגדיל. למעלה/למטה נשארים מוחלטים — הם אינם תלויי כיוון כתיבה.
   */
  function moveWithArrows(event: KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? 1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = value === 0 ? MIN_REFERRAL_RATING : value;
    const next = Math.min(
      MAX_REFERRAL_RATING,
      Math.max(MIN_REFERRAL_RATING, current + step),
    );
    onChange(next);
    // הבחירה והמיקוד נעים יחד — אחרת קורא המסך מכריז על כוכב אחר
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-star="${next}"]`)
      ?.focus();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
      <span className="text-[12.5px]">
        <b>{label}</b>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>{hint}</span>
      </span>
      <div
        role="radiogroup"
        aria-label={`${label} — ${hint}`}
        className="flex items-center gap-1"
        onKeyDown={moveWithArrows}
      >
        {STARS.map((star) => {
          const active = star <= value;
          const focusable = value === 0 ? star === STARS[0] : star === value;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} — ${REFERRAL_RATING_LABELS[star]}`}
              title={REFERRAL_RATING_LABELS[star]}
              disabled={disabled}
              tabIndex={focusable ? 0 : -1}
              data-star={star}
              onClick={() => onChange(star)}
              /*
               * כוכב ריק נשאר קו מתאר; המסומנים מתמלאים. המילוי דרך
               * CSS ולא דרך prop לאייקון — `fill` בקובץ האייקונים הוא
               * תכונת תצוגה, וכלל CSS גובר עליה בלי לפצל את הרכיב.
               */
              className={`mv-btn-plain px-0.5 py-0.5${active ? " [&>svg]:fill-current" : ""}`}
              style={{
                color: active
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
              }}
            >
              <IconStar s={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReferralRating({
  sharedLeadId,
  role,
  mine,
  counterpart,
  onSaved,
}: {
  sharedLeadId: string;
  /** "given" = דירוג הלקוח שהפניתי, "received" = דירוג ההפניה שקלטתי */
  role: "given" | "received";
  mine?: ReferralRatingValue;
  counterpart?: ReferralRatingValue;
  onSaved?: (value: ReferralRatingValue) => void;
}) {
  /*
   * מי מדרג קובע מה נשאל: מי שקלט הפניה שופט את ההפניה, ומי שהפנה
   * שופט את הטיפול בלקוח. אותו קטלוג משמש גם את השרת לאימות — מפתח
   * שאינו בו נדחה, כדי שציון לא ייעלם תחת מפתח שאיש אינו קורא.
   */
  const dimensions = ratingDimensionsFor(
    role === "received" ? "receiver" : "referrer",
  );
  const [scores, setScores] = useState<Record<string, number>>(
    () => mine?.scores ?? {},
  );
  const [comment, setComment] = useState<string>(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(mine !== undefined);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `referralComment_${sharedLeadId}`;

  /*
   * הצגה בלבד — הציון הקובע נגזר בשרת מהממדים שנשמרו. חישוב מקומי
   * שמוצג בזמן הדירוג עדיף על שדה ריק עד השמירה, אך אינו נשלח.
   */
  const overall = overallRatingScore(scores);

  async function submit(): Promise<void> {
    if (overall === null) return;
    setBusy(true);
    setError(null);
    const trimmed = comment.trim();
    try {
      await apiPost(`/collaboration/leads/${sharedLeadId}/rating/${role}`, {
        scores,
        ...(trimmed ? { comment: trimmed } : {}),
      });
      setSaved(true);
      onSaved?.({
        score: overall,
        scores,
        ...(trimmed ? { comment: trimmed } : {}),
      });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הדירוג נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <p className="m-0 mb-1 text-[13px] font-semibold">
        {role === "received" ? "איך הייתה ההפניה?" : "איך היה הלקוח שהפניתם?"}
      </p>
      <p
        className="m-0 mb-2 text-[12px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        ממד שאינכם יודעים לשפוט — השאירו ריק. הוא לא ייספר בציון.
      </p>

      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {dimensions.map((dimension) => (
          <StarRow
            key={dimension.key}
            label={dimension.label}
            hint={dimension.hint}
            value={scores[dimension.key] ?? 0}
            disabled={busy}
            onChange={(next) =>
              setScores((current) => ({ ...current, [dimension.key]: next }))
            }
          />
        ))}
      </div>

      {overall === null ? null : (
        <p
          className="mt-2 mb-0 text-[12.5px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          ציון כולל: <b>{overall}</b> מתוך {MAX_REFERRAL_RATING}
        </p>
      )}

      <label
        htmlFor={fieldId}
        className="mt-2 flex flex-col gap-1 text-[12.5px]"
      >
        <span style={{ color: "var(--color-text-muted)" }}>
          הערה לצד השני (רשות) — נראית רק לשני המשרדים שבהפניה
        </span>
        <span className="flex items-start gap-2">
          <textarea
            id={fieldId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={MAX_REFERRAL_RATING_COMMENT}
            rows={2}
            className="flex-1 rounded-lg border px-3 py-2"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
            }}
          />
          <DictateFor targetId={fieldId} />
        </span>
      </label>

      {error ? (
        <p
          role="alert"
          className="mt-2 mb-0 text-[12.5px]"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy || overall === null}
          onClick={() => void submit()}
        >
          {busy ? "שומר…" : saved ? "עדכון הדירוג" : "שליחת הדירוג"}
        </Button>
        {saved && !busy ? (
          <span
            className="text-[12.5px]"
            style={{ color: "var(--color-success)" }}
          >
            ✓ הדירוג נשמר
          </span>
        ) : null}
      </div>

      {counterpart ? (
        <CounterpartRating
          role={role === "received" ? "referrer" : "receiver"}
          value={counterpart}
        />
      ) : null}
    </div>
  );
}

/**
 * מה שהצד השני נתן — **בפירוט ולא בציון בודד.**
 *
 * הממדים מוצגים לפי הקטלוג של מי שדירג, לא של מי שקורא: המפנה
 * מדרג שלושה ממדים אחרים מאלה של הקולט, והצגה לפי הקטלוג הלא נכון
 * הייתה מציגה שורות ריקות לצד ציונים שנעלמו.
 */
function CounterpartRating({
  role,
  value,
}: {
  /** מי **נתן** את הדירוג. */
  role: "referrer" | "receiver";
  value: ReferralRatingValue;
}) {
  const given = ratingDimensionsFor(role).filter(
    (dimension) => typeof value.scores[dimension.key] === "number",
  );
  return (
    <div
      className="mt-2 text-[12.5px]"
      style={{ color: "var(--color-text-muted)" }}
    >
      <b>{role === "referrer" ? "המשרד המפנה" : "המשרד הקולט"} דירג:</b>{" "}
      {value.score}/{MAX_REFERRAL_RATING}
      {given.length > 0 ? (
        <ul className="m-0 mt-1 list-none p-0">
          {given.map((dimension) => (
            <li key={dimension.key}>
              {dimension.label}: {value.scores[dimension.key]}/
              {MAX_REFERRAL_RATING}
            </li>
          ))}
        </ul>
      ) : null}
      {value.comment ? <p className="m-0 mt-1">„{value.comment}”</p> : null}
    </div>
  );
}
