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
import { formatDate } from "@/lib/format";
import { IconInfo } from "../icons";
import { MatchRefreshCard } from "./match-refresh-card";
import { Notice } from "../notice";

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

interface CalibrationEntry {
  criterion: MatchCriterion;
  from: number;
  to: number;
}

interface CalibrationInfo {
  at: string;
  adjusted: CalibrationEntry[];
}

/**
 * הכיול נכתב על-ידי השרת, אבל שדה JSON חופשי אינו חוזה: רשומה
 * מגרסה ישנה או ערך פגום לא צריכים להפיל את מסך ההגדרות — פשוט
 * לא מציגים אותה.
 */
function parseCalibration(raw: unknown): CalibrationInfo | null {
  if (raw === null || typeof raw !== "object") return null;
  const at = (raw as { at?: unknown }).at;
  const list = (raw as { adjusted?: unknown }).adjusted;
  if (typeof at !== "string" || !Array.isArray(list)) return null;
  const adjusted = list.filter((entry): entry is CalibrationEntry => {
    if (entry === null || typeof entry !== "object") return false;
    const e = entry as { criterion?: unknown; from?: unknown; to?: unknown };
    return (
      typeof e.criterion === "string" &&
      (CRITERIA as string[]).includes(e.criterion) &&
      typeof e.from === "number" &&
      typeof e.to === "number"
    );
  });
  if (adjusted.length === 0) return null;
  return { at, adjusted };
}

