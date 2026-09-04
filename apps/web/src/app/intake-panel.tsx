"use client";

import { useCallback, useEffect, useState } from "react";
import { INTAKE_STATUS_LABEL, type IntakeStatus } from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { ConfirmDialog } from "./confirm-dialog";
import { IconChat, IconLink, IconMail, IconSend, IconX } from "./icons";
import { LoadError } from "./load-error";
import { Notice } from "./notice";

/**
 * „בקשו מהלקוח למלא” — הקישור לטופס הדרישות.
 *
 * ## מה זה חוסך
 *
 * את ההקלדה. הדרישות נאספות היום בשיחה, והמתווך מקליד תוך כדי; מה
 * שנופל בין הכיסאות נופל שם לתמיד. הלקוח ממלא כשנוח לו, יודע את
 * התשובות טוב יותר, והתשובות נכנסות לכרטיס.
 *
 * ## למה הכפתור נראה כמו „שליחה” ולא כמו „יצירת קישור”
 *
 * המתווך אינו רוצה קישור, הוא רוצה שהלקוח ימלא. לכן הלחיצה יוצרת
 * ופותחת את וואטסאפ עם הנוסח מוכן במגע אחד — והעתקת הקישור נשארת
 * כאפשרות למי שרוצה לשלוח בדרך אחרת.
 *
 * ## ‏שני ערוצים, ושניהם אינם אותו דבר
 *
 * ‏עד כה היה ערוץ אחד: וואטסאפ. ללקוח בלי וואטסאפ — או למי שמעדיף
 * מייל — לא הייתה דרך, והמתווך היה אמור להעתיק את הקישור ולהדביק
 * אותו במייל משלו (בקשת המשתמש).
 *
 * ‎**הם עובדים אחרת, והמסך אומר זאת.** וואטסאפ **נפתח** בדפדפן עם
 * הנוסח מוכן, והמתווך לוחץ „שלח” — כך זה עובד היום, וזה מה שעובד
 * תמיד. אימייל **נשלח** מהשרת בפועל, ולכן ורק לכן הוא עובר דרך
 * „אתם בטוחים?”: פעולה שיוצאת אל לקוח אמיתי ברגע הלחיצה, ואי
 * אפשר לקחת אותה בחזרה.
 *
 * ## ‏למה וואטסאפ נפתח **לפני** ששולחים את המייל
 *
 * ‎`window.open` שנקרא אחרי `await` נחסם בדפדפנים כחלון קופץ. שתי
 * המתנות ברצף היו הופכות את הסיכוי לחסימה לוודאות, ולכן הפתיחה
 * יושבת מיד אחרי יצירת הקישור — בדיוק במקום שבו היא הייתה קודם.
 * ואם היא בכל זאת נחסמה, זה נאמר: הקישור מוצג למטה להעתקה.
 */

interface IntakeRow {
  id: string;
  url: string;
  status: IntakeStatus;
  channel: string;
  expiresAt: string;
  openedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  waUrl: string | null;
}

/** ‏מי יקבל — ראו `IntakeListDto` בשרת. */
interface Recipient {
  name: string;
  email: string | null;
}

interface IntakeList {
  recipient: Recipient;
  rows: IntakeRow[];
}

const STATUS_COLOR: Record<IntakeStatus, string> = {
  sent: "var(--color-text-muted)",
  opened: "#8a6414",
  submitted: "var(--color-primary)",
  revoked: "var(--color-text-muted)",
};

