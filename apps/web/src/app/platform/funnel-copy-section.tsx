"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { FUNNEL_PLACEHOLDERS, unknownFunnelPlaceholders } from "@metavchim/shared";
import { apiGet, apiPatch } from "@/lib/api";
import { Notice } from "../notice";

/**
 * ‎**נוסחי מסלול ההמרה — נערכים כאן, לא בקובץ SQL.**
 *
 * ## ‏מה המסך הזה עושה, ומה הוא בכוונה לא
 *
 * ‏ארבעה-עשר השלבים נזרעו עם טיוטות. המסך הזה הוא המקום לתקן
 * ‏אותן: נושא, כותרת, גוף וכפתור.
 *
 * ‎**אין כאן מתג הפעלה.** הדלקת שלב שולחת לכל המשרדים במאגר, וזו
 * ‏אינה החלטה שצריכה לחלוק כפתור שמירה עם „תיקנתי פסיק”. גם
 * ‏התזמון והקהל אינם כאן — הם קובעים למי ההודעה יוצאת.
 *
 * ## ‏מצייני המקום
 *
 * ‏מי שעורך כאן אינו רואה את מנוע ההחלפה, ו-`{{שם_הסוכן}}` נשמע
 * ‏סביר לגמרי. מציין מקום שאיש אינו מחליף **יוצא ללקוח בסוגריים**.
 * ‏לכן הרשימה סגורה, החריגה מסומנת תוך כדי הקלדה, והשרת דוחה
 * ‏שמירה שמכילה אותה — המסך מזהיר, השרת אוכף.
 */

interface StageCopy {
  id: string;
  track: string;
  key: string;
  title: string;
  enabled: boolean;
  emailSubject: string;
  emailHeading: string;
  emailBody: string;
  ctaLabel: string;
  ctaPath: string;
  whatsappTemplate: string;
  unknownPlaceholders: string[];
}

const TRACK_LABELS: Record<string, string> = {
  conversion: "מסלול ההמרה — מניסיון ללקוח משלם",
  dunning: "גבייה — כשהחיוב לא עבר",
};

/** ‏מה שנערך בפועל. שאר השדות בשורה הם לקריאה. */
type Draft = Pick<
  StageCopy,
  "emailSubject" | "emailHeading" | "emailBody" | "ctaLabel" | "ctaPath"
>;

function draftOf(row: StageCopy): Draft {
  return {
    emailSubject: row.emailSubject,
    emailHeading: row.emailHeading,
    emailBody: row.emailBody,
    ctaLabel: row.ctaLabel,
    ctaPath: row.ctaPath,
  };
}

