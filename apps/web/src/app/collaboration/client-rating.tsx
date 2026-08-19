"use client";

import { useState, type KeyboardEvent } from "react";
import {
  CLIENT_RATING_DIMENSIONS,
  MAX_REFERRAL_RATING,
  MAX_REFERRAL_RATING_COMMENT,
  MIN_REFERRAL_RATING,
  REFERRAL_RATING_LABELS,
  overallRatingScore,
  ratingDimension,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiPost } from "@/lib/api";
import { DictateFor } from "../dictation-field";
import { IconStar } from "../icons";
import { Notice } from "../notice";

/**
 * איכות הלקוח בהפניה — **הצהרה בפרסום, אישור בקליטה.**
 *
 * ## למה הצהרה ולא דירוג בדיעבד
 *
 * התמורה על ההפניה משולמת ברגע הקליטה ולא על עסקה שנסגרה, ואין
 * החזרים. מי שעומד לשלם צריך לדעת **מה הוא קונה לפני שהוא משלם**,
 * ומוניטין ממוצע של המשרד המפנה אינו אומר דבר על ההפניה שלפניו.
 *
 * לכן המפנה מדרג את איכות הלקוח ברגע הפרסום, וההצהרה היא חלק
 * מהמודעה. הקולט מאשר אחר כך את **אותם ממדים** מניסיון ישיר,
 * והמוניטין נבנה מהפער — כלומר מודד דיוק ולא מזל.
 *
 * ## למה אותו רכיב לשני הצדדים
 *
 * שני הטפסים חייבים להיות אותם ממדים ואותה סקאלה, אחרת ההשוואה
 * ביניהם חסרת משמעות. הבדל בנוסח השאלה בלבד (`declareHint` מול
 * `confirmHint`) — לא בקטלוג.
 */

const STARS = Array.from(
  { length: MAX_REFERRAL_RATING - MIN_REFERRAL_RATING + 1 },
  (_, index) => MIN_REFERRAL_RATING + index,
);

/**
 * שורת כוכבים אחת — ממד אחד.
 *
 * קבוצת רדיו ולא ערימת כפתורים: קורא מסך צריך לשמוע "3 מתוך 5",
 * ומקלדת עוברת על החמישה בחצים — לא ב-Tab חמש פעמים. לכן tabindex
 * נודד: רק הכוכב הנבחר (או הראשון, כשעוד לא נבחר) בסדר ה-Tab.
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
      <span className="text-[14px]">
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

/**
 * שדה הציונים עצמו — משמש את שני הטפסים.
 *
 * `mode` משנה את **נוסח השאלה בלבד**: המפנה נשאל מה הוא יודע על
 * הלקוח, והקולט נשאל מה התברר בפועל. הממדים והסקאלה זהים, וזה
 * מה שהופך את ההשוואה ביניהם לאפשרית.
 */
export function ClientScoresField({
  mode,
  scores,
  disabled = false,
  onChange,
}: {
  mode: "declare" | "confirm";
  scores: Record<string, number>;
  disabled?: boolean;
  onChange: (next: Record<string, number>) => void;
}) {
  return (
    <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
      {CLIENT_RATING_DIMENSIONS.map((dimension) => (
        <StarRow
          key={dimension.key}
          label={dimension.label}
          hint={mode === "declare" ? dimension.declareHint : dimension.confirmHint}
          value={scores[dimension.key] ?? 0}
          disabled={disabled}
          onChange={(next) => onChange({ ...scores, [dimension.key]: next })}
        />
      ))}
    </div>
  );
}

/**
 * הצגת ציונים שכבר ניתנו — בלוח, לפני התשלום.
 *
 * ממד-ממד ולא ציון בודד: "3.5" אינו אומר אם הלקוח לא רציני או
 * שהתקציב שלו לא ריאלי, ואלה שתי החלטות שונות לגמרי עבור מי
 * ששוקל לשלם.
 */
