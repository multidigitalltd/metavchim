"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  SUPPORT_KINDS,
  SUPPORT_KIND_LABEL,
  supportAreaFromPath,
  type SupportKind,
} from "@metavchim/shared";
import { API_BASE, ApiError, apiPost } from "@/lib/api";
import { collectDiagnostics, recordScreen, startDiagnostics } from "@/lib/client-diagnostics";
import { canCaptureScreen, captureScreen } from "@/lib/screen-capture";
import { DictationControls } from "./dictation-field";
import { IconChat, IconX } from "./icons";

/**
 * כפתור התמיכה — בצד, בכל מסך.
 *
 * שלושה עקרונות עיצבו אותו:
 *
 * 1. **פנייה בלחיצה אחת מהמקום שבו נתקעת.** דף "צור קשר" נפרד דורש
 *    לצאת מהמסך, לתאר מהזיכרון, ובדרך לוותר. הכפתור נשאר במקומו בכל
 *    מסך, והפנייה נושאת איתה את המסך שממנו נשלחה.
 * 2. **הראיות נאספות לבד.** המשתמש לא מתבקש לבחור מודול, לדעת מה
 *    קרה או להעתיק שגיאה; המסך, השגיאות והבקשות שנכשלו מצורפים
 *    אוטומטית — ומוצגים לו לפני השליחה, כי צירוף שקט הוא איסוף.
 * 3. **מדברים במקום להקליד.** אותו מיקרופון של כל שדה טקסט במערכת;
 *    מי שמתאר תקלה בקול מתאר אותה טוב יותר ממי שמקליד בטלפון.
 */

interface Sent {
  id: string;
  withScreenshot: boolean;
}

