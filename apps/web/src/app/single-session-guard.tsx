"use client";

import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { resetA11ySync } from "@/lib/a11y-sync";
import { clearSessionCache } from "@/lib/session-cache";
import { formatDateTime } from "@/lib/format";
import { IconShield } from "./icons";
import { Notice } from "./notice";
import { describeDevice, type SessionRow } from "./sessions-list";

/**
 * שער החיבור היחיד — **חשבון אחד, מכשיר פעיל אחד.**
 *
 * שני חיבורים פעילים לאותו חשבון הם אחד משניים: סיסמה שדלפה, או
 * מנוי שמשותף בין אנשים. שניהם בדיוק מה שהמערכת לא רוצה לאפשר
 * בשקט (בקשת המשתמש: "גם מבחינת אבטחה וגם מבחינת שמירה שלא ישתפו
 * מנויים").
 *
 * ## איך זה עובד
 *
 * בכניסה לאזור המחובר נשלפת רשימת החיבורים. אם קיים חיבור פעיל
 * נוסף — נפתח דיאלוג חוסם שאומר "זוהה חיבור נוסף", מציג **איפה**
 * (מכשיר, כתובת, מועד התחברות), ומציב את הבחירה שהמשתמש ביקש
 * במילותיו: "השאר אותי כאן" (מנתק את כל האחרים) או "צא" (מתנתק
 * כאן). אין אפשרות שלישית ואין סגירה בלי בחירה — Escape ולחיצה על
 * הרקע מנוטרלים, כי "התעלמתי" משאיר את שני החיבורים חיים וזה
 * בדיוק המצב שהשער נבנה למנוע.
 *
 * ## למה בצד הלקוח ולא חסימה בשרת
 *
 * חסימת ההתחברות השנייה בשרת הייתה נועלת בחוץ דווקא את הבעלים
 * האמיתי: מי ששכח להתנתק במשרד לא יכול להיכנס מהבית עד שהחיבור
 * הישן יפוג. הבחירה נותנת לבעל הסיסמה לנצח תמיד — הוא מנתק את
 * האחר בלחיצה. ומי שמשתף מנוי? שני הצדדים מנתקים זה את זה בלופ,
 * והשיתוף מפסיק להיות שווה את הכאב. האכיפה האמיתית נשארת בשרת:
 * המחיקה היא של רשומות ה-Session במסד, לא רק מהמסך.
 *
 * ## מה לא סופר
 *
 * חיבור תמיכה (supportAdminEmail) אינו מקפיץ את השער: הוא נפתח
 * בהסכמה מפורשת מהמסך של המשתמש עצמו, מוגבל לשעה, ומסומן בנפרד
 * ברשימת החיבורים.
 */
export function SingleSessionGuard(): React.JSX.Element | null {
  const [others, setOthers] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    apiGet<{ sessions: SessionRow[] }>("/auth/sessions")
      .then((res) => {
        /*
         * דפדפן התמיכה עצמו פטור מהשער: כשהתמיכה נכנסת בהסכמה,
         * החיבור הרגיל של המשתמש נראה משם כ"מכשיר נוסף" — והשער
         * היה מכריח את התומך לנתק את המשתמש או לנטוש את הטיפול
         * (ביקורת Codex). זו גישה בהסכמה, לא שיתוף מנוי.
         */
        const current = res.sessions.find((row) => row.current);
        if (current !== undefined && current.supportAdminEmail !== null) return;
        const foreign = res.sessions.filter(
          (row) => !row.current && row.supportAdminEmail === null,
        );
        if (foreign.length > 0) setOthers(foreign);
      })
      /*
       * כשל שליפה אינו נועל את המערכת: בלי מידע אין מה לאכוף,
       * והשרת ממילא ידחה כל בקשה של חיבור שנותק.
       */
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (others !== null) ref.current?.showModal();
  }, [others]);

  async function stayHere(): Promise<void> {
    if (others === null) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * ניתוק **בדיוק של מה שמוצג** — חיבור-חיבור, לא revoke-others:
       * הגורף היה מוחק גם חיבור תמיכה פעיל שאינו מופיע ברשימה,
       * כלומר מסיים בשקט טיפול שהמשתמש עצמו אישר (ביקורת Codex).
       */
      for (const row of others) {
        await apiDelete(`/auth/sessions/${row.id}`);
      }
      ref.current?.close();
      setOthers(null);
    } catch {
      setError("הניתוק נכשל — נסו שוב");
      setBusy(false);
    }
  }

  async function leave(): Promise<void> {
    setBusy(true);
    setError(null);
    clearSessionCache();
    resetA11ySync();
    /* גם אם הקריאה נכשלת — עוזבים: המסך המחובר הוא מה שסוגרים */
    await apiPost("/auth/logout", {}).catch(() => undefined);
    window.location.assign("/login");
  }

  if (others === null) return null;

  return (
    <dialog
      ref={ref}
      className="mv-net-dialog"
      aria-labelledby="single-session-title"
      /* אין סגירה בלי בחירה — Escape מנוטרל, ואין כפתור X */
      onCancel={(event) => event.preventDefault()}
    >
      <div className="mv-net-dialog-body">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="mv-agent-badge" aria-hidden="true" style={{ width: 40, height: 40 }}>
            <IconShield s={19} />
          </span>
          <h2 id="single-session-title" className="m-0 text-[length:calc(18/16*1rem)] font-extrabold">
            זוהה חיבור נוסף לחשבון
          </h2>
        </div>
        <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
          החשבון שלכם מחובר כרגע גם ממקום אחר. מטעמי אבטחה אפשר להישאר מחוברים
          רק ממכשיר אחד — בחרו איפה להמשיך.
        </p>

        <ul className="m-0 mb-3 list-none p-0">
          {others.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            >
              <span className="text-[length:var(--type-body-sm)] font-semibold">{describeDevice(row.userAgent)}</span>
              <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                התחברות: {formatDateTime(row.createdAt)}
                {row.ipAddress !== null ? (
                  <>
                    {" · "}
                    <span dir="ltr">{row.ipAddress}</span>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {error !== null ? <Notice tone="danger">{error}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="mv-btn-action" disabled={busy} onClick={() => void stayHere()}>
            {busy ? "מנתק…" : "השאר אותי כאן — נתק את החיבור האחר"}
          </button>
          <button
            type="button"
            className="mv-btn-plain"
            disabled={busy}
            onClick={() => void leave()}
            style={{ color: "var(--color-danger)" }}
          >
            צא מהמכשיר הזה
          </button>
        </div>
      </div>
    </dialog>
  );
}
