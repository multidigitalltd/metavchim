"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MAX_SUPPORT_MESSAGE } from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { DictationControls } from "./dictation-field";
import { IconStar, IconX } from "./icons";
import { Notice } from "./notice";

/**
 * „את המערכת הזו אתם מפתחים” — כפתור צף לרעיונות ולפידבק.
 *
 * ## למה כפתור נפרד מהתמיכה
 *
 * לשונית התמיכה נקראת „תמיכה”, ומי שקורא אותה מבין: משהו נשבר.
 * רעיון לשיפור אינו תקלה, ומתווך שיש לו רעיון פשוט אינו לוחץ על
 * כפתור שנועד לתלונות. הכפתור הזה מזמין דבר אחר, ולכן הוא נראה
 * אחרת ויושב בפינה אחרת של המסך.
 *
 * ## למה זה בכל זאת אותו צינור
 *
 * מאחורי הקלעים זו פנייה מסוג `idea` — אותה טבלה, אותו מייל לבעל
 * המערכת, אותו מסך טיפול. מסלול שני היה שני מקומות לבדוק בהם
 * הודעות, ורעיונות שנופלים בין הכיסאות. ההבדל הוא בהזמנה, לא
 * בתשתית.
 *
 * ## מה מצורף ומה לא
 *
 * **רק הנתיב שממנו נשלח.** בפניית תקלה נאספות שגיאות, בקשות שנכשלו
 * וצילום מסך — כי בלעדיהם אי אפשר לאבחן. רעיון אינו דורש אבחון,
 * ואיסוף ראיות ממי שרק רצה להציע רעיון הוא איסוף שאין לו סיבה.
 */

/** מינימום שמאפשר להבין רעיון. זהה לסכימת השרת. */
const MIN_MESSAGE = 5;

export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  /** בסיס ההכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* פוקוס לחלון שנפתח — מקלדת וקורא־מסך צריכים להגיע אליו */
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  /* Escape סוגר, כמו בכל חלון צף במערכת */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset(): void {
    setText("");
    setBase("");
    setSent(false);
    setError(null);
  }

  async function send(): Promise<void> {
    const message = text.trim();
    if (message.length < MIN_MESSAGE) {
      setError("כתבו לפחות משפט אחד — מה הרעיון או מה כדאי לשפר.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /*
       * `idea` — אותו נתיב של התמיכה, ולכן הפנייה נשמרת ונשלחת
       * במייל לבעל המערכת בדיוק כמו כל פנייה אחרת.
       */
      await apiPost<{ id: string }>("/support/tickets", {
        kind: "idea",
        message,
        context: { path: pathname },
      });
      setSent(true);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "השליחה נכשלה — נסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="mv-feedback-fab"
        aria-expanded={open}
        aria-controls="feedback-panel"
        onClick={() => setOpen((v) => !v)}
        title="יש לכם רעיון? ספרו לנו"
      >
        <IconStar s={20} />
        <span className="mv-feedback-fab-label">יש לי רעיון</span>
      </button>

      {open ? (
        <div
          id="feedback-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="feedback-heading"
          className="mv-feedback-panel"
        >
          <div className="flex items-start gap-2">
            <h2
              id="feedback-heading"
              className="m-0 grow"
              style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.35 }}
            >
              את המערכת הזו אתם מפתחים
            </h2>
            <button
              ref={closeRef}
              type="button"
              className="mv-btn-plain"
              aria-label="סגירה"
              onClick={() => setOpen(false)}
            >
              <IconX s={16} />
            </button>
          </div>

          {sent ? (
            <div className="mt-3">
              <p className="m-0 font-semibold" role="status">
                ✓ קיבלנו. תודה.
              </p>
              <p
                className="m-0 mt-1 text-[length:var(--type-caption-lg)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                נעבור על מה שכתבתם. אם הרעיון ייושם — נעדכן אתכם ונזכה
                אתכם בקרדיטים.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="mv-btn-action" onClick={reset}>
                  לשלוח עוד רעיון
                </button>
                <button
                  type="button"
                  className="mv-btn-plain"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  סגירה
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="m-0 mt-1.5 text-[length:var(--type-caption-lg)] leading-relaxed">
                אנחנו מחכים לשמוע מכם. רעיונות, פידבק והצעות לשיפור
                וייעול — מי שעובד במערכת כל יום רואה דברים שאנחנו לא.
              </p>
              <p
                className="m-0 mt-2 rounded-lg px-3 py-2 text-[length:var(--type-caption-lg)] font-bold"
                style={{
                  background: "var(--color-primary-soft)",
                  color: "var(--color-primary)",
                }}
              >
                רעיון שייושם במערכת — נזכה אתכם בקרדיטים.
              </p>

              <label
                htmlFor="feedback-text"
                className="mt-3 block text-[length:var(--type-caption-lg)] font-semibold"
              >
                מה הרעיון?
              </label>
              <div className="mt-1 flex items-start gap-2">
                <textarea
                  id="feedback-text"
                  className="mv-field grow"
                  rows={4}
                  value={text}
                  maxLength={MAX_SUPPORT_MESSAGE}
                  placeholder="למשל: בכרטיס הקונה הייתי רוצה לראות את השיחות האחרונות בלי לעבור מסך"
                  onChange={(e) => {
                    setText(e.target.value);
                    setBase(e.target.value);
                  }}
                />
                {/* אותו מיקרופון של כל שדה טקסט — מדברים במקום להקליד */}
                <DictationControls
                  disabled={busy}
                  onAppend={(spoken) =>
                    setText(`${base}${base ? " " : ""}${spoken}`)
                  }
                  onIdle={() => setBase(text)}
                />
              </div>

              {error !== null ? <Notice tone="danger">{error}</Notice> : null}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="mv-btn-action"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? "שולח…" : "שליחה"}
                </button>
                <button
                  type="button"
                  className="mv-btn-plain"
                  onClick={() => setOpen(false)}
                >
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
