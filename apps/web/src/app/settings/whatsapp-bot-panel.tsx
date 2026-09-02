"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";

/**
 * ‎**הגדרות הבוט של הסוכן** (docs/12 §6.2).
 *
 * מה שיש כאן הוא הטעם בלבד: הפעלה, נוסח פתיחה, שעות, שאלות אפיון.
 * מה שאין כאן — ובכוונה — הוא שדה „פרומפט”: הצגה עצמית כבוט, טיפול
 * ב„הסר”, ואסקלציה לאדם קבועים בשרת. סוכן שיכתוב הנחיה גרועה יקבל
 * בוט שמבטיח מחירים או מתחזה לאדם, **והנזק נוחת על דירוג האיכות של
 * המספר הפרטי שלו** אצל Meta — לא עלינו.
 *
 * הפאנל מוצג רק לקו מחובר, כי בלי קו אין למי לענות.
 */

interface BotSettings {
  enabled: boolean;
  officeName: string;
  greeting: string;
  questions: string[];
  afterHoursMessage: string;
  hoursFrom: number;
  hoursTo: number;
  days: number[];
}

const DEFAULTS: BotSettings = {
  enabled: false,
  officeName: "",
  greeting: "היי! אני העוזר הדיגיטלי של {{office}}. אשמח לכמה פרטים ואעביר לסוכן.",
  questions: [
    "מה מחפשים — קנייה, שכירות או מכירה?",
    "באיזה אזור?",
    "מה טווח התקציב?",
    "כמה חדרים?",
    "מתי רוצים להיכנס?",
  ],
  afterHoursMessage: "הודעתך התקבלה. נחזור אליך בשעות הפעילות.",
  hoursFrom: 8,
  hoursTo: 20,
  days: [0, 1, 2, 3, 4],
};

const DAY_LABELS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"] as const;

export function WhatsAppBotPanel({
  connectionId,
  included,
}: {
  connectionId: string;
  /** האם התוסף במסלול של המשרד — משנה את המסך, לא רק את הכפתור */
  included: boolean;
}) {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<{ settings: Partial<BotSettings> | null }>(`/whatsapp/connections/${connectionId}/bot`)
      .then((res) => {
        if (!alive) return;
        setSettings({ ...DEFAULTS, ...(res.settings ?? {}) });
      })
      .catch(() => {
        if (alive) setSettings({ ...DEFAULTS });
      });
    return () => {
      alive = false;
    };
  }, [connectionId]);

  const save = useCallback(
    (next: BotSettings) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      apiPatch(`/whatsapp/connections/${connectionId}/bot`, next)
        .then(() => setNotice("ההגדרות נשמרו"))
        .catch(() => setError("השמירה נכשלה. נסו שוב"))
        .finally(() => setBusy(false));
    },
    [connectionId],
  );

  if (!settings) return null;

  const set = <K extends keyof BotSettings>(key: K, value: BotSettings[K]): void => {
    setSettings({ ...settings, [key]: value });
  };

  const toggleDay = (day: number): void => {
    const days = settings.days.includes(day)
      ? settings.days.filter((d) => d !== day)
      : [...settings.days, day].sort((a, b) => a - b);
    set("days", days);
  };

  return (
    <div
      className="mt-3 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface-sunk)" }}
    >
      <h3 className="m-0 mb-1" style={{ fontSize: "calc(15 / 16 * 1rem)", fontWeight: 700 }}>
        הבוט שלי
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        עונה ללקוחות שכותבים למספר שלך, מאפיין את הפנייה ומעביר אליך. ברגע
        שאתה עונה בעצמו מהטלפון — הוא משתתק באותה שיחה.
      </p>

      {!included ? (
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          הבוט אינו כלול במסלול של המשרד. חיבור המספר וקליטת הפניות ממשיכים
          לעבוד; להפעלת הבוט פנו למנהל המשרד.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-3 text-sm" style={{ color: "var(--color-success)" }}>
          {notice}
        </p>
      ) : null}

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={!included || busy}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <span>הבוט פעיל</span>
      </label>

      <div className="mb-3">
        <label htmlFor="bot-office" className="mb-1 block text-sm font-medium">
          שם המשרד כפי שהבוט יציג אותו
        </label>
        <input
          id="bot-office"
          type="text"
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          value={settings.officeName}
          disabled={busy}
          maxLength={60}
          onChange={(e) => set("officeName", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor="bot-greeting" className="mb-1 block text-sm font-medium">
          משפט הפתיחה <span className="font-normal">({"{{office}}"} יוחלף בשם המשרד)</span>
        </label>
        <textarea
          id="bot-greeting"
          rows={2}
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          value={settings.greeting}
          disabled={busy}
          maxLength={400}
          onChange={(e) => set("greeting", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor="bot-questions" className="mb-1 block text-sm font-medium">
          שאלות האפיון <span className="font-normal">(שורה לכל שאלה, לפי הסדר)</span>
        </label>
        <textarea
          id="bot-questions"
          rows={5}
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          value={settings.questions.join("\n")}
          disabled={busy}
          onChange={(e) =>
            set(
              "questions",
              e.target.value.split("\n").map((q) => q.trim()).filter((q) => q !== ""),
            )
          }
        />
      </div>

      <fieldset className="mb-3 border-0 p-0">
        <legend className="mb-1 text-sm font-medium">ימי פעילות</legend>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, day) => (
            <label key={label} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={settings.days.includes(day)}
                disabled={busy}
                onChange={() => toggleDay(day)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-3 flex flex-wrap gap-3">
        <div style={{ minWidth: "8rem" }}>
          <label htmlFor="bot-from" className="mb-1 block text-sm font-medium">
            משעה
          </label>
          <input
            id="bot-from"
            type="number"
            min={0}
            max={23}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
            value={settings.hoursFrom}
            disabled={busy}
            onChange={(e) => set("hoursFrom", Number(e.target.value))}
          />
        </div>
        <div style={{ minWidth: "8rem" }}>
          <label htmlFor="bot-to" className="mb-1 block text-sm font-medium">
            עד שעה
          </label>
          <input
            id="bot-to"
            type="number"
            min={0}
            max={23}
            className="w-full rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
            value={settings.hoursTo}
            disabled={busy}
            onChange={(e) => set("hoursTo", Number(e.target.value))}
          />
        </div>
      </div>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        שעון ישראל. שעה זהה בשני השדות = כל היממה.
      </p>

      <div className="mb-3">
        <label htmlFor="bot-after" className="mb-1 block text-sm font-medium">
          מענה מחוץ לשעות הפעילות
        </label>
        <textarea
          id="bot-after"
          rows={2}
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
          value={settings.afterHoursMessage}
          disabled={busy}
          maxLength={400}
          onChange={(e) => set("afterHoursMessage", e.target.value)}
        />
      </div>

      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        קבוע ולא ניתן לשינוי: הבוט מציג את עצמו כבוט, אינו מתחייב על מחיר או
        זמינות, מעביר אליך לקוח שמבקש אדם, ומכבד בקשת „הסר”.
      </p>

      <button
        type="button"
        className="mv-button mv-button--primary"
        disabled={busy}
        onClick={() => save(settings)}
      >
        שמירת הגדרות הבוט
      </button>
    </div>
  );
}