export function MatchWeightsSection() {
  const [weights, setWeights] = useState<MatchWeights | null>(null);
  const [defaults, setDefaults] = useState<MatchWeights | null>(null);
  const [autoTune, setAutoTune] = useState(true);
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * מונה שמאלץ את כרטיס הרענון לקרוא מחדש אחרי שמירה. השרת מפעיל
   * את הסבב ברקע, ובלי הדחיפה הזו הכרטיס היה ממשיך להציג את הסבב
   * הקודם עד שהמשתמש יטען את המסך מחדש — כלומר בדיוק אותה חוויה
   * שהשינוי הזה נועד לתקן.
   */
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiGet<{
      weights: MatchWeights;
      defaults: MatchWeights;
      autoTune?: boolean;
      calibration?: unknown;
    }>("/settings/match-weights")
      .then((res) => {
        setWeights(res.weights);
        setDefaults(res.defaults);
        setAutoTune(res.autoTune !== false);
        setCalibration(parseCalibration(res.calibration ?? null));
      })
      .catch(() => setError("טעינת ההגדרות נכשלה"));
  }, []);

  function setOne(criterion: MatchCriterion, percent: number): void {
    setSaved(false);
    setWeights((prev) =>
      prev ? { ...prev, [criterion]: fromPercent(percent) } : prev,
    );
  }

  async function save(): Promise<void> {
    if (!weights) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPatch<{ weights: MatchWeights }>(
        "/settings/match-weights",
        weights,
      );
      setWeights(res.weights);
      setSaved(true);
      setRefreshKey((n) => n + 1);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /*
   * אופטימי עם החזרה לאחור: המתג משקף מיד את הבחירה, ואם השרת נכשל
   * הוא חוזר למצבו — מתג שנשאר "דולק" אחרי כיבוי שנכשל היה משאיר
   * את הכיול רץ בלי שהמנהל יודע.
   */
  async function toggleAutoTune(enabled: boolean): Promise<void> {
    setAutoTune(enabled);
    setError(null);
    try {
      await apiPatch<{ autoTune: boolean }>("/settings/match-weights/auto-tune", {
        enabled,
      });
    } catch (err: unknown) {
      setAutoTune(!enabled);
      setError(
        err instanceof ApiError ? err.message : "עדכון הכיול האוטומטי נכשל",
      );
    }
  }

  if (weights === null || defaults === null) {
    return (
      <section
        className="mb-6 rounded-xl border p-4"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
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
    <>
      <section
        id="match-weights"
        className="mb-6 rounded-xl border p-4"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
        aria-labelledby="match-weights-heading"
      >
        <h3 id="match-weights-heading" className="mb-1 font-semibold">
          מה חשוב בהתאמות
        </h3>
        <p
          className="m-0 mb-3 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          כמה כל קריטריון שוקל בציון ההתאמה בין נכס לקונה. מה שחשוב לכם — העלו;
          מה שפחות — הורידו, ואת מי שלא רלוונטי אפשר לאפס לגמרי.
        </p>

        {/*
        האזהרה הזו אינה נימוס: משרד שיחשוב שהוא משנה גם את מה שהרשת
        רואה עלול לנפח משקלים כדי "להיראות טוב יותר" — וייווכח שלא
        קרה כלום. עדיף שיידע מראש.
      */}
        <p
          className="m-0 mb-4 rounded-lg border p-2.5 text-[14px]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <IconInfo s={14} /> ההגדרות כאן חלות <b>רק בתוך המשרד שלכם</b>. התאמות
          בשוק שיתופי הפעולה ממשיכות לרוץ בשקלול האחיד של הרשת — כדי ש„85%
          התאמה" יגיד לכל המשרדים את אותו דבר.
        </p>

        <ul className="m-0 mb-4 flex list-none flex-col gap-3 p-0">
          {CRITERIA.map((criterion) => {
            const percent = toPercent(weights[criterion]);
            // קריטריון פוסל אינו יורד לאפס — ראו ההסבר מתחת לרשימה
            const isHard = HARD_MATCH_CRITERIA.includes(criterion);
            const minPercent = isHard ? toPercent(MIN_HARD_WEIGHT) : 0;
            return (
              <li key={criterion}>
                <label
                  htmlFor={`w-${criterion}`}
                  className="mb-1 flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="font-medium">
                    {MATCH_CRITERION_LABELS[criterion]}
                    {isHard ? (
                      <span
                        className="ms-1.5 text-[14px]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        (פוסל)
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="font-bold"
                    style={{
                      color:
                        percent === 0
                          ? "var(--color-text-muted)"
                          : "var(--color-primary)",
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
                  onChange={(event) =>
                    setOne(criterion, Number(event.target.value))
                  }
                  className="w-full"
                  style={{ accentColor: "var(--color-primary)" }}
                />
              </li>
            );
          })}
        </ul>

        <p
          className="m-0 mb-3 text-[14px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          סך המשקלים: {total}%. אין צורך להגיע ל-100 — הציון נקבע לפי היחס
          ביניהם, וקריטריון שאין עליו מידע בנכס פשוט מדולג.
        </p>
        {/*
        למה שלושה קריטריונים לא יורדים לאפס: הם לא רק משוקללים אלא
        פוסלים. משקל אפס עליהם היה מציג "מבוטל" בעוד שהם ממשיכים
        למחוק מועמדים מהרשימה — כלומר שקר במסך.
      */}
        <p
          className="m-0 mb-3 text-[14px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          שלושת המסומנים כ„פוסל" אינם יורדים לאפס: הם לא רק משפיעים על הציון אלא
          מוציאים התאמה מהרשימה — מיקום מחוץ למה שהקונה ביקש, מחיר מעל התקציב,
          או דרישת חובה שהנכס מפר. כדי להתעלם מהמיקום, הסירו מהקונה גם את הערים
          וגם את אזורי החיפוש על המפה.
        </p>

        <div
          className="mb-4 rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={autoTune}
              onChange={(event) => void toggleAutoTune(event.target.checked)}
              className="mt-0.5"
              style={{ accentColor: "var(--color-primary)" }}
            />
            <span>
              <span className="font-medium">כיול אוטומטי לפי הדחיות</span>
              <span
                className="mt-0.5 block text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                כשמצטברות מספיק דחיות מסיבה אחת (למשל „המחיר לא מתאים"), המערכת
                מעלה מעט את משקל הקריטריון — בצעד קטן, לכל היותר פעם בשבוע, ותמיד
                עם התראה. גרירה ידנית תמיד גוברת.
              </span>
            </span>
          </label>
          {calibration !== null ? (
            <p
              className="m-0 mt-2 text-[14px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              כיול אחרון ({formatDate(calibration.at)}):{" "}
              {calibration.adjusted
                .map(
                  (change) =>
                    `${MATCH_CRITERION_LABELS[change.criterion]} ${toPercent(change.from)}% ← ${toPercent(change.to)}%`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}
        {saved ? (
          <Notice tone="success">✓ נשמר. כל ההתאמות במשרד מחושבות מחדש עכשיו — ראו את הכרטיס למטה.</Notice>
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
      <MatchRefreshCard reloadKey={refreshKey} />
    </>
  );
}
