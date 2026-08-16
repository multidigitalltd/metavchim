"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COMMISSION_SPLIT_OPTIONS,
  describeCommissionSplit,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { IconHandshake } from "../../icons";

/**
 * פתיחת קונה לשיתוף פעולה עם משרדים אחרים.
 *
 * עד כה זה היה כפתור אחד דחוס בשורת הפעולות של הכותרת, בין "וואטסאפ"
 * ל"חייג" — שלוש פעולות שאין ביניהן שום קשר. שיתוף קונה ברשת הוא
 * החלטה עסקית: הסוכן מוותר על חצי מהעמלה כדי למצוא נכס מהר יותר.
 * החלטה כזו צריכה אזור משלה, הסבר מה נחשף ומה לא, ואישור מפורש
 * שהיא בוצעה — ולא כפתור שנראה כמו "חייג".
 *
 * הזרימה: הזמנה ← הגדרת עמלה ותיאור ← שליחה ← אישור.
 */

/** שלב בזרימה. `loading` קיים כי מצב השיתוף נקרא מהשרת. */
type Stage = "loading" | "invite" | "form" | "sent";

/** הביקוש הפעיל של הקונה, כפי שהשרת מחזיר אותו. */
interface ActiveDemand {
  id: string;
  commissionSplit: number;
  notes?: string | null;
}