export function ClientScoresView({
  title,
  scores,
  comment,
}: {
  title: string;
  scores: Record<string, number>;
  comment?: string;
}) {
  const given = CLIENT_RATING_DIMENSIONS.filter(
    (dimension) => typeof scores[dimension.key] === "number",
  );
  if (given.length === 0) return null;
  const overall = overallRatingScore(scores);
  return (
    <div className="text-[14px]">
      <b>{title}</b>
      {overall === null ? null : (
        <span style={{ color: "var(--color-text-muted)" }}>
          {" "}
          — {overall}/{MAX_REFERRAL_RATING}
        </span>
      )}
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0">
        {given.map((dimension) => (
          <li key={dimension.key} style={{ color: "var(--color-text-muted)" }}>
            {dimension.label}: <b>{scores[dimension.key]}</b>/{MAX_REFERRAL_RATING}
          </li>
        ))}
      </ul>
      {comment ? <p className="m-0 mt-1">„{comment}”</p> : null}
    </div>
  );
}

/**
 * דיוק ההצהרות של המשרד המפנה, **מפורק לממדים.**
 *
 * ## למה לא מספיק הממוצע שליד השם
 *
 * ממוצע 3.5 יכול להיות משרד שמעריך גס בכל הממדים, ויכול להיות משרד
 * שמדייק לחלוטין ברצינות ובזמינות ומנפח בשיטתיות את התקציב. למי
 * שעומד לשלם עמלת הפניה — והתמורה נגבית גם אם לא ייסגר דבר — זו
 * אינה אותה עסקה: על הראשון אפשר לתקן בראש, ועל השני אי אפשר
 * לסמוך דווקא בשדה שקובע אם הליד שווה את המחיר.
 *
 * ## למה כל ממד נושא מונה משלו
 *
 * אישור מדרג רק את מה שהמאשר יודע לשפוט. משרד יכול לצבור עשרים
 * אישורים על רצינות ושלושה על דחיפות, ו„4.8” שנשען על שלושה אינו
 * אותו נתון כמו „4.8” שנשען על עשרים.
 *
 * הרכיב אינו מציג דבר כשאין פירוט — לא „טרם נמדד” ולא מקום ריק.
 * הממוצע הכללי כבר מוצג ליד השם, וזה הנתון שקיים.
 */
export function ReferrerAccuracyBreakdown({
  dimensions,
}: {
  dimensions: { key: string; average: number; count: number }[];
}) {
  if (dimensions.length === 0) return null;
  return (
    <ul
      className="m-0 mt-1 mb-2 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-[14px]"
      style={{ color: "var(--color-text-muted)" }}
      aria-label="דיוק ההצהרות לפי ממד"
    >
      {dimensions.map((entry) => {
        const label = ratingDimension(entry.key)?.label ?? entry.key;
        return (
          <li
            key={entry.key}
            title={`${label}: דיוק ${entry.average} מתוך ${MAX_REFERRAL_RATING}, לפי ${entry.count} אישורים`}
          >
            {label} <b>{entry.average}</b>
            {/*
              מספר האישורים בסוגריים ולא רק ב-title: הוא ההבדל בין
              ציון מבוסס לציון מקרי, ומי שגולל ברשימה בטלפון לא
              יגלה אותו בריחוף.
            */}
            <span> ({entry.count})</span>
          </li>
        );
      })}
    </ul>
  );
}

/** מה שנשמר כאישור, כפי שהשרת מחזיר אותו. */
export interface ReferralConfirmationValue {
  /** דיוק ההצהרה בכוכבים; `null` כשההפניה פורסמה בלי הצהרה. */
  accuracy: number | null;
  scores: Record<string, number>;
  comment?: string;
}

/**
 * טופס האישור של המשרד הקולט.
 *
 * שני הצדדים רואים אותו: הקולט כדי למלא, והמפנה כדי לראות מה
 * נקבע עליו. למפנה אין כאן כפתור — האישור אינו משא ומתן.
 */
