"use client";

import { useEffect, useState } from "react";
import {
  automationUnitLabel,
  type AutomationKey,
  type AutomationSettings,
  type AutomationSpec,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { IconBolt, IconInfo } from "../icons";

/**
 * האוטומציות הפנימיות — מה המערכת עושה מעצמה.
 *
 * ## למה המסך הזה קיים
 *
 * המערכת הריצה שמונה אוטומציות מהיום הראשון, וכולן היו בלתי נראות:
 * המשרד קיבל משימות ש"מישהו" יצר, לא ידע מי, ולא יכול היה לכבות
 * אחת מהן. הספים היו משתני סביבה — כלומר זהים לכל המשרדים.
 *
 * מתווך שמוצף משימות אוטומטיות מפסיק להסתכל על **כל** המשימות,
 * כולל אלה שהוא כן יצר לעצמו. לכן הרשימה הזו אינה "הגדרות מתקדמות":
 * היא התשובה לשאלה "למה נפתחה לי המשימה הזאת", והיא המקום לומר
 * "לא, לא בשבילי".
 *
 * הרשימה והתיאורים מגיעים מהשרת ולא נכתבים כאן: תיאור שמתיישן במסך
 * הוא הבטחה לא נכונה על מה שקורה בפועל.
 */

interface Loaded {
  settings: AutomationSettings;
  catalogue: AutomationSpec[];
}

export function AutomationsSection() {
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<AutomationKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AutomationKey | null>(null);

  useEffect(() => {
    apiGet<Loaded>("/settings/automations")
      .then(setData)
      .catch(() => setError("טעינת האוטומציות נכשלה"));
  }, []);

  /*
   * שמירה פר-אוטומציה ולא כפתור "שמור" אחד לכל הטבלה.
   *
   * מתג הוא פעולה שהמשתמש מצפה שתיכנס לתוקף מיד; מתג שדורש שמירה
   * נפרדת הוא מתג שאנשים מזיזים ועוזבים את המסך בלי לשמור. השדה
   * המספרי נשמר ב-blur מאותה סיבה.
   */
  async function save(
    key: AutomationKey,
    next: { enabled?: boolean; value?: number },
  ) {
    setError(null);
    setBusy(key);
    try {
      const res = await apiPatch<{ settings: AutomationSettings }>(
        "/settings/automations",
        { [key]: next },
      );
      setData((prev) => (prev ? { ...prev, settings: res.settings } : prev));
      setSaved(key);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
      /* טעינה מחדש כדי שהמסך לא יציג מצב שלא נשמר */
      apiGet<Loaded>("/settings/automations")
        .then(setData)
        .catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (error !== null && data === null) {
    return (
      <section className="mv-card">
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      </section>
    );
  }
  if (data === null) {
    return (
      <section className="mv-card">
        <p aria-live="polite">טוען…</p>
      </section>
    );
  }

  return (
    <section className="mv-card" id="automations">
      <h2 className="mb-1 text-lg font-semibold">
        <IconBolt s={17} /> אוטומציות פנימיות
      </h2>
      <p
        className="mb-3 text-[14.5px]"
        style={{ color: "var(--color-text-soft)" }}
      >
        מה המערכת עושה מעצמה. כל אחת מהן פותחת משימה או שולחת התראה — כאן רואים
        בדיוק מה, מתי, ואפשר לכבות או לשנות את הסף.
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="mb-3 text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      <ul className="flex list-none flex-col gap-2.5 p-0">
        {data.catalogue.map((spec) => {
          const setting = data.settings[spec.key];
          const unit = automationUnitLabel(spec.unit);
          return (
            <li
              key={spec.key}
              className="rounded-lg border p-3"
              style={{
                borderColor: "var(--color-border)",
                /* אוטומציה כבויה נראית כבויה — אחרת המסך משקר */
                opacity: setting.enabled ? 1 : 0.6,
              }}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-[200px] flex-1">
                  <b className="block text-[15px]">{spec.title}</b>
                  <span
                    className="block text-[13px]"
                    style={{ color: "var(--color-text-soft)" }}
                  >
                    {spec.what}
                  </span>
                  <span
                    className="block text-[12.5px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {spec.when}
                  </span>
                </div>

                {spec.required === true ? (
                  <span
                    className="mv-chip"
                    title="מועדים שנובעים מהחוזה — אי אפשר לכבות"
                  >
                    <IconInfo s={13} /> תמיד פועל
                  </span>
                ) : (
                  <label className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <input
                      type="checkbox"
                      checked={setting.enabled}
                      disabled={busy === spec.key}
                      onChange={(e) =>
                        void save(spec.key, { enabled: e.target.checked })
                      }
                    />
                    פועל
                  </label>
                )}
              </div>

              {spec.unit !== null ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-[12px]">
                    <span className="mb-0.5 block font-semibold">
                      סף ({unit}) — בין {spec.min} ל-{spec.max}
                    </span>
                    <input
                      type="number"
                      min={spec.min}
                      max={spec.max}
                      value={setting.value ?? spec.defaultValue ?? 1}
                      disabled={!setting.enabled || busy === spec.key}
                      className="w-28 rounded-lg border px-2.5 py-1.5"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-field)",
                      }}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setSaved(null);
                        setData((prev) =>
                          prev
                            ? {
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  [spec.key]: { ...setting, value },
                                },
                              }
                            : prev,
                        );
                      }}
                      /* נשמר ביציאה מהשדה — לא בכל הקלדה של ספרה */
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        void save(spec.key, { value });
                      }}
                    />
                  </label>
                  {saved === spec.key ? (
                    <span
                      className="text-[12.5px]"
                      style={{ color: "var(--color-primary)" }}
                    >
                      נשמר
                    </span>
                  ) : null}
                </div>
              ) : saved === spec.key ? (
                <span
                  className="text-[12.5px]"
                  style={{ color: "var(--color-primary)" }}
                >
                  נשמר
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p
        className="m-0 mt-3 text-[12.5px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        שינוי נכנס לתוקף תוך דקה. פולו-אפ שכבר נקבע לפני הכיבוי לא יישלח.
      </p>
    </section>
  );
}
