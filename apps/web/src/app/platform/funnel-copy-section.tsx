"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { FUNNEL_PLACEHOLDERS, unknownFunnelPlaceholders } from "@metavchim/shared";
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
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
  /** ‏למה אי אפשר להדליק — `null` כשאפשר. השרת מכריע, המסך מציג. */
  enableBlock: string | null;
}

/** ‏מה ממתין לאישור: המפסק הראשי, או שלב אחד. */
type Toggle =
  | { kind: "sending"; enabled: boolean }
  | { kind: "stage"; row: StageCopy; enabled: boolean };

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
  /** ‏המפסק הראשי של המסלול — `null` עד שנטען */
  const [funnelSending, setFunnelSending] = useState<boolean | null>(null);
  const [toggle, setToggle] = useState<Toggle | null>(null);
  const [toggling, setToggling] = useState(false);
  /** ‏שליחת בדיקה: איזה שלב בדרך, ומה יצא מהאחרונה */
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<StageCopy[]>("/platform/funnel-copy")
      .then(setRows)
      .catch(() => setError("טעינת הנוסחים נכשלה"));
    apiGet<{ enabled: boolean }>("/platform/funnel-sending")
      .then(({ enabled }) => setFunnelSending(enabled))
      .catch(() => setError("טעינת מצב המסלול נכשלה"));
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

  async function applyToggle() {
    if (toggle === null) return;
    setToggling(true);
    setError(null);
    try {
      if (toggle.kind === "sending") {
        await apiPatch("/platform/funnel-sending", { enabled: toggle.enabled });
      } else {
        await apiPatch(`/platform/funnel-copy/${toggle.row.id}/enabled`, { enabled: toggle.enabled });
      }
      setToggle(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "השינוי נכשל");
      setToggle(null);
    } finally {
      setToggling(false);
    }
  }

  /*
   * ‏הנוסח **השמור** נשלח — זה מה שייצא ללקוחות. שינוי שעוד לא נשמר
   * ‏אינו נשלח, ולכן הכפתור נעול בזמן עריכה של אותו שלב.
   */
  async function sendTest(id: string) {
    setTesting(id);
    setTested(null);
    try {
      const { sentTo } = await apiPost<{ sentTo: string }>(`/platform/funnel-copy/${id}/test`, {});
      setTested({ id, ok: true, text: `נשלח אל ${sentTo}` });
    } catch (err) {
      setTested({
        id,
        ok: false,
        text: err instanceof ApiError ? err.message : "שליחת הבדיקה נכשלה",
      });
    } finally {
      setTesting(null);
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

      <div className="mv-card mv-card--pad flex flex-wrap items-center gap-3">
        <span className="font-bold">
          המסלול {funnelSending === null ? "…" : funnelSending ? "פעיל" : "כבוי"}
        </span>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {funnelSending
            ? "משרדים בניסיון נכנסים ומקבלים את השלבים הדלוקים, בימים א׳–ו׳ בין 9:00 ל-18:00."
            : "שום דבר לא נשלח ואף משרד לא נכנס, גם כשיש שלבים דלוקים."}
        </span>
        <Button
          className="ms-auto"
          variant={funnelSending ? "secondary" : "primary"}
          disabled={funnelSending === null}
          onClick={() => setToggle({ kind: "sending", enabled: !funnelSending })}
        >
          {funnelSending ? "עצירת המסלול" : "הפעלת המסלול"}
        </Button>
      </div>

      <Notice tone="info">
        מילוי נוסח אינו הדלקה: כל שלב נדלק בנפרד, ויוצא רק כשהמסלול פעיל. „שלח אליי לבדיקה”
        שולח את המייל השמור לתיבה שלך בלבד, עם השם והמשרד שלך במקום מצייני המקום. המייל יוצא
        לבעלי המשרד, עם קישור הסרה. תבניות הוואטסאפ טעונות אישור של מטא ומוגשות מ-WhatsApp
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
                        {row.enabled ? "דלוק" : "כבוי"}
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
                          disabled={!row.enabled && row.enableBlock !== null}
                          title={row.enabled ? undefined : (row.enableBlock ?? undefined)}
                          onClick={() => setToggle({ kind: "stage", row, enabled: !row.enabled })}
                        >
                          {row.enabled ? "כיבוי" : "הדלקה"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={testing !== null || open === row.id}
                          title={
                            open === row.id ? "שמרו קודם — הבדיקה שולחת את הנוסח השמור" : undefined
                          }
                          onClick={() => void sendTest(row.id)}
                        >
                          {testing === row.id ? "שולח…" : "שלח אליי לבדיקה"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => (open === row.id ? setOpen(null) : edit(row))}
                        >
                          {open === row.id ? "סגור" : "עריכה"}
                        </Button>
                      </span>
                    </div>
                    {!row.enabled && row.enableBlock !== null ? (
                      <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        לא ניתן להדליק: {row.enableBlock}
                      </p>
                    ) : null}
                    {tested?.id === row.id ? (
                      <p
                        className="m-0 mt-2 text-sm"
                        role={tested.ok ? "status" : "alert"}
                        style={{
                          color: tested.ok ? "var(--color-success)" : "var(--color-danger)",
                        }}
                      >
                        {tested.text}
                      </p>
                    ) : null}

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

      <ConfirmDialog
        open={toggle !== null}
        title={
          toggle === null
            ? ""
            : toggle.kind === "sending"
              ? toggle.enabled
                ? "להפעיל את מסלול ההמרה?"
                : "לעצור את מסלול ההמרה?"
              : toggle.enabled
                ? `להדליק את „${toggle.row.title}”?`
                : `לכבות את „${toggle.row.title}”?`
        }
        confirmLabel={toggle?.enabled ? "הפעלה" : "עצירה"}
        busy={toggling}
        busyLabel="שומר…"
        onConfirm={() => void applyToggle()}
        onClose={() => setToggle(null)}
      >
        <p className="m-0">
          {toggle === null
            ? null
            : toggle.kind === "sending"
              ? toggle.enabled
                ? "משרדים בניסיון ייכנסו למסלול — נרשמים חדשים מיד, והקיימים עד 25 ביום — ויקבלו במייל את השלבים הדלוקים, הודעה אחת לכל היותר ביום."
                : "לא ייכנסו משרדים חדשים ולא יישלחו הודעות. מה שכבר נשלח נשאר, ואפשר להפעיל שוב בכל רגע."
              : toggle.enabled
                ? `השלב יישלח במייל לבעלי כל משרד במסלול שעונה לתנאי שלו, כשיגיע מועדו.${funnelSending ? "" : " המסלול עצמו כבוי — דבר לא יישלח עד שתפעילו אותו."}`
                : "השלב לא יישלח יותר. מה שכבר נשלח נשאר."}
        </p>
      </ConfirmDialog>
    </section>
  );
}