export function ReferralConfirmation({
  sharedLeadId,
  role,
  declared,
  confirmation,
  onSaved,
}: {
  sharedLeadId: string;
  /** "referrer" = ההפניה שלי, "receiver" = קלטתי אותה */
  role: "referrer" | "receiver";
  /** מה שהמפנה הצהיר בפרסום — מוצג לצד האישור, ממד מול ממד. */
  declared: Record<string, number>;
  confirmation?: ReferralConfirmationValue;
  onSaved?: (value: ReferralConfirmationValue) => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>(
    () => confirmation?.scores ?? {},
  );
  const [comment, setComment] = useState<string>(confirmation?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(confirmation !== undefined);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `referralComment_${sharedLeadId}`;
  const filled = Object.keys(scores).length > 0;

  async function submit(): Promise<void> {
    if (!filled) return;
    setBusy(true);
    setError(null);
    const trimmed = comment.trim();
    try {
      const saved = await apiPost<{ ok: true }>(
        `/collaboration/leads/${sharedLeadId}/confirmation`,
        { scores, ...(trimmed ? { comment: trimmed } : {}) },
      );
      void saved;
      setSaved(true);
      /*
       * ציון הדיוק נגזר בשרת ואינו מוחזר מהנתיב הזה. עד לרענון
       * הבא מוצג `null`, שהמסך יודע להציג כ"טרם חושב" — ולא ניחוש
       * מקומי שעלול לסתור את מה שנשמר.
       */
      onSaved?.({
        accuracy: null,
        scores,
        ...(trimmed ? { comment: trimmed } : {}),
      });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת האישור נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const declarationTitle = "מה שהוצהר בפרסום";

  if (role === "referrer") {
    return (
      <div
        className="mt-3 rounded-lg border p-3"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg)",
        }}
      >
        <ClientScoresView title={declarationTitle} scores={declared} />
        {confirmation ? (
          <div className="mt-2">
            <ClientScoresView
              title="מה שהמשרד הקולט מצא"
              scores={confirmation.scores}
              comment={confirmation.comment}
            />
            <p
              className="m-0 mt-1 text-[14px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {confirmation.accuracy === null
                ? "דיוק ההצהרה יחושב עם רענון הלוח."
                : `דיוק ההצהרה: ${confirmation.accuracy}/${MAX_REFERRAL_RATING} — זה מה שנכנס למוניטין שלכם.`}
            </p>
          </div>
        ) : (
          <p
            className="m-0 mt-2 text-[14px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            המשרד הקולט טרם אישר. כשיאשר, הפער בין ההצהרה לאישור ייכנס למוניטין
            שלכם — ולכן הצהרה מדויקת שווה יותר מהצהרה גבוהה.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      <p className="m-0 mb-1 text-[14.5px] font-semibold">
        מה התברר בפועל?
      </p>
      <p
        className="m-0 mb-2 text-[14px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        האישור שלכם נמדד מול מה שהמשרד המפנה הצהיר, והפער הוא המוניטין שלו.
        ממד שאינכם יודעים לשפוט — השאירו ריק.
      </p>

      <div className="mb-2">
        <ClientScoresView title={declarationTitle} scores={declared} />
      </div>

      <ClientScoresField
        mode="confirm"
        scores={scores}
        disabled={busy}
        onChange={setScores}
      />

      <GapHint declared={declared} confirmed={scores} />

      <label
        htmlFor={fieldId}
        className="mt-2 flex flex-col gap-1 text-[14px]"
      >
        <span style={{ color: "var(--color-text-muted)" }}>
          הערה למשרד המפנה (רשות) — נראית רק לשני המשרדים שבהפניה
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
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy || !filled}
          onClick={() => void submit()}
        >
          {busy ? "שומר…" : saved ? "עדכון האישור" : "שליחת האישור"}
        </Button>
        {saved && !busy ? (
          <span
            className="text-[14px]"
            style={{ color: "var(--color-success)" }}
          >
            ✓ האישור נשמר
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * הפערים שנפתחו מול ההצהרה, בזמן המילוי.
 *
 * לא ציון ולא שיפוט — רק הצבעה על ממד שבו האישור רחוק מההצהרה,
 * כדי שהמאשר יראה במו עיניו מה הוא אומר לפני שהוא שולח. בלי זה
 * "3 מול 5" הוא מספר שנשלח בלי לשים לב, והמוניטין של משרד אחר
 * נקבע לפיו.
 */
function GapHint({
  declared,
  confirmed,
}: {
  declared: Record<string, number>;
  confirmed: Record<string, number>;
}) {
  const gaps = Object.entries(confirmed)
    .map(([key, value]) => {
      const before = declared[key];
      if (typeof before !== "number") return null;
      const gap = value - before;
      if (gap === 0) return null;
      return { key, before, value, gap };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (gaps.length === 0) return null;
  return (
    <p
      className="m-0 mt-2 text-[14px]"
      style={{ color: "var(--color-text-muted)" }}
    >
      פערים מול ההצהרה:{" "}
      {gaps
        .map(
          (entry) =>
            `${ratingDimension(entry.key)?.label ?? entry.key} ${entry.before}→${entry.value}`,
        )
        .join(" · ")}
    </p>
  );
}