export function SupportButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SupportKind>("bug");
  const [text, setText] = useState("");
  /** בסיס ההכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");
  const [withShot, setWithShot] = useState(true);
  const [upload, setUpload] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "capture" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startDiagnostics();
  }, []);
  useEffect(() => {
    recordScreen(pathname);
  }, [pathname]);

  // Esc סוגר — חלון שנפתח בטעות לא אמור לדרוש חיפוש כפתור סגירה
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const diagnostics = collectDiagnostics();
  const area = supportAreaFromPath(pathname);

  function reset(): void {
    setText("");
    setBase("");
    setUpload(null);
    setError(null);
    setSent(null);
    setKind("bug");
    setWithShot(true);
  }

  async function send(): Promise<void> {
    const message = text.trim();
    if (message.length < 5) {
      setError("כתבו או הקליטו משפט אחד לפחות");
      return;
    }
    setError(null);

    /*
     * הצילום **לפני** יצירת הפנייה, והחלון מוסתר בזמן הצילום — אחרת
     * מה שהתמיכה מקבלת הוא תמונה של טופס הפנייה במקום של התקלה.
     * כישלון או ביטול כאן אינם עוצרים כלום: הפנייה נשלחת בלעדיו.
     */
    let shot: Blob | null = null;
    if (upload !== null) {
      shot = upload;
    } else if (withShot && canCaptureScreen()) {
      setBusy("capture");
      const panel = panelRef.current;
      if (panel) panel.style.visibility = "hidden";
      try {
        shot = await captureScreen();
      } finally {
        if (panel) panel.style.visibility = "";
      }
    }

    setBusy("send");
    try {
      const created = await apiPost<{ id: string }>("/support/tickets", {
        kind,
        message,
        context: {
          path: pathname,
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          userAgent: navigator.userAgent,
          ...diagnostics,
        },
      });
      let attached = false;
      if (shot !== null) {
        /*
         * הצילום בבקשה נפרדת, ו**כישלון שלו אינו כישלון הפנייה**:
         * הפנייה כבר נשמרה, וזריקת שגיאה כאן הייתה גורמת למשתמש
         * לשלוח שוב ולייצר כפילות בתור התמיכה.
         */
        try {
          const form = new FormData();
          form.append("file", shot, "screen.jpg");
          const res = await fetch(`${API_BASE}/support/tickets/${created.id}/screenshot`, {
            method: "POST",
            credentials: "include",
            body: form,
          });
          attached = res.ok;
        } catch {
          attached = false;
        }
      }
      setSent({ id: created.id, withScreenshot: attached });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת הפנייה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/*
        לשונית בקצה השמאלי ובאמצע הגובה. לא בפינה התחתונה — שם כבר
        יושב פס הסופטפון, ושני כפתורים צפים באותה פינה נלחמים זה בזה
        במסך צר.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mv-support-tab"
        aria-haspopup="dialog"
        title="דיווח תקלה או הצעה לשיפור"
      >
        <IconChat s={16} />
        <span>תמיכה</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-panel-heading"
          className="mv-support-panel"
        >
          <div className="flex items-center gap-2">
            <h2 id="support-panel-heading" className="m-0 grow" style={{ fontSize: 17, fontWeight: 800 }}>
              פנייה לתמיכה
            </h2>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (sent !== null) reset();
              }}
              className="mv-btn-plain"
              aria-label="סגירה"
            >
              <IconX s={14} />
            </button>
          </div>

          {sent !== null ? (
            <div className="mt-3">
              <p className="m-0 font-semibold">הפנייה נשלחה.</p>
              <p className="m-0 mt-1 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
                {sent.withScreenshot
                  ? "צורף גם צילום המסך."
                  : "בלי צילום מסך — הפנייה נשלחה עם פרטי המסך והשגיאות."}{" "}
                אפשר לעקוב אחריה תחת ניהול המשרד ← פניות לתמיכה.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="mv-btn-action" onClick={reset}>
                  פנייה נוספת
                </button>
                <button type="button" className="mv-btn-plain" onClick={() => { setOpen(false); reset(); }}>
                  סגירה
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SUPPORT_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="mv-chip"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {SUPPORT_KIND_LABEL[k]}
                  </button>
                ))}
              </div>

              <div className="mt-2.5 flex items-start gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder={
                    kind === "bug"
                      ? "מה ניסיתם לעשות, ומה קרה במקום?"
                      : "מה היה עוזר לכם? אפשר גם להקליט במקום להקליד."
                  }
                  aria-label="תיאור הפנייה"
                  className="mv-field grow"
                  disabled={busy !== null}
                />
                <DictationControls
                  disabled={busy !== null}
                  onAppend={(spoken) => setText(`${base}${base ? " " : ""}${spoken}`)}
                  onIdle={() => setBase(text)}
                />
              </div>

              {/*
                מה שנשלח, כתוב במפורש. צירוף שקט של הקשר טכני הוא
                איסוף מידע; צירוף שהמשתמש רואה הוא עזרה.
              */}
              <p className="m-0 mt-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                נשלח גם: המסך ({area})
                {diagnostics.failedRequests.length > 0
                  ? ` · ${diagnostics.failedRequests.length} בקשות שנכשלו`
                  : ""}
                {diagnostics.errors.length > 0 ? ` · ${diagnostics.errors.length} שגיאות דפדפן` : ""}{" "}
                · סוג הדפדפן. פרטי לקוחות אינם נשלחים מהכתובות.
              </p>

              {canCaptureScreen() ? (
                <label className="mt-2 flex items-center gap-2 text-[14.5px]">
                  <input
                    type="checkbox"
                    checked={withShot && upload === null}
                    disabled={upload !== null || busy !== null}
                    onChange={(e) => setWithShot(e.target.checked)}
                  />
                  לצרף צילום של המסך הזה (הדפדפן יבקש אישור)
                </label>
              ) : null}

              <label className="mt-1.5 block text-[14.5px]">
                <span style={{ color: "var(--color-text-muted)" }}>
                  {canCaptureScreen() ? "או העלו צילום מהמכשיר:" : "אפשר לצרף צילום מהמכשיר:"}
                </span>{" "}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy !== null}
                  onChange={(e) => setUpload(e.target.files?.[0] ?? null)}
                />
              </label>

              {error !== null ? (
                <p role="alert" className="m-0 mt-2 text-[14.5px]" style={{ color: "var(--color-danger)" }}>
                  {error}
                </p>
              ) : null}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="mv-btn-action"
                  disabled={busy !== null || text.trim().length < 5}
                  onClick={() => void send()}
                >
                  {busy === "capture" ? "מצלם…" : busy === "send" ? "שולח…" : "שליחה לתמיכה"}
                </button>
                <button
                  type="button"
                  className="mv-btn-plain"
                  disabled={busy !== null}
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
