"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import { WithDictation } from "./dictation-field";

/**
 * הערות חופשיות על כרטיס — **מה שהשדות המובנים לא יכולים להכיל.**
 *
 * טופס הקליטה שואל את מה שהמנוע יודע לעבוד לפיו: עיר, תקציב, חדרים,
 * מאפיינים. מה שנאמר בשיחה ואינו נכנס לאף שדה — "האישה מחליטה",
 * "צריך לצאת מהשכירות עד מרץ", "הבן לומד בתלמוד תורה ברחוב הזה" —
 * הוא לרוב מה שיסגור או יפיל את העסקה, והוא נשאר בראש של הסוכן.
 *
 * ## למה זה לא "עוד שדה"
 *
 * הערה חופשית היא **הקשר**, ולכן היא נשמרת בנפרד מהדרישות ואינה
 * משתתפת בניקוד: היא לא תיהפך בשקט לקריטריון שהמערכת מסננת לפיו.
 * במסך היא נקראת כמו שנכתבה — `whitespace-pre-wrap`, בלי לקצץ
 * שורות ובלי לסדר מחדש.
 *
 * הרכיב משותף לכרטיס הקונה ולכרטיס הנכס. הם נבדלים רק בשם השדה
 * במסד (`agentNotes` מול `internalNotes`), וזו אינה סיבה לשני
 * מימושים שיתפצלו.
 */
export function EntityNotes({
  value,
  onSave,
  /** מזהה ייחודי במסך — שני כרטיסים באותו עמוד לא יתנגשו. */
  fieldId = "entity-notes",
  title = "הערות",
  empty = "אין הערות עדיין.",
  canEdit = true,
}: {
  value: string | undefined;
  onSave: (next: string) => Promise<void>;
  fieldId?: string;
  title?: string;
  empty?: string;
  /**
   * `false` = צפייה בלבד: ההערות נקראות, ואין כפתור עריכה.
   *
   * לא קישוט. ה-`PATCH` דורש הרשאת עריכה, ולכן משתמש בצפייה בלבד
   * שראה "הוסף הערות" היה מקליד פסקה שלמה ומקבל 403 — כלומר הטקסט
   * שלו הולך לאיבוד בדיוק ברכיב שנועד לשמור אותו. עדיף שהכפתור לא
   * יהיה שם מלכתחילה (ביקורת Codex).
   *
   * ההגנה עצמה בשרת; זה מונע את המבוי הסתום במסך.
   */
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setDraft(null);
      setSaved(true);
    } catch {
      /*
       * כישלון שמירה **אינו** סוגר את העריכה. סגירה הייתה מוחקת מהמסך
       * טקסט שהסוכן הרגע הקליד ולא נשמר בשום מקום — בדיוק ההפך ממה
       * שהערה נועדה לה.
       */
      setError("שמירת ההערות נכשלה — הטקסט נשמר כאן, אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  }

  const headingId = `${fieldId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="mv-list-card px-[22px] py-[18px]"
    >
      <h2
        id={headingId}
        className="m-0 mb-3"
        style={{ fontSize: 16.5, fontWeight: 800 }}
      >
        {title}
      </h2>

      {draft === null ? (
        <>
          <p className="mb-3 mt-0 whitespace-pre-wrap">
            {value?.trim() ? (
              value
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>
                {canEdit ? empty : "אין הערות."}
              </span>
            )}
          </p>
          {!canEdit ? null : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => {
                  setSaved(false);
                  setDraft(value ?? "");
                }}
              >
                {value?.trim() ? "ערוך הערות" : "הוסף הערות"}
              </button>
              {saved ? (
                <span role="status" style={{ color: "var(--color-primary)" }}>
                  ✓ נשמר
                </span>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
          <label htmlFor={fieldId} className="mv-visually-hidden">
            {title}
          </label>
          <WithDictation value={draft} onChange={setDraft}>
            <textarea
              id={fieldId}
              rows={4}
              maxLength={4000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mb-2 w-full rounded-lg border px-3 py-2.5"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-field)",
                color: "var(--color-text)",
              }}
            />
          </WithDictation>
          {error ? (
            <p
              role="alert"
              className="m-0 mb-2 text-sm"
              style={{ color: "var(--color-danger)" }}
            >
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex gap-3">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "שומר…" : "שמור הערות"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              ביטול
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
