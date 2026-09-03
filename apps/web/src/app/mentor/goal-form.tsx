"use client";

import { useState, type FormEvent } from "react";
import {
  GOAL_HORIZON_LABELS,
  GOAL_UNIT_LABELS,
  GOAL_UNIT_NOTES,
  LEAD_MEASURE_LABELS,
  LEAD_MEASURES,
  type GoalHorizon,
  type GoalUnit,
  type WeeklyCommitment,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiPut } from "@/lib/api";
import { Notice } from "../notice";

/**
 * ‎**קביעת יעד — הטופס היחיד שהמנטור מבקש למלא.**
 *
 * ‏כל שאר המספרים במסך נספרים מהמערכת. זה המקום היחיד שבו מתווך
 * מזין משהו, ולכן הוא קצר בכוונה: יעד, ובשבוע — כמה פעולות.
 *
 * ## שתי ההכרעות שבנויות לתוך הטופס
 *
 * ‎**העמלה הממוצעת אינה שדה רשות בפועל.** בלעדיה אין חישוב לאחור
 * ליעד בעמלות — אי אפשר לתרגם „חצי מיליון” לעסקאות בלי לדעת כמה
 * שווה עסקה. הטופס אומר זאת במקום להציג „0 שיחות ביום” על חישוב
 * שלא רץ.
 *
 * ‎**המכשול ותוכנית „אם-אז” נשאלים כאן, לא אחרי הכישלון.** ניסוח
 * מראש של „כשזה קורה, אני עושה” הוא ההבדל בין כוונה לביצוע —
 * ושאלה כזו אחרי שבוע חלש נשמעת כמו חקירה.
 */

/**
 * ‏התווית במסך. השם הבסיסי מגיע מהחבילה המשותפת, וכאן נוספת רק
 * יחידת המידה שרלוונטית לטופס („₪”).
 */
const UNIT_LABELS: Record<GoalUnit, string> = {
  commission: `${GOAL_UNIT_LABELS.commission} (₪)`,
  deals: GOAL_UNIT_LABELS.deals,
  exclusives: GOAL_UNIT_LABELS.exclusives,
  leads: GOAL_UNIT_LABELS.leads,
  calls: GOAL_UNIT_LABELS.calls,
};

/**
 * ‎**שתי המשפחות, ולמה הן מופרדות בתפריט.**
 *
 * ‏„במה נמדד” הציג חמש אפשרויות ברצף, ומי שקרא אותן לא ידע שהן שני
 * דברים שונים: „עסקאות” הוא מה שהוא רוצה שיקרה, ו„שיחות” הוא מה
 * שהוא עושה כדי שזה יקרה. ההפרדה אינה קישוט — היא ההסבר.
 *
 * ‏ההסבר עצמו **אינו** לפי משפחה אלא לפי יחידה (`GOAL_UNIT_NOTES`
 * בחבילה המשותפת). משפט למשפחה הבטיח חישוב לאחור „עד כמה שיחות
 * ביום” גם ל„בלעדיות”, שעבורן הכרטיס הזה לעולם אינו מוצג — הבטחה
 * לפלט שלא מגיע. בדיקה משותפת מריצה את `backwardPlan` על כל יחידה
 * ומוודאת שהמשפט תואם למה שהיא באמת מחזירה.
 */
const UNIT_GROUPS: { legend: string; units: GoalUnit[] }[] = [
  { legend: "תוצאה — מה שאני רוצה שיקרה", units: ["commission", "deals", "exclusives"] },
  { legend: "פעילות — מה שאני עושה", units: ["leads", "calls"] },
];

/** ‏שקלים במסך, אגורות בשרת — המרה במקום אחד. */
const toAgorot = (shekels: number): number => Math.round(shekels * 100);

