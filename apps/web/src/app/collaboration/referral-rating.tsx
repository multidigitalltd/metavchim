"use client";

import { useState, type KeyboardEvent } from "react";
import {
  MAX_REFERRAL_RATING,
  MAX_REFERRAL_RATING_COMMENT,
  MIN_REFERRAL_RATING,
  REFERRAL_RATING_LABELS,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiPost } from "@/lib/api";
import { DictateFor } from "../dictation-field";
import { IconStar } from "../icons";

/**
 * דירוג הדדי על הפניית לקוח.
 *
 * התמורה על הפניה משולמת ברגע הקליטה ולא על עסקה שנסגרה, ואין
 * החזרים — הדירוג הוא המנגנון היחיד שמייקר הפניית זבל. לכן הוא
 * יושב בדיוק בשני המקומות שבהם רואים הפניה שהסתיימה: כרטיס הליד של
 * המפנה, והלוח של הקולט.
 *
 * שני הצדדים מדרגים, אבל רק דירוג הקולט נספר למוניטין המפנה —
 * אחרת משרד היה מדרג את ההפניות של עצמו חמישה כוכבים.
 */
export interface ReferralRatingValue {
  score: number;
  comment?: string;
}

const STARS = Array.from(
  { length: MAX_REFERRAL_RATING - MIN_REFERRAL_RATING + 1 },
  (_, index) => MIN_REFERRAL_RATING + index,
);

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
  const [score, setScore] = useState<number>(mine?.score ?? 0);
  const [comment, setComment] = useState<string>(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(mine !== undefined);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `referralComment_${sharedLeadId}`;

  /**
   * ניווט בחצים בתוך קבוצת הכוכבים.
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
    const current = score === 0 ? MIN_REFERRAL_RATING : score;
    const next = Math.min(
      MAX_REFERRAL_RATING,
      Math.max(MIN_REFERRAL_RATING, current + step),
    );
    setScore(next);
    // הבחירה והמיקוד נעים יחד — אחרת קורא המסך מכריז על כוכב אחר
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-star="${next}"]`)
      ?.focus();
  }

  async function submit(): Promise<void> {
    if (score === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/collaboration/leads/${sharedLeadId}/rating/${role}`, {
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setSaved(true);
      onSaved?.({
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
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
      <p className="m-0 mb-2 text-[13px] font-semibold">
        {role === "received" ? "איך הייתה ההפניה?" : "איך היה הלקוח שהפניתם?"}
      </p>

      {/*
        קבוצת רדיו ולא ערימת כפתורים: קורא מסך צריך לשמוע "3 מתוך 5",
        ומקלדת עוברת על החמישה בחצים — לא ב-Tab חמש פעמים. לכן
        tabindex נודד: רק הכוכב הנבחר (או הראשון, כשעוד לא נבחר)
        נמצא בסדר ה-Tab, והחצים מזיזים את הבחירה בתוך הקבוצה.
      */}
      <div
        role="radiogroup"
        aria-label={
          role === "received" ? "דירוג ההפניה שקלטתם" : "דירוג הלקוח שהפניתם"
        }
        className="flex flex-wrap items-center gap-1"
        onKeyDown={moveWithArrows}
      >
        {STARS.map((value) => {
          const active = value <= score;
          const focusable = score === 0 ? value === STARS[0] : value === score;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={score === value}
              aria-label={`${value} — ${REFERRAL_RATING_LABELS[value]}`}
              title={REFERRAL_RATING_LABELS[value]}
              disabled={busy}
              tabIndex={focusable ? 0 : -1}
              data-star={value}
              onClick={() => setScore(value)}
              /*
               * כוכב ריק נשאר קו מתאר; המסומנים מתמלאים. המילוי דרך
               * CSS ולא דרך prop לאייקון — `fill` בקובץ האייקונים הוא
               * תכונת תצוגה, וכלל CSS גובר עליה בלי לפצל את הרכיב.
               */
              className={`mv-btn-plain px-1 py-0.5${active ? " [&>svg]:fill-current" : ""}`}
              style={{
                color: active
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
              }}
            >
              <IconStar s={18} />
            </button>
          );
        })}
        {score > 0 ? (
          <span
            className="ms-1 text-[12.5px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {REFERRAL_RATING_LABELS[score]}
          </span>
        ) : null}
      </div>

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
          disabled={busy || score === 0}
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
        <p
          className="mt-2 mb-0 text-[12.5px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <b>{role === "received" ? "המשרד המפנה" : "המשרד הקולט"} דירג:</b>{" "}
          {counterpart.score}/{MAX_REFERRAL_RATING}
          {counterpart.comment ? ` — „${counterpart.comment}”` : ""}
        </p>
      ) : null}
    </div>
  );
}
