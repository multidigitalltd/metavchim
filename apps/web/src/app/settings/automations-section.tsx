"use client";

import { useEffect, useState } from "react";
import {
  automationUnitLabel,
  VIEWING_REMINDER_CHANNELS,
  VIEWING_REMINDER_PLACEHOLDERS,
  VIEWING_REMINDER_TEXT_MAX,
  viewingReminderChannelLabel,
  type AutomationKey,
  type AutomationSettings,
  type AutomationSpec,
  type ViewingReminderChannel,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { IconBolt, IconInfo } from "../icons";
import { Notice } from "../notice";

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
  /**
   * ‎**תזכורת הסיור בוואטסאפ נשלחת בשדות קבועים.**
   *
   * ‏הגדרת פלטפורמה שאומרת איזו תבנית נרשמה מול Meta — המשרד אינו
   * יכול לשנות אותה, אבל היא קובעת מה קורה לנוסח שהוא כותב כאן:
   * כשהיא דולקת הנוסח יוצא **במייל בלבד**, ובוואטסאפ יוצאים שם,
   * תאריך, שעה, כתובת ושם המשרד.
   */
  whatsappViewingReminderFields: boolean;
  /**
   * ‎**האם בכלל נרשמה תבנית לתזכורת בוואטסאפ.**
   *
   * ‏בלי שם תבנית `deliver` אינו שולח דבר בוואטסאפ. שתי ההגדרות
   * עצמאיות, ולכן „נשלח במייל בלבד” נכון תמיד כשהשדות דולקים, אבל
   * „בוואטסאפ יוצאת תבנית קבועה” נכון רק כששתיהן מוגדרות.
   */
  whatsappViewingReminderTemplateSet: boolean;
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
    next: {
      enabled?: boolean;
      value?: number;
      channel?: ViewingReminderChannel;
      messages?: Record<string, string>;
    },
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
      <section className="mv-card p-6">
        <Notice tone="danger">{error}</Notice>
      </section>
    );
  }
  if (data === null) {
    return (
      <section className="mv-card p-6">
        <p aria-live="polite">טוען…</p>
      </section>
    );
  }

  return (
    <section className="mv-card p-6" id="automations">
      <h2 className="mb-1 text-lg font-semibold">
        <IconBolt s={17} /> אוטומציות פנימיות
      </h2>
      <p
        className="mb-3 text-[length:var(--type-body)]"
        style={{ color: "var(--color-text-soft)" }}
      >
        מה המערכת עושה מעצמה. כל אחת מהן פותחת משימה או שולחת התראה — כאן רואים
        בדיוק מה, מתי, ואפשר לכבות או לשנות את הסף.
      </p>

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
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
                  <b className="block text-[length:var(--type-button)]">{spec.title}</b>
                  <span
                    className="block text-[length:var(--type-caption-lg)]"
                    style={{ color: "var(--color-text-soft)" }}
                  >
                    {spec.what}
                  </span>
                  <span
                    className="block text-[length:var(--type-caption)]"
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
                  <label className="flex items-center gap-1.5 text-[length:var(--type-caption-lg)] font-semibold">
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
                  <label className="text-[length:var(--type-caption)]">
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
                        borderColor: "var(--color-input-border)",
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
                      className="text-[length:var(--type-caption)]"
                      style={{ color: "var(--color-primary)" }}
                    >
                      נשמר
                    </span>
                  ) : null}
                </div>
              ) : saved === spec.key ? (
                <span
                  className="text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-primary)" }}
                >
                  נשמר
                </span>
              ) : null}
              {/*
                ‎**הערוץ והנוסח — רק לאוטומציה שפונה ללקוח.**

                שאר האוטומציות פותחות משימה או שולחות התראה פנימה,
                ולכן אין להן „באיזה אמצעי” ו„באילו מילים”. שדות
                שהיו מופיעים אצל כולן היו מבטיחים שליטה שאין לה
                משמעות.
              */}
              {spec.outbound !== undefined && setting.enabled ? (
                <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--color-input-border)" }}>
                  <label
                    htmlFor={`${spec.key}-channel`}
                    className="mb-1 block text-[length:var(--type-caption)] font-medium"
                  >
                    איך נשלח
                  </label>
                  <select
                    id={`${spec.key}-channel`}
                    className="mb-3 rounded-lg border px-3 py-2"
                    style={{
                      borderColor: "var(--color-input-border)",
                      background: "var(--color-surface)",
                      color: "var(--color-text)",
                    }}
                    value={setting.channel ?? "both"}
                    disabled={busy === spec.key}
                    onChange={(e) => {
                      void save(spec.key, {
                        channel: e.target.value as ViewingReminderChannel,
                      });
                    }}
                  >
                    {VIEWING_REMINDER_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {viewingReminderChannelLabel(channel)}
                      </option>
                    ))}
                  </select>

                  {/*
                    ‎**איפה הנוסח הזה באמת יוצא.**

                    כשהתבנית שנרשמה מול Meta היא זו עם השדות, הנוסח
                    החופשי אינו נשלח בוואטסאפ כלל — שם יוצאים שם,
                    תאריך, שעה, כתובת ושם המשרד. בלי המשפט הזה המסך
                    מציג „נוסח התזכורת” ובורר ערוץ עם „וואטסאפ”, ומי
                    שעורך כאן מאמין שמה שכתב נשלח.

                    נאמר פעם אחת מעל התיבות ולא בכל אחת: זו עובדה על
                    הערוץ, לא על הנמען.
                  */}
                  {data.whatsappViewingReminderFields ? (
                    <p
                      className="m-0 mb-3 rounded-[9px] px-[13px] py-[9px] text-[length:var(--type-caption-lg)]"
                      style={{
                        background: "var(--domain-neutral-bg)",
                        border: "1px solid var(--color-input-border)",
                        color: "var(--domain-neutral-fg)",
                      }}
                    >
                      {/*
                        ‎**החלק הראשון נכון תמיד; השני רק כשיש תבנית.**

                        שתי ההגדרות עצמאיות — „שדות” מסומן ושם התבנית
                        ריק הוא צירוף אפשרי, ואז בוואטסאפ לא יוצא
                        כלום. הבטחה על „תבנית קבועה שאושרה” במצב הזה
                        הייתה מבטיחה משלוח שאינו קורה (ביקורת Codex).
                      */}
                      הנוסח שכאן נשלח <b>במייל בלבד</b>.{" "}
                      {data.whatsappViewingReminderTemplateSet
                        ? "בוואטסאפ יוצאת תבנית קבועה שאושרה מראש, ובה שם הלקוח, תאריך, שעה, כתובת ושם המשרד."
                        : "תזכורת בוואטסאפ אינה נשלחת כרגע — לא הוגדרה תבנית מאושרת."}
                    </p>
                  ) : null}

                  {spec.outbound.audiences.map((audience) => (
                    <div key={audience.key} className="mb-3">
                      <label
                        htmlFor={`${spec.key}-${audience.key}`}
                        className="mb-1 block text-[length:var(--type-caption)] font-medium"
                      >
                        {audience.title}
                      </label>
                      <textarea
                        id={`${spec.key}-${audience.key}`}
                        rows={3}
                        maxLength={VIEWING_REMINDER_TEXT_MAX}
                        className="w-full rounded-lg border px-3 py-2"
                        style={{
                          borderColor: "var(--color-input-border)",
                          background: "var(--color-surface)",
                          color: "var(--color-text)",
                        }}
                        value={setting.messages?.[audience.key] ?? audience.defaultText}
                        disabled={busy === spec.key}
                        onChange={(e) => {
                          const text = e.target.value;
                          setData((prev) =>
                            prev === null
                              ? prev
                              : {
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    [spec.key]: {
                                      ...setting,
                                      messages: {
                                        ...(setting.messages ?? {}),
                                        [audience.key]: text,
                                      },
                                    },
                                  },
                                },
                          );
                        }}
                        /* נשמר ביציאה מהשדה, כמו השדה המספרי */
                        onBlur={(e) => {
                          void save(spec.key, {
                            messages: {
                              ...(setting.messages ?? {}),
                              [audience.key]: e.target.value,
                            },
                          });
                        }}
                      />
                    </div>
                  ))}

                  <p
                    className="m-0 text-[length:var(--type-caption)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    אפשר לשתול:{" "}
                    {VIEWING_REMINDER_PLACEHOLDERS.map((p) => p.token).join(" · ")}
                    {" "}— תיבה שנמחקת חוזרת לנוסח המקורי.
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p
        className="m-0 mt-3 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        שינוי נכנס לתוקף תוך דקה. פולו-אפ שכבר נקבע לפני הכיבוי לא יישלח.
      </p>
    </section>
  );
}
