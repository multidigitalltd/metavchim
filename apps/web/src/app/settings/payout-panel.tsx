"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  PAYOUT_STATUS_LABEL,
  bankDetailsRejectionReason,
  payoutRequestRejectionReason,
  shekels,
  type BankDetails,
  type PayoutStatus,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { DictationTextarea } from "../dictation-field";
import { Notice } from "../notice";

/**
 * היתרה הכספית ומשיכתה — בלשונית "מנוי ותשלום" בניהול המשרד.
 *
 * ישב במסך השיתופים ליד הקרדיטים והועבר לכאן (בקשת המשתמש):
 * משיכת כסף היא פעולה של בעל המשרד מול הבנק, לא חלק מהגלישה בפיד
 * הרשת — ומקומה ליד שאר ענייני הכסף של המשרד.
 *
 * מוצג **רק כשיש יתרה או בקשה קודמת.** משרד שמעולם לא בחר תמורה
 * בכסף אינו צריך לראות טופס בנק על המסך שלו — הוא יופיע ברגע
 * שההפניה הראשונה במסלול הכסף תיקלט, וזה הרגע שבו הוא רלוונטי.
 *
 * הבדיקות כאן הן **הד** לאלה שבשרת ולא תחליף להן: הן חוסכות סיבוב
 * רשת על טעות הקלדה, והשרת בודק שוב את אותה פונקציה בדיוק.
 */

interface Balance {
  balanceAgorot: number;
  minimumAgorot: number;
  pendingAgorot: number;
}

interface PayoutRow {
  id: string;
  amountAgorot: number;
  status: PayoutStatus;
  accountMasked: string;
  note?: string;
  decisionNote?: string;
  reference?: string;
  createdAt: string;
}

const EMPTY_BANK: BankDetails = {
  holderName: "",
  bankCode: "",
  branch: "",
  accountNumber: "",
  businessId: "",
};

const STATUS_COLOR: Record<PayoutStatus, string> = {
  pending: "var(--color-text-muted)",
  approved: "var(--color-primary)",
  paid: "var(--color-success)",
  rejected: "var(--color-danger)",
};

