"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_WHATSAPP_NOTIFY_PREFS,
  NOTIFY_CATEGORY_LABELS,
  parseWhatsAppNotifyPrefs,
  WHATSAPP_NOTIFY_PREF_KEY,
  type WhatsAppNotifyCategory,
  type WhatsAppNotifyPrefs,
} from "@metavchim/shared";
import { apiGet, apiPatch } from "@/lib/api";
import { Notice } from "../notice";

/**
 * „מה יגיע אליי לוואטסאפ” — ההגדרה של מי שמקבל את ההודעות.
 *
 * הדחיפה היזומה היא צלצול בטלפון הפרטי, ולכן היא **כבויה כברירת
 * מחדל** ומופעלת כאן ולא ע"י המשרד: בעל המשרד קונה את המנוי, אבל
 * מי שמחליט אם להעיר אותו בשש בבוקר הוא הסוכן עצמו. מאותה סיבה
 * שעות השקט קיימות מהרגע הראשון ולא כתוספת מאוחרת.
 *
 * הכיבוי הוא לפי קטגוריה ולא לפי סוג התראה: אף אחד לא אמור להכיר
 * שנים-עשר קודי התראה כדי להשקיט רעש.
 */

interface ProfileDto {
  phone: string;
  preferences: Record<string, unknown>;
}

const CATEGORY_ORDER: WhatsAppNotifyCategory[] = [
  "calls",
  "leads",
  "tasks",
  "matches",
  "network",
  "digests",
  "system",
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function WhatsAppNotifySection() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [prefs, setPrefs] = useState<WhatsAppNotifyPrefs>(DEFAULT_WHATSAPP_NOTIFY_PREFS);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ProfileDto>("/auth/profile")
      .then((res) => {
        setProfile(res);
        setPrefs(parseWhatsAppNotifyPrefs(res.preferences));
      })
      .catch(() => undefined);
  }, []);

  /*
   * נשמר מיד ולא ב"שמור": זה מתג, והמצב שעל המסך הוא כבר המצב
   * הנכון. כישלון רשת אינו מחזיר את המסך אחורה — ההגדרה תיסנכרן
   * בשינוי הבא, בדיוק כמו העדפות הנגישות באותו מסך.
   */
  function persist(next: WhatsAppNotifyPrefs): void {
    setPrefs(next);
    apiPatch("/auth/profile", {
      preferences: { ...(profile?.preferences ?? {}), [WHATSAPP_NOTIFY_PREF_KEY]: next },
    })
      .then(() => setMessage("✓ ההגדרה נשמרה"))
      .catch(() => setMessage("השמירה נכשלה — נסו שוב"));
  }

  const noPhone = profile !== null && profile.phone.trim() === "";

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="wa-notify-heading">
      <h2
        id="wa-notify-heading"
        className="m-0 mb-1"
        style={{ fontSize: 16.5, fontWeight: 800 }}
      >
        עדכונים בוואטסאפ
      </h2>
      <p className="m-0 mb-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        הסוכן ישלח לכם לוואטסאפ שיחות שלא נענו, לידים חדשים, סיכומי תמלול
        ותזכורות — בלי להיכנס למערכת. אפשר לענות לו באותה שיחה כדי לטפל.
      </p>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {noPhone ? (
        <Notice tone="warning">
          כדי לקבל עדכונים צריך למלא טלפון בפרטים האישיים למעלה — לפיו הסוכן
          מזהה אתכם.
        </Notice>
      ) : null}

      <label className="flex items-center gap-2.5 text-[15px] font-semibold">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(event) => persist({ ...prefs, enabled: event.target.checked })}
        />
        לשלוח לי עדכונים בוואטסאפ
      </label>

      {prefs.enabled ? (
        <>
          <p className="mb-1.5 mt-4 text-[14px] font-semibold">מה לשלוח</p>
          <div className="flex flex-col gap-1.5">
            {CATEGORY_ORDER.map((category) => (
              <label key={category} className="flex items-center gap-2.5 text-[14.5px]">
                <input
                  type="checkbox"
                  checked={prefs.categories[category] !== false}
                  onChange={(event) =>
                    persist({
                      ...prefs,
                      categories: { ...prefs.categories, [category]: event.target.checked },
                    })
                  }
                />
                {NOTIFY_CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>

          <p className="mb-1.5 mt-4 text-[14px] font-semibold">שעות שקט</p>
          <p className="m-0 mb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
            בשעות האלה לא תישלח הודעה. מה שהצטבר יגיע בבוקר.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[14.5px]">
            <label htmlFor="quiet-from">מ־</label>
            <select
              id="quiet-from"
              className="rounded-lg border px-2 py-1"
              style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
              value={prefs.quietFromHour}
              onChange={(event) =>
                persist({ ...prefs, quietFromHour: Number(event.target.value) })
              }
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
            <label htmlFor="quiet-to">עד</label>
            <select
              id="quiet-to"
              className="rounded-lg border px-2 py-1"
              style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
              value={prefs.quietToHour}
              onChange={(event) => persist({ ...prefs, quietToHour: Number(event.target.value) })}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
    </section>
  );
}
