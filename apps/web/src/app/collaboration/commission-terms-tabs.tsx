"use client";

import { useId, useState } from "react";
import {
  COMMISSION_SIDES,
  COMMISSION_SIDE_HINT,
  COMMISSION_SIDE_LABEL,
  COMMISSION_SPLIT_OPTIONS,
  OTHER_SPLIT_MAX_NOTE,
  describeCommissionSplit,
  type CommissionSide,
  type CommissionTerms,
} from "@metavchim/shared";

/**
 * חלוקת העמלה — לשונית לצד הקונה, לשונית לצד המוכר.
 *
 * ## למה שתי לשוניות ולא בורר אחד
 *
 * בעסקת תיווך יש שני תשלומים ולא אחד: הקונה משלם דמי תיווך והמוכר
 * משלם דמי תיווך. בורר אחד תיאר קופה מאוחדת, ולכן לא ידע לבטא את
 * ההסדר הנפוץ ביותר בשוק — *כל צד גובה מהלקוח שלו*. גרוע מזה:
 * ההסבר שמתחת לבורר הבטיח בדיוק את ההסדר הזה במילים, בעוד השדה
 * שמעליו כפה 33–67 על קופה אחת. שני המשרדים סיכמו דבר אחד וראו על
 * המסך דבר אחר.
 *
 * ## למה „אחר”
 *
 * חלוקה אמיתית אינה תמיד אחוז: „כל צד גובה מהלקוח שלו”, „חצי
 * מהעמלה שלי מעל 1.5%”. אחוז שנכפה על הסדר כזה אינו קירוב אלא
 * הצהרה שגויה שהצד השני יסתמך עליה, ולכן „אחר” פותח שדה חופשי.
 *
 * ## למה רכיב אחד לכל המסכים
 *
 * הבורר מופיע בטופס הפרסום ובעריכה המהירה מתוך הפיד. שתי גרסאות
 * היו נפרדות בעדכון הראשון, והסוכן היה פוגש שני כללים לאותה החלטה.
 */

/** הערך שמייצג „אחר” ב-`select`. אינו מספר, ולכן אינו מתנגש באחוז. */
const OTHER = "other";

export function CommissionTermsTabs({
  value,
  onChange,
  disabled = false,
}: {
  value: CommissionTerms;
  onChange: (next: CommissionTerms) => void;
  disabled?: boolean;
}) {
  const [side, setSide] = useState<CommissionSide>("buyer");
  /*
   * מזהה ייחודי לרכיב: הבורר מופיע כמה פעמים באותו מסך (עריכה מהירה
   * של כמה פרסומים בפיד), ו-`htmlFor` שחוזר על עצמו מקשר את התווית
   * לשדה של פרסום אחר.
   */
  const uid = useId();
  const current = value[side];

  function set(next: Partial<CommissionTerms[CommissionSide]>): void {
    onChange({ ...value, [side]: { ...current, ...next } });
  }

  return (
    <div>
      <div className="mv-tabs mb-3" role="tablist" aria-label="חלוקת העמלה">
        {COMMISSION_SIDES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={side === option}
            aria-controls={`${uid}-panel`}
            disabled={disabled}
            onClick={() => setSide(option)}
          >
            {COMMISSION_SIDE_LABEL[option]}
          </button>
        ))}
      </div>

      <div id={`${uid}-panel`} role="tabpanel">
        <p
          className="m-0 mb-2 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {COMMISSION_SIDE_HINT[side]}
        </p>

        <label htmlFor={`${uid}-split`} className="mb-1 block text-sm font-semibold">
          חלקכם בעמלה של הצד הזה
        </label>
        <select
          id={`${uid}-split`}
          className="mv-select"
          style={{ minHeight: 38, minWidth: 220 }}
          disabled={disabled}
          value={current.split === null ? OTHER : String(current.split)}
          onChange={(e) =>
            set(
              e.target.value === OTHER
                ? /*
                   * המעבר ל„אחר” מתחיל מריק ולא מנוסח קודם: ניסוח
                   * שנשאר מבחירה שבוטלה הוא תנאי שמישהו כבר שינה,
                   * והוא היה נשלח בשקט.
                   */
                  { split: null, note: current.note ?? "" }
                : { split: Number(e.target.value), note: null },
            )
          }
        >
          {COMMISSION_SPLIT_OPTIONS.map((option) => (
            <option key={option} value={String(option)}>
              {describeCommissionSplit(option)}
            </option>
          ))}
          <option value={OTHER}>אחר — נסחו בעצמכם</option>
        </select>

        {current.split === null ? (
          <div className="mt-2">
            <label
              htmlFor={`${uid}-note`}
              className="mb-1 block text-sm font-semibold"
            >
              איך תתחלק העמלה בצד הזה *
            </label>
            <input
              id={`${uid}-note`}
              value={current.note ?? ""}
              maxLength={OTHER_SPLIT_MAX_NOTE}
              disabled={disabled}
              placeholder="למשל: כל צד גובה מהלקוח שלו"
              onChange={(e) => set({ note: e.target.value })}
              className="w-full rounded-lg border px-3 py-2"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg)",
              }}
            />
            <p
              className="m-0 mt-1 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              הטקסט הזה מוצג למשרד השני כתנאי הפרסום — כתבו אותו כפי שתסכימו
              לעמוד מאחוריו.
            </p>
          </div>
        ) : (
          /*
            "50%" בלי הקשר לא אומר דבר — חצי ממה, ומי גובה ממי. זו
            השאלה שחוזרת בכל שיחת תמיכה על שת"פ.
          */
          <p
            className="m-0 mt-1 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            זהו חלקכם <b>בדמי התיווך שהצד הזה משלם</b> — לא סכום שמשולם
            למערכת. החלוקה נקבעת עכשיו ולא במו&quot;מ אחרי שהעסקה כבר על
            השולחן.
          </p>
        )}
      </div>
    </div>
  );
}