export function IntakePanel({
  subject,
  entityId,
  canEdit,
}: {
  subject: "lead" | "buyer";
  entityId: string;
  canEdit: boolean;
}) {
  const base = subject === "lead" ? "leads" : "buyers";
  const [rows, setRows] = useState<IntakeRow[] | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IntakeRow | null>(null);
  /* ‏החלון פתוח · מה סומן · והאם עברנו לשלב „אתם בטוחים?” */
  const [picking, setPicking] = useState(false);
  const [viaWa, setViaWa] = useState(true);
  const [viaEmail, setViaEmail] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const clipboard = useCopy();

  const load = useCallback(async () => {
    try {
      const list = await apiGet<IntakeList>(`/${base}/${entityId}/intake`);
      setRows(list.rows);
      setRecipient(list.recipient);
      setLoadFailed(false);
    } catch {
      // נשאר `null` — „לא ידוע”, ולא „לא נשלח דבר”
      setLoadFailed(true);
    }
  }, [base, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clientEmail = recipient?.email ?? null;

  /** ‏פותח את החלון במצב נקי — בלי הודעה או שגיאה מהפעם הקודמת. */
  function openPicker(): void {
    setViaWa(true);
    setViaEmail(false);
    setConfirmEmail(false);
    setError(null);
    setSent(null);
    setPicking(true);
  }

  /**
   * ‏השליחה בפועל.
   *
   * ‏הסדר אינו מקרי: יצירת הקישור, מיד אחריה פתיחת וואטסאפ, ורק אז
   * המייל. ‏`window.open` אחרי שתי המתנות נחסם כמעט תמיד — ראו
   * ההסבר בראש הקובץ.
   *
   * ‏המייל **אינו** נבלע: אם הוא נכשל, זו שגיאה על המסך ולא „נשלח”.
   * הקישור כבר נוצר, וזה בסדר — ‏`ensure` מחזירה את אותו קישור
   * בניסיון הבא ולא יוצרת שני טפסים.
   */
  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    const notes: string[] = [];
    try {
      const row = await apiPost<IntakeRow>(`/${base}/${entityId}/intake`, {});

      if (viaWa) {
        if (row.waUrl === null) {
          notes.push("אין טלפון בכרטיס — וואטסאפ לא נפתח");
        } else {
          const win = window.open(row.waUrl, "_blank", "noopener,noreferrer");
          notes.push(
            win === null
              ? "הדפדפן חסם את פתיחת וואטסאפ — אפשר להעתיק את הקישור למטה"
              : "וואטסאפ נפתח עם ההודעה מוכנה",
          );
        }
      }

      if (viaEmail) {
        const result = await apiPost<{ channel: string; to: string; url: string }>(
          `/${base}/${entityId}/intake/send`,
          { channel: "email" },
        );
        notes.push(`המייל נשלח אל ${result.to}`);
      }

      await load();
      setSent(notes.join(" · "));
      setPicking(false);
      setConfirmEmail(false);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "השליחה נכשלה — נסו שוב.",
      );
      setConfirmEmail(false);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: IntakeRow): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/intake/${row.id}`);
      await load();
      setRevoking(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל — נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  const active = (rows ?? []).find(
    (row) => row.status !== "revoked" && new Date(row.expiresAt) > new Date(),
  );

  return (
    <section className="mv-card mv-card--pad" aria-labelledby="intake-heading">
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-violet" aria-hidden="true">
          <IconSend s={20} />
        </span>
        <h2 id="intake-heading" className="mv-card-head__title">
          הלקוח ממלא בעצמו
        </h2>
      </div>
      <p
        className="m-0 text-[length:var(--type-caption-lg)] leading-relaxed"
        style={{ color: "var(--color-text-muted)" }}
      >
        שלחו ללקוח קישור לטופס קצר — מה הוא מחפש, באיזה אזור ובאיזה
        תקציב. מה שהוא ימלא ייכנס לכרטיס.
      </p>

      {error !== null && revoking === null && !picking ? (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      {sent !== null ? (
        <Notice tone="success" onClose={() => setSent(null)}>
          {sent}
        </Notice>
      ) : null}

      {loadFailed ? (
        <div className="mt-4">
          <LoadError onRetry={() => void load()} />
        </div>
      ) : rows === null ? (
        <p className="mt-4" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : (
        <>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="mv-btn-action"
                disabled={busy}
                onClick={openPicker}
              >
                <IconSend s={16} />{" "}
                {active === undefined ? "בקשו מהלקוח למלא" : "שליחה שוב"}
              </button>
              {active !== undefined ? (
                <button
                  type="button"
                  className="mv-btn-plain"
                  onClick={() => void clipboard.copy(active.url)}
                >
                  <IconLink s={15} />{" "}
                  {clipboard.state === "copied"
                    ? "✓ הקישור הועתק"
                    : clipboard.state === "failed"
                      ? "העתיקו ידנית מהשורה למטה"
                      : "העתקת הקישור"}
                </button>
              ) : null}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <p
              className="m-0 mt-4 rounded-xl border p-4 text-[length:var(--type-body-sm)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-field)",
                color: "var(--color-text-muted)",
              }}
            >
              עדיין לא נשלחה בקשה ללקוח הזה.
            </p>
          ) : (
            <ul className="m-0 mt-4 list-none space-y-2 p-0">
              {rows.map((row) => {
                const expired =
                  row.status !== "revoked" && new Date(row.expiresAt) <= new Date();
                return (
                  <li
                    key={row.id}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-surface)",
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="font-bold"
                        style={{ color: STATUS_COLOR[row.status] }}
                      >
                        {expired ? "הקישור פג תוקף" : INTAKE_STATUS_LABEL[row.status]}
                      </span>
                      {row.channel === "missed_call" ? (
                        <span
                          className="mv-tag"
                          style={{
                            background: "var(--color-field)",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          נשלח אוטומטית אחרי שיחה שלא נענתה
                        </span>
                      ) : null}
                      <span className="grow" />
                      {canEdit && row.status !== "revoked" && !expired ? (
                        <button
                          type="button"
                          className="mv-btn-plain"
                          aria-label="ביטול הקישור"
                          onClick={() => setRevoking(row)}
                        >
                          <IconX s={14} />
                        </button>
                      ) : null}
                    </div>
                    <p
                      className="m-0 mt-1 text-[length:var(--type-caption)]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      נוצר {formatDateTime(row.createdAt)}
                      {row.submittedAt !== null
                        ? ` · מולא ${formatDateTime(row.submittedAt)}`
                        : row.openedAt !== null
                          ? ` · נפתח ${formatDateTime(row.openedAt)}`
                          : ""}
                    </p>
                    {row.status !== "revoked" && !expired ? (
                      <p className="m-0 mt-1 break-all text-[length:var(--type-caption)]" dir="ltr">
                        {row.url}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/*
        ‏חלון אחד בשני שלבים ולא שניים: „אתם בטוחים?” הוא המשך של
        אותה החלטה, וחלון שנסגר ונפתח מאבד את מה שסומן בו רגע לפני.
      */}
      <ConfirmDialog
        open={picking}
        title={confirmEmail ? "אישור שליחה במייל" : "שליחת הטופס ללקוח"}
        confirmLabel={
          confirmEmail ? "כן, לשלוח" : viaEmail ? "המשך" : "שליחה"
        }
        cancelLabel={confirmEmail ? "חזרה" : "ביטול"}
        busy={busy}
        confirmDisabled={!viaWa && !viaEmail}
        onConfirm={
          confirmEmail || !viaEmail
            ? () => void send()
            : () => setConfirmEmail(true)
        }
        onClose={() => {
          if (confirmEmail) {
            /* „חזרה” מהאישור חוזרת לבחירה, ואינה סוגרת את החלון */
            setConfirmEmail(false);
            return;
          }
          setPicking(false);
        }}
      >
        {confirmEmail ? (
          <>
            <p className="m-0">
              המייל יישלח עכשיו אל{" "}
              <span dir="ltr" className="font-bold">
                {clientEmail}
              </span>
              , בשם המשרד. אי אפשר לבטל מייל שיצא.
            </p>
            {viaWa ? (
              <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                וגם וואטסאפ ייפתח עם ההודעה מוכנה.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
              אפשר לסמן את שניהם.
            </p>
            <div className="mv-choices">
              <button
                type="button"
                className="mv-choice mv-choice--check"
                aria-pressed={viaWa}
                onClick={() => setViaWa((on) => !on)}
              >
                <span className="mv-choice__mark" aria-hidden="true" />
                <span className="mv-choice__text">
                  <span className="mv-choice__title">
                    <IconChat s={14} /> וואטסאפ
                  </span>
                  <span className="mv-choice__note">
                    וואטסאפ ייפתח עם ההודעה מוכנה, ואתם לוחצים „שלח”.
                  </span>
                </span>
              </button>

              {/*
                ‏„אין מייל ללקוח” נאמר **לפני** הלחיצה ולא כשגיאה
                אחריה: כפתור שנראה זמין ונכשל תמיד הוא כפתור שמשקר
                (בקשת המשתמש).
              */}
              <button
                type="button"
                className="mv-choice mv-choice--check"
                aria-pressed={viaEmail}
                disabled={clientEmail === null}
                onClick={() => setViaEmail((on) => !on)}
              >
                <span className="mv-choice__mark" aria-hidden="true" />
                <span className="mv-choice__text">
                  <span className="mv-choice__title">
                    <IconMail s={14} /> אימייל
                  </span>
                  <span className="mv-choice__note">
                    {clientEmail === null ? (
                      "אין מייל ללקוח — אפשר להוסיף אותו בכרטיס ולשלוח שוב"
                    ) : (
                      <>
                        נשלח מהמערכת אל <span dir="ltr">{clientEmail}</span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            </div>
          </>
        )}
        {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={revoking !== null}
        title="ביטול הקישור"
        tone="danger"
        confirmLabel="ביטול הקישור"
        cancelLabel="השאירו פעיל"
        busy={busy}
        onConfirm={revoking === null ? undefined : () => void revoke(revoking)}
        onClose={() => setRevoking(null)}
      >
        <p className="m-0">
          הקישור יפסיק לעבוד מיידית. לקוח שיפתח אותו יראה שהקישור בוטל,
          ומה שכבר מילא נשאר בכרטיס.
        </p>
        {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}
