"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  PAYOUT_STATUS_LABEL,
  shekels,
  type BankDetails,
  type PayoutStatus,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { IconCoins } from "../icons";
import { Notice } from "../notice";

/**
 * תור המשיכות — כסף שיוצא מהפלטפורמה למשרדים.
 *
 * שלושה כללים עיצוביים, וכולם נובעים מאותו דבר: זו הפעולה היחידה
 * במערכת שבה טעות עולה כסף אמיתי ואי אפשר לבטלה.
 *
 * 1. **פרטי הבנק נפתחים בלחיצה ולא מוצגים ברשימה.** מי שסוקר את
 *    התור אינו צריך לראות חשבונות בנק; מי שמבצע העברה — כן.
 * 2. **סימון "שולם" דורש אסמכתה.** בלעדיה "שולם" הוא אמירה בלי גיבוי,
 *    וכשמישהו ישאל מתי ולאן, לא תהיה תשובה.
 * 3. **אישור ותשלום נפרדים.** ההחלטה קורית כאן; ההעברה קורית בבנק,
 *    אחר כך, ולפעמים נכשלת.
 */

interface PayoutRow {
  id: string;
  tenantId: string;
  tenantName: string;
  amountAgorot: number;
  status: PayoutStatus;
  accountMasked: string;
  bank: BankDetails;
  note?: string;
  decisionNote?: string;
  reference?: string;
  createdAt: string;
  decidedAt?: string;
  paidAt?: string;
}

const STATUS_COLOR: Record<PayoutStatus, string> = {
  pending: "var(--color-warning, var(--color-text-muted))",
  approved: "var(--color-primary)",
  paid: "var(--color-success)",
  rejected: "var(--color-danger)",
};

export function PayoutDeskSection(): React.JSX.Element {
  const [rows, setRows] = useState<PayoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<PayoutRow[]>("/platform/payouts")
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "טעינת בקשות המשיכה נכשלה"),
      );
  }, []);

  useEffect(load, [load]);

  async function decide(row: PayoutRow, status: PayoutStatus): Promise<void> {
    if (
      status === "rejected" &&
      !window.confirm(`לדחות את הבקשה של ${row.tenantName} על ${shekels(row.amountAgorot)} ₪?\n\nהסכום יוחזר ליתרה שלהם.`)
    ) {
      return;
    }
    if (
      status === "paid" &&
      !window.confirm(
        `לסמן שההעברה בוצעה?\n\n${shekels(row.amountAgorot)} ₪ ל-${row.tenantName}.\nסימון זה סופי ואי אפשר לבטלו.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      await apiPost("/platform/payouts/decide", {
        id: row.id,
        status,
        ...(note[row.id]?.trim() ? { note: note[row.id]!.trim() } : {}),
        ...(reference[row.id]?.trim() ? { reference: reference[row.id]!.trim() } : {}),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעולה נכשלה");
    } finally {
      setBusy(null);
    }
  }

  const pending = (rows ?? []).filter((r) => r.status === "pending" || r.status === "approved");

  return (
    <section aria-labelledby="payout-desk-heading" className="mb-8">
      <h2 id="payout-desk-heading" className="mb-1 text-lg font-semibold">
        <IconCoins s={16} /> בקשות משיכה
        {pending.length > 0 ? (
          <span className="mv-chip ms-2" style={{ fontSize: "var(--type-caption)" }}>
            {pending.length} ממתינות
          </span>
        ) : null}
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        משרדים שבחרו תמורה בכסף על הפניות שפרסמו. הסכום כבר ירד מהיתרה שלהם ברגע
        הבקשה — דחייה מחזירה אותו.
      </p>

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          אין בקשות משיכה.
        </p>
      ) : (
        <div className="mv-list-card">
          {rows.map((row) => (
            <article
              key={row.id}
              className="border-b p-3 last:border-b-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <b className="text-[16px]">{shekels(row.amountAgorot)} ₪</b>
                <span>{row.tenantName}</span>
                <span style={{ color: STATUS_COLOR[row.status], fontWeight: 700, fontSize: 14 }}>
                  {PAYOUT_STATUS_LABEL[row.status]}
                </span>
                <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                  {new Date(row.createdAt).toLocaleDateString("he-IL")} · חשבון {row.accountMasked}
                </span>
              </div>
              {row.note !== undefined ? (
                <p className="m-0 mt-1 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                  הערת המשרד: {row.note}
                </p>
              ) : null}
              {row.reference !== undefined ? (
                <p className="m-0 mt-1 text-[14px]">
                  אסמכתה: <code dir="ltr">{row.reference}</code>
                </p>
              ) : null}

              {/* פרטי הבנק נפתחים במפורש — ראו ההסבר בראש הקובץ */}
              {row.status === "pending" || row.status === "approved" ? (
                <>
                  <button
                    type="button"
                    className="mv-btn-plain mt-1 text-[14px]"
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                  >
                    {openId === row.id ? "הסתר פרטי העברה" : "הצג פרטי העברה"}
                  </button>
                  {openId === row.id ? (
                    <dl
                      className="mt-1 grid gap-x-3 text-[14px]"
                      style={{ gridTemplateColumns: "auto 1fr" }}
                    >
                      <dt style={{ color: "var(--color-text-muted)" }}>בעל החשבון</dt>
                      <dd className="m-0">{row.bank.holderName}</dd>
                      <dt style={{ color: "var(--color-text-muted)" }}>ח.פ./ע.מ.</dt>
                      <dd className="m-0" dir="ltr">{row.bank.businessId}</dd>
                      <dt style={{ color: "var(--color-text-muted)" }}>בנק / סניף / חשבון</dt>
                      <dd className="m-0" dir="ltr">
                        {row.bank.bankCode} / {row.bank.branch} / {row.bank.accountNumber}
                      </dd>
                    </dl>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="grow text-[14px]">
                      <span className="mb-0.5 block font-semibold">
                        {row.status === "approved" ? "אסמכתת ההעברה" : "הערה להחלטה"}
                      </span>
                      <input
                        value={
                          row.status === "approved" ? (reference[row.id] ?? "") : (note[row.id] ?? "")
                        }
                        onChange={(e) =>
                          row.status === "approved"
                            ? setReference({ ...reference, [row.id]: e.target.value })
                            : setNote({ ...note, [row.id]: e.target.value })
                        }
                        className="w-full rounded-lg border px-2.5 py-1.5"
                        style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                      />
                    </label>
                    {row.status === "pending" ? (
                      <Button onClick={() => void decide(row, "approved")} disabled={busy === row.id}>
                        אישור
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void decide(row, "paid")}
                        disabled={busy === row.id || (reference[row.id] ?? "").trim() === ""}
                      >
                        סמן ששולם
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => void decide(row, "rejected")}
                      disabled={busy === row.id}
                    >
                      דחייה
                    </Button>
                  </div>
                </>
              ) : null}
              {row.decisionNote !== undefined ? (
                <p className="m-0 mt-1 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                  {row.decisionNote}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
