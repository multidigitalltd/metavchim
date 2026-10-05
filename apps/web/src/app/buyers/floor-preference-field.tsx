"use client";

import { useState } from "react";
import {
  FLOOR_CHOICES,
  FLOOR_MAX,
  FLOOR_MIN,
  FloorPreferenceSchema,
  floorLabel,
  type FloorPreference,
} from "@metavchim/shared";

/**
 * ‎**„באיזו קומה?” — השאלה שכל מתווך שואל, ולא היה לה שדה.**
 *
 * ## שני מצבים, כי אלה שתי דרישות
 *
 * ‎**„משלוש ומעלה”** היא טווח פתוח: רשימה סגורה לא יכולה לבטא אותה
 * בלי למנות עשרות קומות, ומי שימנה יטעה בקצה.
 *
 * ‎**„קרקע או ראשונה”** היא רשימה: טווח לא יכול לבטא אותה בלי לכלול
 * את מה שביניהן — וכאן אין „ביניהן”. אלה שתי קומות שנבחרו בנפרד,
 * מסיבות שונות (גינה מול מדרגות).
 *
 * המתג אינו העדפת תצוגה: הוא בוחר **איזו** דרישה נשמרת, ושתיהן לא
 * יכולות להתקיים יחד. הצורה בסכמה זהה, ולכן אין „מה גובר”.
 *
 * ## למה שדה מוסתר ולא state שמורם למעלה
 *
 * שני הטפסים (יצירה ועריכה) נשלחים כ-`FormData`, ושאר השדות
 * המורכבים — סוגי נכס, אזורי חיפוש, מאפיינים — כבר עובדים כך.
 * ‎`readFloorPreference` היא הצד השני של אותו חוזה, והיא מאמתת מול
 * ‎**הסכמה של השרת** ולא מול כללים משלה.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

type Mode = "none" | "range" | "list";

function initialMode(initial: FloorPreference | undefined): Mode {
  if (initial === undefined) return "none";
  return initial.mode;
}

export function FloorPreferenceField({
  initial,
  disabled = false,
}: {
  initial?: FloorPreference;
  disabled?: boolean;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode(initial));
  const [min, setMin] = useState<string>(
    initial?.mode === "range" && initial.min !== undefined ? String(initial.min) : "",
  );
  const [max, setMax] = useState<string>(
    initial?.mode === "range" && initial.max !== undefined ? String(initial.max) : "",
  );
  const [floors, setFloors] = useState<number[]>(
    initial?.mode === "list" ? [...initial.floors] : [],
  );

  /*
   * ‎**הערך נבנה כאן ולא בשליחה.** מה שנשלח הוא בדיוק מה שהמסך
   * מציג — כולל „לא נאמר”, שהוא מחרוזת ריקה ולא אובייקט חלקי.
   */
  const value = ((): string => {
    if (mode === "none") return "";
    if (mode === "list") {
      return floors.length === 0 ? "" : JSON.stringify({ mode: "list", floors });
    }
    const asNumber = (raw: string): number | undefined => {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const lo = asNumber(min);
    const hi = asNumber(max);
    /* טווח פתוח משני הצדדים הוא „לא נאמר”, ואין טעם לשמור אותו */
    if (lo === undefined && hi === undefined) return "";
    return JSON.stringify({
      mode: "range",
      ...(lo === undefined ? {} : { min: lo }),
      ...(hi === undefined ? {} : { max: hi }),
    });
  })();

  function toggleFloor(floor: number): void {
    setFloors((prev) =>
      prev.includes(floor) ? prev.filter((f) => f !== floor) : [...prev, floor],
    );
  }

  /*
   * ‎**„עד” קטן מ„מ-” הוא טווח ריק** — אף נכס לא ייכנס אליו, ומי
   * שהזין אותו התכוון להפך. נאמר במסך ולא נשמר בשקט.
   */
  const reversed =
    mode === "range" &&
    min !== "" &&
    max !== "" &&
    Number.parseInt(min, 10) > Number.parseInt(max, 10);

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 block font-medium">קומה רצויה</legend>
      <input type="hidden" name="floorPreference" value={value} />

      <div className="mb-2 flex flex-wrap gap-2">
        {(
          [
            ["none", "לא משנה"],
            ["range", "טווח קומות"],
            ["list", "קומות מסוימות"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-pressed={mode === key}
            className={mode === key ? "mv-btn-action" : "mv-btn-plain"}
            style={
              mode === key
                ? { padding: "7px 15px", fontSize: "var(--type-caption-lg)" }
                : undefined
            }
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "range" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="floorMin" className="mb-1 block text-[length:var(--type-caption-lg)]">
              מקומה
            </label>
            <input
              id="floorMin"
              type="number"
              inputMode="numeric"
              min={FLOOR_MIN}
              max={FLOOR_MAX}
              step="1"
              value={min}
              disabled={disabled}
              placeholder="ללא הגבלה"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
              onChange={(event) => setMin(event.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="floorMax" className="mb-1 block text-[length:var(--type-caption-lg)]">
              עד קומה
            </label>
            <input
              id="floorMax"
              type="number"
              inputMode="numeric"
              min={FLOOR_MIN}
              max={FLOOR_MAX}
              step="1"
              value={max}
              disabled={disabled}
              placeholder="ללא הגבלה"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
              onChange={(event) => setMax(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      {mode === "list" ? (
        <div className="flex flex-wrap gap-1.5">
          {FLOOR_CHOICES.map((floor) => {
            const on = floors.includes(floor);
            return (
              <label
                key={floor}
                className="mv-chip cursor-pointer"
                style={
                  on
                    ? { background: "var(--domain-blue-bg)", color: "var(--domain-blue-fg)" }
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  className="mv-visually-hidden"
                  checked={on}
                  disabled={disabled}
                  onChange={() => toggleFloor(floor)}
                />
                {floorLabel(floor)}
              </label>
            );
          })}
        </div>
      ) : null}

      {mode === "range" ? (
        <p
          className="mt-1 text-[length:var(--type-caption)]"
          style={{ color: reversed ? "var(--color-danger)" : "var(--color-text-muted)" }}
        >
          {reversed
            ? "„עד” קטן מ„מקומה” — אף נכס לא ייכנס לטווח הזה."
            : "אפשר להשאיר צד אחד ריק — למשל „מקומה 3” בלי תקרה."}
        </p>
      ) : null}
      {mode === "list" ? (
        <p
          className="mt-1 text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          לקומות גבוהות מ-20 השתמשו ב„טווח קומות”.
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * הצד השני של החוזה — קריאה מ-`FormData`.
 *
 * ‎**מאומת מול הסכמה של השרת** ולא מול כללים מקומיים: ערך פגום
 * (JSON שנשבר, קומה מחוץ לתחום) הופך ל-`undefined` = „לא נאמר”,
 * ולא לדרישה שקטה ושגויה.
 */
export function readFloorPreference(raw: FormDataEntryValue | null): FloorPreference | undefined {
  const text = String(raw ?? "").trim();
  if (text === "") return undefined;
  try {
    const parsed = FloorPreferenceSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