export function NetworkShareSection({ buyerId }: { buyerId: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [split, setSplit] = useState<number>(50);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** קיים = הקונה משותף כרגע; משמש כדי לעדכן במקום לפרסם מחדש. */
  const [demand, setDemand] = useState<ActiveDemand | null>(null);

  /*
   * מצב השיתוף נקרא מהשרת ולא מונח מראש. בלי זה רענון של הכרטיס
   * החזיר את המסך למצב "הזמנה" גם כשהקונה כבר משותף, והשיתוף החוזר
   * נדחה ב"הקונה כבר משותף ברשת" — שגיאה על פעולה שהמסך הציע.
   */
  const load = useCallback(() => {
    apiGet<ActiveDemand | null>(`/collaboration/share/buyer/${buyerId}`)
      .then((active) => {
        if (active) {
          setDemand(active);
          setSplit(active.commissionSplit);
          setNote(active.notes ?? "");
          setStage("sent");
        } else {
          setDemand(null);
          setStage("invite");
        }
      })
      // כשל בקריאה לא נועל את האזור: המסך נופל למצב ההזמנה,
      // והשרת עדיין יאכוף שיתוף כפול אם ינסו
      .catch(() => setStage("invite"));
  }, [buyerId]);

  useEffect(load, [load]);

  /** פרסום חדש, או עדכון כשהקונה כבר משותף — הכפתור אחד לשניהם. */
  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        commissionSplit: split,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      if (demand) {
        await apiPatch(`/collaboration/share/buyer/${buyerId}`, payload);
      } else {
        await apiPost("/collaboration/share", { buyerId, ...payload });
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השיתוף נכשל — נסו שוב");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  /** הפסקת שיתוף — הביקוש נסגר ואינו מוצג יותר ברשת. */
  async function stopSharing(): Promise<void> {
    if (!demand) return;
    if (!window.confirm("להפסיק את שיתוף הקונה ברשת? הביקוש לא יוצג יותר למשרדים אחרים.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/collaboration/demands/${demand.id}`);
      setNote("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפסקת השיתוף נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mv-list-card mb-[18px] px-[22px] py-[18px]"
      aria-labelledby="network-share-heading"
    >
      {/*
        כותרת עם אייקון בעיגול וגוף קריא, ולא שורה מודגשת מעל שתי
        פסקאות ב-13px.

        זה האזור היחיד בכרטיס שמציע למתווך לעשות משהו **חדש** — לפתוח
        לקוח למשרדים אחרים — וכל השכנוע נמצא בפסקאות. כשהן בגודל של
        הערת שוליים, מי שמהסס פשוט לא קורא אותן, ואז הכפתור למטה
        חסר הקשר.
      */}
      <header className="mv-hero mb-3">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconHandshake s={22} />
        </span>
        <div>
          <h2
            id="network-share-heading"
            className="m-0 text-[18px] font-extrabold leading-tight"
          >
            שיתוף פעולה עם משרדים אחרים
          </h2>
          <p className="m-0 mt-0.5 text-[13.5px]" style={{ color: "var(--color-text-muted)" }}>
            עוד עיניים על הביקוש הזה — בלי לחשוף את הלקוח.
          </p>
        </div>
      </header>

      {stage === "loading" ? (
        <p className="m-0 mt-2 text-[13px]" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : stage === "sent" ? (
        <div
          role="status"
          className="mt-3 rounded-xl border p-4"
          style={{ borderColor: "var(--color-success)", background: "var(--color-primary-soft)" }}
        >
          <p className="m-0 mb-1 font-bold" style={{ fontSize: 14.5 }}>
            ✓ הקונה נשלח לרשת המתווכים
          </p>
          <p className="m-0 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
            הביקוש פורסם כאנונימי — בלי שם, בלי טלפון ועם תקציב מעוגל. משרדים
            שיש להם נכס מתאים יוכלו לפנות אליכם, וחלוקת העמלה שסוכמה היא{" "}
            <strong>{describeCommissionSplit(split)}</strong>.
          </p>
          {/*
            עדכון ולא פרסום מחדש: הביקוש הקיים מתעדכן במקום, ולכן
            ההיסטוריה וההצעות שכבר התקבלו עליו נשמרות
          */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "5px 12px", fontSize: 12.5 }}
              disabled={busy}
              onClick={() => setStage("form")}
            >
              עדכן עמלה או תיאור
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              style={{ padding: "5px 12px", fontSize: 12.5 }}
              disabled={busy}
              onClick={() => void stopSharing()}
            >
              הפסק שיתוף
            </button>
          </div>
          {error ? (
            <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : stage === "invite" ? (
        <>
          <p className="mv-explain m-0 mb-2.5">
            רוצים למצוא לו נכס מהר יותר? אפשר לפתוח את הקונה הזה למשרדים אחרים
            ברשת. פרטיו האישיים <strong>לא נחשפים</strong> — מתפרסם ביקוש
            אנונימי בלבד, ואתם בוחרים את חלוקת העמלה.
          </p>
          {/*
            "כמה זה עולה לי" היא השאלה הראשונה שמתווך שואל לפני שהוא
            משתף, ובלי תשובה הוא פשוט לא לוחץ. שיתוף פעולה חינם;
            קרדיטים נוגעים אך ורק לקליטת הפניית לקוח.
          */}
          <p className="mv-explain m-0 mb-4">
            <strong style={{ color: "var(--color-primary)" }}>השיתוף חינם</strong>{" "}
            — בכל המסלולים ובלי קרדיטים. התשלום היחיד הוא חלוקת העמלה עם המשרד
            שיסגור איתכם את העסקה.
          </p>
          <button
            type="button"
            className="mv-btn-action"
            onClick={() => setStage("form")}
          >
            <IconHandshake s={14} /> פתח את הקונה לשיתוף פעולה
          </button>
        </>
      ) : (
        <>
          <p className="mv-explain m-0 mb-4">
            שני פרטים ואפשר לשלוח. השכונות המבוקשות מהדרישות יצורפו לביקוש
            אוטומטית.
          </p>

          <div className="mb-3">
            <label htmlFor="shareSplit" className="mb-1 block text-sm font-semibold">
              חלוקת העמלה עם המשרד השני
            </label>
            <select
              id="shareSplit"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="mv-select"
              style={{ minHeight: 38, minWidth: 220 }}
            >
              {COMMISSION_SPLIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {describeCommissionSplit(option)}
                </option>
              ))}
            </select>
            {/*
              "50%" בלי הקשר לא אומר דבר — חצי ממה, ומי גובה ממי.
              זו השאלה שחוזרת בכל שיחת תמיכה על שת"פ.
            */}
            <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              זהו חלקכם <b>בדמי התיווך של העסקה</b> — לא סכום שמשולם למערכת. כל
              צד גובה מהלקוח שלו לפי ההסכם שחתם איתו, והחלוקה נקבעת עכשיו ולא
              במו&quot;מ אחרי שהעסקה כבר על השולחן.
            </p>
          </div>

          <div className="mb-3">
            <label htmlFor="shareNote" className="mb-1 block text-sm font-semibold">
              מה הקונה מחפש (לא חובה)
            </label>
            <textarea
              id="shareNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder='לדוגמה: "מחפשים דירה משופצת לכניסה מהירה, גמישים על קומה אם יש מעלית"'
              className="w-full rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
            <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              אל תכתבו כאן שם, טלפון או כתובת מדויקת — הטקסט מוצג למשרדים אחרים.
            </p>
          </div>

          {error ? (
            <p role="alert" className="m-0 mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-btn-action"
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? "שולח…" : demand ? "שמור עדכון" : "שלח לרשת המתווכים"}
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              // ביטול חוזר למצב האמיתי: משותף ⟵ אישור, לא משותף ⟵ הזמנה
              onClick={() => setStage(demand ? "sent" : "invite")}
            >
              ביטול
            </button>
          </div>
        </>
      )}
    </section>
  );
}