export function GoalForm({
  horizon,
  initial,
  onSaved,
  onCancel,
}: {
  horizon: GoalHorizon;
  initial?: {
    unit: GoalUnit;
    target: number;
    averageCommissionAgorot?: number;
    commitment: WeeklyCommitment;
    obstacle?: string;
    ifThenPlan?: string;
  };
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [unit, setUnit] = useState<GoalUnit>(initial?.unit ?? "commission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWeek = horizon === "week";
  const startValue =
    initial === undefined
      ? ""
      : initial.unit === "commission"
        ? String(Math.round(initial.target / 100))
        : String(initial.target);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const raw = Number(String(form.get("target") ?? "").replace(/[^\d.]/gu, ""));
    if (!Number.isFinite(raw) || raw <= 0) {
      setError("צריך יעד גדול מאפס");
      return;
    }
    const average = Number(String(form.get("average") ?? "").replace(/[^\d.]/gu, ""));
    if (unit === "commission" && (!Number.isFinite(average) || average <= 0)) {
      /*
       * ‏בלי העמלה הממוצעת אין מה לחשב, והשרת היה מקבל את היעד
       * ומחזיר תוכנית ריקה. עדיף לומר זאת כאן.
       */
      setError("בשביל לחשב אחורה צריך גם עמלה ממוצעת לעסקה");
      return;
    }

    const commitment: WeeklyCommitment = {};
    if (isWeek) {
      for (const measure of LEAD_MEASURES) {
        const n = Number(String(form.get(measure) ?? "").replace(/[^\d]/gu, ""));
        if (Number.isFinite(n) && n > 0) commitment[measure] = Math.floor(n);
      }
    }

    setBusy(true);
    try {
      await apiPut(`/mentor/goals/${horizon}`, {
        unit,
        target: unit === "commission" ? toAgorot(raw) : Math.floor(raw),
        ...(unit === "commission" ? { averageCommissionAgorot: toAgorot(average) } : {}),
        ...(isWeek ? { commitment } : {}),
        ...(String(form.get("obstacle") ?? "").trim() === ""
          ? {}
          : { obstacle: String(form.get("obstacle")).trim() }),
        ...(String(form.get("ifThen") ?? "").trim() === ""
          ? {}
          : { ifThenPlan: String(form.get("ifThen")).trim() }),
      });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת היעד נכשלה");
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border px-3 py-2.5 text-sm";
  const style = {
    background: "var(--color-field)",
    borderColor: "var(--color-input-border)",
    color: "var(--color-text)",
  };

  return (
    <form onSubmit={submit} className="mt-3">
      {error === null ? null : (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`unit-${horizon}`} className="mb-1 block text-sm font-bold">
            במה נמדד
          </label>
          <select
            id={`unit-${horizon}`}
            value={unit}
            onChange={(event) => setUnit(event.target.value as GoalUnit)}
            className={field}
            style={style}
          >
            {UNIT_GROUPS.map((group) => (
              <optgroup key={group.legend} label={group.legend}>
                {group.units.map((value) => (
                  <option key={value} value={value}>
                    {UNIT_LABELS[value]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p
            className="m-0 mt-1 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {GOAL_UNIT_NOTES[unit]}
          </p>
        </div>
        <div>
          <label htmlFor={`target-${horizon}`} className="mb-1 block text-sm font-bold">
            {/*
              ‎„היעד ל” + „השנה” נותן „היעד להשנה”. התוויות נושאות
              יידוע כי הן משמשות ככותרת בפני עצמה במסך, ולכן כאן
              הן באות אחרי נקודתיים ולא אחרי מילת יחס.
            */}
            היעד — {GOAL_HORIZON_LABELS[horizon]}
          </label>
          <input
            id={`target-${horizon}`}
            name="target"
            inputMode="numeric"
            defaultValue={startValue}
            placeholder={
              unit === "commission" ? "500,000" : unit === "calls" ? "1,000" : "12"
            }
            className={field}
            style={style}
          />
        </div>
      </div>

      {unit === "commission" ? (
        <div className="mt-3">
          <label htmlFor={`avg-${horizon}`} className="mb-1 block text-sm font-bold">
            עמלה ממוצעת לעסקה (₪)
          </label>
          <input
            id={`avg-${horizon}`}
            name="average"
            inputMode="numeric"
            defaultValue={
              initial?.averageCommissionAgorot === undefined
                ? ""
                : String(Math.round(initial.averageCommissionAgorot / 100))
            }
            placeholder="35,000"
            className={field}
            style={style}
          />
          <p
            className="m-0 mt-1 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            זה מה שהופך „חצי מיליון” למספר עסקאות, ומשם לשיחות ביום.
          </p>
        </div>
      ) : null}

      {isWeek ? (
        <fieldset className="mt-4 rounded-xl border p-3" style={{ borderColor: "var(--color-input-border)" }}>
          <legend className="px-1 text-sm font-bold">מה אני לוקח על עצמי השבוע</legend>
          <p
            className="m-0 mb-2 text-[length:var(--type-caption)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            את הביצוע אני סופר לבד — שיחות, פגישות, הצעות ונכסים. אתה רק
            אומר כמה.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEAD_MEASURES.map((measure) => (
              <div key={measure}>
                <label
                  htmlFor={`m-${measure}`}
                  className="mb-1 block text-[length:var(--type-caption-lg)] font-bold"
                >
                  {LEAD_MEASURE_LABELS[measure]}
                </label>
                <input
                  id={`m-${measure}`}
                  name={measure}
                  inputMode="numeric"
                  defaultValue={initial?.commitment[measure] ?? ""}
                  placeholder="0"
                  className={field}
                  style={style}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`obs-${horizon}`} className="mb-1 block text-sm font-bold">
            מה בדרך כלל עוצר אותך?
          </label>
          <input
            id={`obs-${horizon}`}
            name="obstacle"
            maxLength={400}
            defaultValue={initial?.obstacle ?? ""}
            placeholder="למשל: היום נגמר בסידורים ולא הספקתי להתקשר"
            className={field}
            style={style}
          />
        </div>
        <div>
          <label htmlFor={`ifthen-${horizon}`} className="mb-1 block text-sm font-bold">
            ומה תעשה כשזה קורה?
          </label>
          <input
            id={`ifthen-${horizon}`}
            name="ifThen"
            maxLength={400}
            defaultValue={initial?.ifThenPlan ?? ""}
            placeholder="למשל: אם עברה 11:00 בלי שיחות — עוצר הכול ומתקשר לחמישה"
            className={field}
            style={style}
          />
        </div>
      </div>
      <p
        className="m-0 mt-1 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        משפט „אם-אז” שנוסח מראש הוא ההבדל בין כוונה לביצוע. אני אזכיר לך
        אותו בדיוק כשזה יקרה.
      </p>

      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "שומר…" : "שמירת היעד"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
