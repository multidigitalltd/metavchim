"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INTAKE_STATUS_LABEL, type IntakeStatus } from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { IconLink, IconSend, IconX } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * „קישור ללקוח שעדיין לא אצלנו”.
 *
 * ## מה זה פותר
 *
 * `IntakePanel` יושבת **בתוך** כרטיס, ולכן היא מניחה שיש כרטיס. מי
 * שפגש לקוח ברחוב, או ענה לשיחה ורוצה לשלוח טופס לפני שהוא מקליד
 * משהו, לא יכול היה להשתמש בה: היה עליו לפתוח קודם כרטיס ידני —
 * כלומר להקליד שם וטלפון בזמן שהלקוח על הקו, שזו בדיוק ההקלדה
 * שהתכונה נועדה להעביר ללקוח.
 *
 * הקישור כאן נוצר **בלי כרטיס**, והכרטיס נוצר מהפרטים שהלקוח ימלא.
 *
 * ## למה כאן ולא בכרטיס
 *
 * זה המסך שבו שואלים „מי הקונים שלי”, וקישור שממתין למילוי הוא
 * קונה בדרך. מסך נפרד היה מקום שאיש לא היה נכנס אליו כדי לבדוק אם
 * מישהו מילא.
 *
 * ## מה אין כאן
 *
 * `waUrl` — כי אין למי לשלוח. המספר של הלקוח יתברר רק כשימלא, ולכן
 * הפעולה היא העתקה: המתווך מדביק בשיחה שכבר פתוחה מולו.
 */

interface OpenRow {
  id: string;
  url: string;
  status: IntakeStatus;
  expiresAt: string;
  submittedAt: string | null;
  createdAt: string;
  /** הכרטיס שנוצר, או `null` כשעוד לא מילאו */
  buyerId: string | null;
}

const STATUS_COLOR: Record<IntakeStatus, string> = {
  sent: "var(--color-text-muted)",
  opened: "#8a6414",
  submitted: "var(--color-primary)",
  revoked: "var(--color-text-muted)",
};

export function OpenIntakePanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<OpenRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<OpenRow | null>(null);
  const clipboard = useCopy();

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<OpenRow[]>("/intake/open"));
      setLoadFailed(false);
    } catch {
      // נשאר `null` — „לא ידוע”, ולא „אין קישורים”
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * יצירה **והעתקה באותה לחיצה.**
   *
   * קישור שנוצר ולא הועתק הוא קישור שלא נשלח. `clipboard.copy` נקרא
   * אחרי ה-await ולכן דפדפן עשוי לסרב לו; לכן הקישור גם מוצג
   * במלואו למטה, ולחיצה שנחסמה משאירה משהו לבחור ידנית.
   */
  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const row = await apiPost<OpenRow>("/intake/open", {});
      setFresh(row.url);
      await clipboard.copy(row.url);
      await load();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "יצירת הקישור נכשלה — נסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: OpenRow): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/intake/${row.id}`);
      if (fresh === row.url) setFresh(null);
      await load();
      setRevoking(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל — נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="mv-btn-plain"
        style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}
        onClick={() => setOpen(true)}
      >
        <IconSend s={15} /> קישור ללקוח חדש
      </button>
    );
  }

  return (
    <section
      className="mv-list-card mb-[18px] w-full px-[22px] py-[18px]"
      aria-labelledby="open-intake-heading"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="open-intake-heading"
          className="m-0"
          style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
        >
          קישור ללקוח שעדיין לא אצלנו
        </h2>
        <span className="grow" />
        <button
          type="button"
          className="mv-btn-plain"
          aria-label="סגירת האזור"
          onClick={() => setOpen(false)}
        >
          <IconX s={14} />
        </button>
      </div>
      <p
        className="m-0 mt-1 text-[length:var(--type-caption-lg)] leading-relaxed"
        style={{ color: "var(--color-text-muted)" }}
      >
        שלחו את הקישור בוואטסאפ או ב-SMS. הלקוח ממלא שם, טלפון ומה
        שהוא מחפש — וכרטיס הקונה נפתח מעצמו. לקוח שכבר קיים אצלכם
        יזוהה לפי הטלפון ולא ייפתח לו כרטיס שני.
      </p>

      {error !== null && revoking === null ? (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy}
          onClick={() => void create()}
        >
          <IconLink s={15} /> צרו קישור חדש
        </button>
        {fresh !== null ? (
          <span className="text-[length:var(--type-caption-lg)] font-bold" style={{ color: "var(--color-primary)" }}>
            {clipboard.state === "copied"
              ? "✓ הקישור הועתק — הדביקו בשיחה"
              : "הקישור נוצר — העתיקו אותו מהשורה למטה"}
          </span>
        ) : null}
      </div>

      {loadFailed ? (
        <div className="mt-4">
          <LoadError onRetry={() => void load()} />
        </div>
      ) : rows === null ? (
        <p className="mt-4" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : rows.length === 0 ? (
        <p
          className="m-0 mt-4 rounded-xl border p-4 text-[length:var(--type-body-sm)]"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-field)",
            color: "var(--color-text-muted)",
          }}
        >
          עדיין לא יצרתם קישור פתוח.
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
                  <span className="font-bold" style={{ color: STATUS_COLOR[row.status] }}>
                    {expired ? "הקישור פג תוקף" : INTAKE_STATUS_LABEL[row.status]}
                  </span>
                  {/*
                    „מילא” בלי הכרטיס אינו עונה על השאלה הבאה: מי זה
                    היה. הקישור לכרטיס הוא הדבר היחיד שמעניין בשורה
                    אחרי המילוי.
                  */}
                  {row.buyerId !== null ? (
                    <Link href={`/buyers/${row.buyerId}`} className="font-bold underline">
                      פתחו את הכרטיס
                    </Link>
                  ) : null}
                  <span className="grow" />
                  {row.status !== "revoked" && !expired ? (
                    <button
                      type="button"
                      className="mv-btn-plain"
                      aria-label="ביטול הקישור"
                      onClick={() => setRevoking(row)}
                    >
                      <IconX s={14} /> ביטול
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
                    : ` · בתוקף עד ${formatDateTime(row.expiresAt)}`}
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
          הקישור יפסיק לעבוד מיידית. לקוח שיפתח אותו יראה שהקישור בוטל.
          כרטיס שכבר נוצר ממנו נשאר.
        </p>
        {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      </ConfirmDialog>
    </section>
  );
}
