"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { IconBolt } from "../icons";
import { Notice } from "../notice";

/**
 * ברירות המחדל של המשרד — מה שקורה מעצמו לכל כרטיס חדש.
 *
 * ## למה כאן ולא ב„פרטי המשרד”
 *
 * שלושת המתגים האלה ישבו בין שם המשרד, מספר הרישיון ואחוז העמלה —
 * כלומר בין שדות שממלאים **פעם אחת בהקמה**. הם אינם פרט של המשרד
 * אלא **התנהגות שרצה מעצמה**: כל נכס חדש מתפרסם, כל קונה חדש
 * מתפרסם, כל התאמה מומלצת יוצאת במייל ללקוח. זו בדיוק השאלה שלשונית
 * האוטומציות עונה עליה — „למה זה קרה, ואיך מכבים”.
 *
 * מי שראה הצעה שיצאה ללקוח וחיפש מי שלח אותה חיפש אותה כאן. הוא מצא
 * טופס עם כפתור „שמור” בתוך מסך פרטי המשרד, ולא היה סיבה שיחשוד שם.
 *
 * ## למה שמירה מיידית ולא כפתור
 *
 * אותו נימוק של שאר הלשונית: מתג הוא פעולה שמצפים שתיכנס לתוקף
 * מיד, ומתג שדורש שמירה נפרדת הוא מתג שאנשים מזיזים ועוזבים את
 * המסך בלי לשמור — כאן זה אומר לחשוב שכיבית פרסום אוטומטי לרשת
 * בזמן שהוא ממשיך לרוץ.
 */

export interface OfficeDefaults {
  autoShareProperties: boolean;
  autoShareBuyers: boolean;
  autoEmailOffers: boolean;
}

type Key = keyof OfficeDefaults;

const ROWS: { key: Key; title: string; detail: string }[] = [
  {
    key: "autoShareProperties",
    title: "כל נכס חדש מתפרסם לרשת אוטומטית",
    detail:
      "בלי כתובת מדויקת ובלי פרטי הבעלים. חלוקת עמלה 50/50 — ניתנת לשינוי בכרטיס הנכס.",
  },
  {
    key: "autoShareBuyers",
    title: "כל קונה חדש מתפרסם כביקוש ברשת אוטומטית",
    detail:
      "בלי שם ובלי טלפון, בתקציב מעוגל. קונה בלי אזור חיפוש לא מתפרסם עד שיוגדר לו אזור.",
  },
];

export function OfficeDefaultsSection({
  value,
  onSave,
}: {
  value: OfficeDefaults;
  /** שומר את מה שהשתנה בלבד, ומחזיר שגיאה כדי שהמתג יחזור. */
  onSave: (patch: Partial<OfficeDefaults>) => Promise<void>;
}) {
  const [busy, setBusy] = useState<Key | null>(null);
  const [saved, setSaved] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: Key, next: boolean): Promise<void> {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      await onSave({ [key]: next } as Partial<OfficeDefaults>);
      setSaved(key);
    } catch (err: unknown) {
      /*
       * ‎**השגיאה נאמרת, והמתג חוזר.** מתג שנשאר במצב החדש אחרי
       * שהשמירה נכשלה הוא שקר על מה שרץ בפועל — ובדיוק כאן המחיר
       * הוא נכסים שממשיכים להתפרסם אחרי ש„כיביתי”.
       */
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="mb-4 rounded-xl border p-4"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <h3 className="m-0 mb-1 font-semibold">
        <IconBolt s={16} /> ברירות מחדל לכרטיס חדש
      </h3>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מה שקורה מעצמו בכל פעם שנפתח כרטיס — בלי שאיש לוחץ. אפשר לשנות
        בכרטיס עצמו גם כשהמתג דלוק.
      </p>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      <fieldset
        className="mb-3 rounded-lg border p-3.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <legend className="px-1 text-sm font-bold">רשת שיתופי הפעולה</legend>
        {ROWS.map((row) => (
          <Row
            key={row.key}
            row={row}
            checked={value[row.key]}
            busy={busy === row.key}
            locked={busy !== null}
            saved={saved === row.key}
            onChange={(next) => void toggle(row.key, next)}
          />
        ))}
      </fieldset>

      <fieldset
        className="rounded-lg border p-3.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <legend className="px-1 text-sm font-bold">הצעות ללקוחות במייל</legend>
        <Row
          row={{
            key: "autoEmailOffers",
            title:
              "לקוחות מקבלים אוטומטית במייל הצעות מהתאמות פנימיות של המשרד",
            detail:
              "רק התאמות חדשות ומומלצות (85%+) לנכסים פעילים, ורק ללקוח עם אימייל שחתם על הזמנה בכתב לנכס. התאמות מהרשת אינן נשלחות. כל מייל כולל קישור הסרה, והשליחה מהדומיין של המשרד אם חובר.",
          }}
          checked={value.autoEmailOffers}
          busy={busy === "autoEmailOffers"}
          locked={busy !== null}
          saved={saved === "autoEmailOffers"}
          onChange={(next) => void toggle("autoEmailOffers", next)}
        />
      </fieldset>
    </section>
  );
}

function Row({
  row,
  checked,
  busy,
  locked,
  saved,
  onChange,
}: {
  row: { key: Key; title: string; detail: string };
  checked: boolean;
  /** השורה הזו נשמרת כרגע. */
  busy: boolean;
  /**
   * שורה **אחרת** נשמרת כרגע.
   *
   * שלושת המתגים יושבים באותו מסמך הגדרות, וכל שמירה כותבת אותו
   * במלואו. שתי שמירות שרצות במקביל קוראות את אותו צילום, וזו
   * שכותבת שנייה מוחקת את הראשונה — והמסך היה מציג „נשמר” על
   * שתיהן (ביקורת Codex). השרת נועל עכשיו את השורה וזה לא יקרה,
   * אבל מתג שנראה זמין ואינו נשמר מיד הוא עדיין הבטחה לא מדויקת.
   */
  locked: boolean;
  saved: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className="mb-2 flex items-start gap-2 text-sm last:mb-0"
      htmlFor={row.key}
    >
      <input
        type="checkbox"
        id={row.key}
        name={row.key}
        checked={checked}
        disabled={busy || locked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <b className="block">
          {row.title}
          {busy ? " · שומר…" : saved ? " · ✓ נשמר" : ""}
        </b>
        <span style={{ color: "var(--color-text-muted)" }}>{row.detail}</span>
      </span>
    </label>
  );
}