function BankField({
  label,
  value,
  onChange,
  hint,
  inputMode = "numeric",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-2.5 py-2"
        style={{
          borderColor: "var(--color-input-border)",
          background: "var(--color-surface)",
        }}
      />
      {hint !== undefined ? (
        <span
          className="mt-0.5 block text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function PayoutPanel() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [bank, setBank] = useState<BankDetails>(EMPTY_BANK);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function load(): void {
    /*
     * 403 אינו שגיאה כאן — סוכן בלי `billing.manage` פשוט אינו רואה
     * את האזור. מסך שמציג "שגיאה" על היעדר הרשאה מלמד להתעלם
     * מהודעות שגיאה.
     */
    apiGet<Balance>("/payouts/balance")
      .then(setBalance)
      .catch(() => setBalance(null));
    /*
     * רשימת הבקשות היא מה שמספר למשרד ש„כבר ביקשתי” — ובלעדיה
     * הטופס נראה כמו טופס שטרם מולא. כישלון טעינה שלה נאמר, כדי
     * שלא תישלח בקשת משיכה שנייה על אותו כסף.
     */
    setRowsFailed(false);
    apiGet<PayoutRow[]>("/payouts/requests")
      .then(setRows)
      .catch(() => setRowsFailed(true));
  }

  useEffect(load, []);

  if (balance === null) return null;
  // אין יתרה, אין בקשות, ואין היסטוריה — אין מה להראות
  if (balance.balanceAgorot === 0 && rows.length === 0) return null;

  const amountAgorot = Math.round(Number(amount) * 100);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountAgorot);
  const localProblem = !amountValid
    ? null
    : (payoutRequestRejectionReason(
        amountAgorot,
        balance.balanceAgorot,
        balance.minimumAgorot,
      ) ?? bankDetailsRejectionReason(bank));

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiPost<PayoutRow>("/payouts/requests", {
        amountAgorot,
        bank,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      });
      setDone("הבקשה נשלחה. הסכום כבר ירד מהיתרה, ויחזור אליה אם הבקשה תידחה.");
      setOpen(false);
      setAmount("");
      setNote("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mv-list-card px-5 py-[17px]"
      aria-labelledby="payout-heading"
    >
      <h3
        id="payout-heading"
        className="m-0 mb-1"
        style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
      >
        יתרה כספית
      </h3>
      <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]">
        <b>{shekels(balance.balanceAgorot)} ₪</b> זמינים למשיכה.
        {balance.pendingAgorot > 0 ? (
          <>
            {" "}
            <span style={{ color: "var(--color-text-muted)" }}>
              ({shekels(balance.pendingAgorot)} ₪ נוספים כבר בבקשה פתוחה)
            </span>
          </>
        ) : null}
      </p>
      <p
        className="m-0 mb-2 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        היתרה נצברת מהפניות שפרסמתם ובחרתם לקבל עליהן תמורה בכסף. הסכום המינימלי
        למשיכה הוא {shekels(balance.minimumAgorot)} ₪, וההעברה היא בין עוסקים —
        כנגדה יש להוציא חשבונית.
      </p>

      {!open ? (
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
          disabled={balance.balanceAgorot < balance.minimumAgorot}
        >
          {balance.balanceAgorot < balance.minimumAgorot
            ? `עוד ${shekels(balance.minimumAgorot - balance.balanceAgorot)} ₪ עד לסף המשיכה`
            : "בקשת משיכה"}
        </Button>
      ) : (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <BankField
              label="סכום למשיכה (₪)"
              value={amount}
              onChange={setAmount}
              hint={`עד ${shekels(balance.balanceAgorot)} ₪`}
            />
            <BankField
              label="שם בעל החשבון"
              value={bank.holderName}
              onChange={(v) => setBank({ ...bank, holderName: v })}
              inputMode="text"
              hint="כפי שהוא מופיע בבנק"
            />
            <BankField
              label="ח.פ. / ע.מ."
              value={bank.businessId}
              onChange={(v) => setBank({ ...bank, businessId: v })}
              hint="9 ספרות"
            />
            <BankField
              label="קוד בנק"
              value={bank.bankCode}
              onChange={(v) => setBank({ ...bank, bankCode: v })}
              hint="לדוגמה 12 = הפועלים"
            />
            <BankField
              label="סניף"
              value={bank.branch}
              onChange={(v) => setBank({ ...bank, branch: v })}
            />
            <BankField
              label="מספר חשבון"
              value={bank.accountNumber}
              onChange={(v) => setBank({ ...bank, accountNumber: v })}
            />
          </div>
          {/* הכתבה כמו בכל שדה טקסט במערכת */}
          <DictationTextarea
            label="הערה (לא חובה)"
            value={note}
            onChange={setNote}
            rows={2}
            placeholder="למשל: מספר חשבונית"
          />
          {localProblem !== null ? (
            <p
              className="m-0 mt-2 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-danger)" }}
            >
              {localProblem}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() => void submit()}
              disabled={busy || !amountValid || localProblem !== null}
            >
              {busy ? "שולח…" : "שלחו בקשה"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}

      {error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
      {done !== null ? (
        <Notice tone="success">✓ {done}</Notice>
      ) : null}

      {rowsFailed ? (
        <Notice tone="warning">
          לא הצלחנו לטעון את הבקשות הקודמות — ייתכן שכבר קיימת בקשה פתוחה.
          רעננו את המסך לפני שליחת בקשה חדשה.
        </Notice>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3">
          <h4 className="m-0 mb-1 text-sm font-semibold">בקשות קודמות</h4>
          <ul className="m-0 list-none p-0 text-[length:var(--type-caption)]">
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-t py-1.5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <b>{shekels(row.amountAgorot)} ₪</b> ·{" "}
                {new Date(row.createdAt).toLocaleDateString("he-IL")} ·{" "}
                <span style={{ color: STATUS_COLOR[row.status] }}>
                  {PAYOUT_STATUS_LABEL[row.status]}
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {" "}
                  · חשבון {row.accountMasked}
                </span>
                {row.reference !== undefined ? (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    · אסמכתה {row.reference}
                  </span>
                ) : null}
                {row.decisionNote !== undefined ? (
                  <div style={{ color: "var(--color-text-muted)" }}>
                    {row.decisionNote}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
