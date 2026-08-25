"use client";

import { useCallback, useEffect, useState } from "react";
import { INTAKE_STATUS_LABEL, type IntakeStatus } from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { ConfirmDialog } from "./confirm-dialog";
import { IconLink, IconSend, IconX } from "./icons";
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IntakeRow | null>(null);
  const clipboard = useCopy();

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<IntakeRow[]>(`/${base}/${entityId}/intake`));
      setLoadFailed(false);
    } catch {
      // נשאר `null` — „לא ידוע”, ולא „לא נשלח דבר”
      setLoadFailed(true);
    }
  }, [base, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * יצירה ופתיחת וואטסאפ באותה לחיצה.
   *
   * `window.open` נקרא **אחרי** ה-await, ולכן דפדפנים עשויים לחסום
   * אותו כחלון קופץ. זו הסיבה שהקישור מוצג גם ככפתור רגיל למטה:
   * לחיצה שנחסמה משאירה את המתווך עם קישור לחוץ ולא עם כלום.
   */
  async function create(open: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const row = await apiPost<IntakeRow>(`/${base}/${entityId}/intake`, {});
      await load();
      if (open && row.waUrl !== null) {
        window.open(row.waUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "יצירת הקישור נכשלה — נסו שוב.",
      );
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
    <section
      className="mv-list-card px-[22px] py-[18px]"
      aria-labelledby="intake-heading"
    >
      <h2 id="intake-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
        הלקוח ממלא בעצמו
      </h2>
      <p
        className="m-0 mt-1 text-[length:var(--type-caption-lg)] leading-relaxed"
        style={{ color: "var(--color-text-muted)" }}
      >
        שלחו ללקוח קישור לטופס קצר — מה הוא מחפש, באיזה אזור ובאיזה
        תקציב. מה שהוא ימלא ייכנס לכרטיס.
      </p>

      {error !== null && revoking === null ? (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
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
                onClick={() => void create(true)}
              >
                <IconSend s={16} />{" "}
                {active === undefined ? "בקשו מהלקוח למלא" : "שליחה שוב בוואטסאפ"}
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