export function FunnelCopySection() {
  const [rows, setRows] = useState<StageCopy[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<StageCopy[]>("/platform/funnel-copy")
      .then(setRows)
      .catch(() => setError("טעינת הנוסחים נכשלה"));
  }, []);

  useEffect(load, [load]);

  function edit(row: StageCopy) {
    setOpen(row.id);
    setDraft(draftOf(row));
    setSaved(null);
    setError(null);
  }

  async function save(id: string) {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/platform/funnel-copy/${id}`, draft);
      setSaved(id);
      setOpen(null);
      setDraft(null);
      load();
    } catch {
      setError("השמירה נכשלה — ייתכן שיש מציין מקום שאינו מוכר");
    } finally {
      setSaving(false);
    }
  }

  /* ‏אזהרה חיה על מה שנכתב עכשיו, לפני שהשרת דוחה */
  const draftUnknown =
    draft === null
      ? []
      : unknownFunnelPlaceholders(
          [draft.emailSubject, draft.emailHeading, draft.emailBody, draft.ctaLabel].join("\n"),
        );

  const tracks = [...new Set((rows ?? []).map((row) => row.track))];

  return (
    <section className="mt-8" aria-labelledby="funnel-copy-heading">
      <div className="mv-card-head mb-3">
        <h2 id="funnel-copy-heading" className="mv-card-head__title m-0">
          נוסחי מסלול ההמרה
        </h2>
      </div>

      <Notice tone="info">
        ארבעה-עשר השלבים יושבים כאן עם טיוטות. <strong>כולם כבויים</strong> — מילוי נוסח אינו
        הדלקה, וההפעלה היא החלטה נפרדת. תבניות הוואטסאפ טעונות אישור של מטא ומוגשות מ-WhatsApp
        Manager.
      </Notice>

      <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מצייני המקום המוכרים:{" "}
        {FUNNEL_PLACEHOLDERS.map((name) => `{{${name}}}`).join(" · ")} — כל אחר יישלח ללקוח
        בסוגריים כמו שהוא.
      </p>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      {rows === null ? (
        <p className="mt-3">טוען…</p>
      ) : (
        tracks.map((track) => (
          <div key={track} className="mt-5">
            <h3 className="mb-2 text-[length:var(--type-body)] font-bold">
              {TRACK_LABELS[track] ?? track}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {rows
                .filter((row) => row.track === track)
                .map((row) => (
                  <li key={row.id} className="mv-card mv-card--pad">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{row.title}</span>
                      <span className="mv-chip" style={{ cursor: "default" }}>
                        {row.enabled ? "פעיל" : "כבוי"}
                      </span>
                      {row.whatsappTemplate === "" ? (
                        <span className="mv-chip" style={{ cursor: "default" }}>
                          אין תבנית וואטסאפ
                        </span>
                      ) : null}
                      {row.unknownPlaceholders.length > 0 ? (
                        <span className="mv-chip" style={{ cursor: "default" }}>
                          מציין מקום לא מוכר
                        </span>
                      ) : null}
                      <span className="ms-auto flex gap-2">
                        {saved === row.id ? (
                          <span
                            className="text-sm"
                            style={{ color: "var(--color-success)" }}
                            role="status"
                          >
                            נשמר
                          </span>
                        ) : null}
                        <Button
                          variant="secondary"
                          onClick={() => (open === row.id ? setOpen(null) : edit(row))}
                        >
                          {open === row.id ? "סגור" : "עריכה"}
                        </Button>
                      </span>
                    </div>

                    {open === row.id && draft !== null ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <label className="flex flex-col gap-1 text-sm">
                          <span style={{ color: "var(--color-text-muted)" }}>נושא המייל</span>
                          <input
                            className="mv-input"
                            value={draft.emailSubject}
                            maxLength={200}
                            onChange={(e) => setDraft({ ...draft, emailSubject: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span style={{ color: "var(--color-text-muted)" }}>כותרת בגוף</span>
                          <input
                            className="mv-input"
                            value={draft.emailHeading}
                            maxLength={200}
                            onChange={(e) => setDraft({ ...draft, emailHeading: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span style={{ color: "var(--color-text-muted)" }}>
                            גוף ההודעה — פסקאות מופרדות בשורה ריקה
                          </span>
                          <textarea
                            className="mv-input"
                            rows={12}
                            value={draft.emailBody}
                            maxLength={8000}
                            onChange={(e) => setDraft({ ...draft, emailBody: e.target.value })}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <label className="flex flex-1 flex-col gap-1 text-sm">
                            <span style={{ color: "var(--color-text-muted)" }}>
                              מה כתוב על הכפתור
                            </span>
                            <input
                              className="mv-input"
                              value={draft.ctaLabel}
                              maxLength={60}
                              onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })}
                            />
                          </label>
                          <label className="flex flex-1 flex-col gap-1 text-sm">
                            <span style={{ color: "var(--color-text-muted)" }}>
                              לאן הוא מוביל — נתיב יחסי, למשל ‎/properties/new
                            </span>
                            <input
                              className="mv-input"
                              value={draft.ctaPath}
                              maxLength={200}
                              onChange={(e) => setDraft({ ...draft, ctaPath: e.target.value })}
                            />
                          </label>
                        </div>

                        {draftUnknown.length > 0 ? (
                          <Notice tone="warning">
                            מצייני מקום שאיש לא יחליף, וייצאו ללקוח בסוגריים:{" "}
                            {draftUnknown.map((name) => `{{${name}}}`).join(", ")}
                          </Notice>
                        ) : null}

                        <span className="flex gap-2">
                          <Button
                            onClick={() => void save(row.id)}
                            disabled={saving || draftUnknown.length > 0}
                          >
                            {saving ? "שומר…" : "שמירה"}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setOpen(null);
                              setDraft(null);
                            }}
                          >
                            ביטול
                          </Button>
                        </span>
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
