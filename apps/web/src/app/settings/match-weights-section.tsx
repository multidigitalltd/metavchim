"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  HARD_MATCH_CRITERIA,
  MATCH_CRITERION_LABELS,
  MIN_HARD_WEIGHT,
  type MatchCriterion,
  type MatchWeights,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { IconInfo } from "../icons";

/**
 * משקלי ההתאמה של המשרד.
 *
 * מנוע ההתאמות שוקלל לפי מה שנכון "בממוצע", אבל משרד בבני ברק שבו
 * הלקוחות לא יזוזו משכונה, ומשרד בתל אביב שבו התקציב מכריע והמיקום
 * גמיש, אינם צריכים את אותו שקלול. כאן כל משרד קובע לעצמו.
 *
 * **חל בתוך המשרד בלבד** — ראו ההסבר בכיתוב על הרשת.
 */

const CRITERIA = Object.keys(MATCH_CRITERION_LABELS) as MatchCriterion[];

/** המשקלים נשמרים כשברים; המסך עובד באחוזים, כי כך חושבים עליהם. */
const toPercent = (value: number): number => Math.round(value * 100);
const fromPercent = (value: number): number => value / 100;

export function MatchWeightsSection() {
  const [weights, setWeights] = useState<MatchWeights | null>(null);
  const [defaults, setDefaults] = useState<MatchWeights | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ weights: MatchWeights; defaults: MatchWeights }>("/settings/match-weights")
      .then((res) => {
        setWeights(res.weights);
        setDefaults(res.defaults);
      })
      .catch(() => setError("טעינת ההגדרות נכשלה"));
  }, []);

  function setOne(criterion: MatchCriterion, percent: number): void {
    setSaved(false);
    setWeights((prev) => (prev ? { ...prev, [criterion]: fromPercent(percent) } : prev));
  }

  async function save(): Promise<void> {
    if (!weights) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPatch<{ weights: MatchWeights }>("/settings/match-weights", weights);
      setWeights(res.weights);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (weights === null || defaults === null) {
    return (
      <section className="mb-6 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p aria-live="polite">טוען…</p>
      </section>
    );
  }

  /*
   * הסכום מוצג אבל **אינו נאכף ל-100**: הציון מנרמל לפי המשקלים
   * שנבחנו בפועל, ולכן היחס ביניהם הוא מה שקובע. אכיפה ל-100 הייתה
   * מכריחה את המשתמש לפתור חשבון בכל שינוי, בלי שום תועלת.
   */
  const total = CRITERIA.reduce((sum, key) => sum + toPercent(weights[key]), 0);
  const isDefault = CRITERIA.every((key) => weights[key] === defaults[key]);

  return (
    <section
      id="match-weights"
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="match-weights-heading"
    >
      <h3 id="match-weights-heading" className="mb-1 font-semibold">
        מה חשוב בהתאמות
      </h3>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כמה כל קריטריון שוקל בציון ההתאמה בין נכס לקונה. מה שחשוב לכם — העלו;
        מה שפחות — הורידו, ואת מי שלא רלוונטי אפשר לאפס לגמרי.
      </p>

      {/*
        האזהרה הזו אינה נימוס: משרד שיחשוב שהוא משנה גם את מה שהרשת
        רואה עלול לנפח משקלים כדי "להיראות טוב יותר" — וייווכח שלא
        קרה כלום. עדיף שיידע מראש.
      */}
      <p
        className="m-0 mb-4 rounded-lg border p-2.5 text-[12.5px]"
        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      >
        <IconInfo s={14} /> ההגדרות כאן חלות <b>רק בתוך המשרד שלכם</b>. התאמות בשוק
        שיתופי הפעולה ממשיכות לרוץ בשקלול האחיד של הרשת — כדי ש„85% התאמה" יגיד
        לכל המשרדים את אותו דבר.
      </p>

      <ul className="m-0 mb-4 flex list-none flex-col gap-3 p-0">
        {CRITERIA.map((criterion) => {
          const percent = toPercent(weights[criterion]);
          // קריטריון פוסל אינו יורד לאפס — ראו ההסבר מתחת לרשימה
          const isHard = HARD_MATCH_CRITERIA.includes(criterion);
          const minPercent = isHard ? toPercent(MIN_HARD_WEIGHT) : 0;
          return (
            <li key={criterion}>
              <label htmlFor={`w-${criterion}`} className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {MATCH_CRITERION_LABELS[criterion]}
                  {isHard ? (
                    <span className="ms-1.5 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                      (פוסל)
                    </span>
                  ) : null}
                </span>
                <span
                  className="font-bold"
                  style={{
                    color: percent === 0 ? "var(--color-text-muted)" : "var(--color-primary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {percent === 0 ? "מבוטל" : `${percent}%`}
                </span>
              </label>
              <input
                id={`w-${criterion}`}
                type="range"
                min={minPercent}
                max={50}
                step={5}
                value={percent}
                onChange={(event) => setOne(criterion, Number(event.target.value))}
                className="w-full"
                style={{ accentColor: "var(--color-primary)" }}
              />
            </li>
          );
        })}
      </ul>

      <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        סך המשקלים: {total}%. אין צורך להגיע ל-100 — הציון נקבע לפי היחס ביניהם,
        וקריטריון שאין עליו מידע בנכס פשוט מדולג.
      </p>
      {/*
        למה שלושה קריטריונים לא יורדים לאפס: הם לא רק משוקללים אלא
        פוסלים. משקל אפס עליהם היה מציג "מבוטל" בעוד שהם ממשיכים
        למחוק מועמדים מהרשימה — כלומר שקר במסך.
      */}
      <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        שלושת המסומנים כ„פוסל" אינם יורדים לאפס: הם לא רק משפיעים על הציון אלא
        מוציאים התאמה מהרשימה — מיקום מחוץ למה שהקונה ביקש, מחיר מעל התקציב, או דרישת
        חובה שהנכס מפר. כדי להתעלם מהמיקום, הסירו מהקונה גם את הערים וגם את אזורי
        החיפוש על המפה.
      </p>

      {error ? (
        <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="m-0 mb-2 text-sm" style={{ color: "var(--color-primary)" }}>
          ✓ נשמר. ההתאמות יחושבו מחדש בשינוי הבא של נכס או קונה.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "שומר…" : "שמור"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || isDefault}
          onClick={() => {
            setWeights({ ...defaults });
            setSaved(false);
          }}
        >
          חזרה לברירת המחדל
        </Button>
      </div>
    </section>
  );
}
