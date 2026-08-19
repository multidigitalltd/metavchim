"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { platformCreditKindLabel, shekels } from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { IconBanknote, IconCoins, IconFlame, IconGift, IconHandshake } from "../icons";
import { Notice } from "../notice";

/**
 * ההכנסה מהפניות — **המסך שלא היה קיים.**
 *
 * העמלה חושבה, נשמרה על שורת ההפניה, ולא נזקפה לשום ספר. לא היה
 * מספר אחד שאפשר להצביע עליו ולומר „זו ההכנסה מהרשת”, ולכן בפועל
 * איש לא ידע מה היא.
 *
 * המסך בנוי סביב שני מספרים שמנוגדים זה לזה במכוון: מה שהוכר בפועל,
 * ומה שהונפק כבונוס. השני הוא היקר, והוא זה שנעדר מכל דיון תמחור עד
 * שהוא מוצג ליד הראשון.
 */

interface Report {
  balanceCredits: number;
  accruedCredits: number;
  burnedCredits: number;
  recognizedAgorot: number;
  balanceValueAgorot: number;
  unitPriceAgorot: number;
  bonusCreditsIssued: number;
  cashPaidAgorot: number;
  settledReferrals: number;
  netAgorot: number;
}

interface Entry {
  id: string;
  kind: string;
  amount: number;
  recognizedAgorot: number;
  unitPriceAgorot: number;
  sourceTenantName: string | null;
  note: string | null;
  createdAt: string;
}

const dateFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

export function ReferralRevenueSection(): React.JSX.Element {
  const [report, setReport] = useState<Report | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [burnAmount, setBurnAmount] = useState("");
  const [burnNote, setBurnNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<{ report: Report; entries: Entry[] }>("/platform/credits")
      .then((res) => {
        setReport(res.report);
        setEntries(res.entries);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "טעינת ההכנסות נכשלה");
      });
  }, []);

  useEffect(load, [load]);

  async function burn(): Promise<void> {
    const credits = Number(burnAmount);
    if (!Number.isInteger(credits) || credits < 1) {
      setError("כמות הקרדיטים למחיקה חייבת להיות מספר שלם חיובי");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{ recognizedAgorot: number; report: Report }>(
        "/platform/credits/burn",
        { credits, ...(burnNote.trim() ? { note: burnNote.trim() } : {}) },
      );
      setReport(res.report);
      setDone(`נמחקו ${credits} קרדיטים — הוכרה הכנסה של ${shekels(res.recognizedAgorot)}`);
      setBurnAmount("");
      setBurnNote("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (report === null) {
    return (
      <section className="mv-list-card px-5 py-[17px]">
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          {error ?? "טוען…"}
        </p>
      </section>
    );
  }

  const netPositive = report.netAgorot >= 0;

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="revenue-heading">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconHandshake s={20} />
        <h2 id="revenue-heading" className="m-0" style={{ fontSize: 18, fontWeight: 800 }}>
          הכנסה מהפניות
        </h2>
        <span className="mv-tag" style={{ background: "var(--color-hover-soft)" }}>
          {report.settledReferrals} הפניות נסגרו
        </span>
      </div>

      {/* ---- ארבעת המספרים ---- */}
      <div className="mv-stat-grid mb-4">
        <Stat
          icon={<IconCoins s={18} />}
          label="בחשבון הפלטפורמה"
          value={`${report.balanceCredits} קרדיט`}
          sub={`שווי מוערך ${shekels(report.balanceValueAgorot)}`}
        />
        <Stat
          icon={<IconFlame s={18} />}
          label="הוכר בהכנסה"
          value={shekels(report.recognizedAgorot)}
          sub={`${report.burnedCredits} קרדיט נמחקו`}
          tone="success"
        />
        <Stat
          icon={<IconGift s={18} />}
          label="בונוס שהונפק"
          value={shekels(report.bonusCreditsIssued * report.unitPriceAgorot)}
          sub={`${report.bonusCreditsIssued} קרדיט חדשים`}
          tone="danger"
        />
        <Stat
          icon={<IconBanknote s={18} />}
          label="שולם במזומן"
          value={shekels(report.cashPaidAgorot)}
          sub="למפנים שבחרו כסף"
        />
      </div>

      {/* ---- השורה התחתונה ---- */}
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-4 py-3"
        style={{
          background: netPositive ? "var(--color-success-soft)" : "#fdeee7",
          border: `1px solid ${netPositive ? "var(--color-success)" : "var(--color-danger)"}`,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 700 }}>שורה תחתונה</span>
        <span
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: netPositive ? "var(--color-success)" : "var(--color-danger)",
          }}
        >
          {shekels(report.netAgorot)}
        </span>
      </div>

      {/* ---- פס יחסי: מה הוכר מול מה שהונפק ---- */}
      <Balance
        recognized={report.recognizedAgorot}
        issued={report.bonusCreditsIssued * report.unitPriceAgorot}
      />

      {/* ---- מחיקה ---- */}
      <div className="mt-5 flex flex-wrap items-end gap-2">
        <label className="mv-auth-field" style={{ maxWidth: 150 }}>
          <span>קרדיטים למחיקה</span>
          <input
            className="mv-input"
            inputMode="numeric"
            value={burnAmount}
            onChange={(e) => setBurnAmount(e.target.value)}
            placeholder={String(report.balanceCredits)}
          />
        </label>
        <label className="mv-auth-field" style={{ flex: "1 1 220px" }}>
          <span>הערה</span>
          <input
            className="mv-input"
            value={burnNote}
            onChange={(e) => setBurnNote(e.target.value)}
            placeholder="למשל: סגירת רבעון"
          />
        </label>
        <Button onClick={burn} disabled={busy || report.balanceCredits < 1}>
          {busy ? "מוחק…" : "מחק והכר בהכנסה"}
        </Button>
      </div>

      {done === null ? null : (
        <Notice tone="success" onClose={() => setDone(null)}>
          {done}
        </Notice>
      )}
      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {/* ---- הספר ---- */}
      {entries.length === 0 ? null : (
        <div className="mt-5">
          <h3 className="m-0 mb-2" style={{ fontSize: 16, fontWeight: 700 }}>
            תנועות אחרונות
          </h3>
          <ul className="m-0 list-none p-0">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                style={{ borderBlockEnd: "1px solid var(--color-border)" }}
              >
                <span className="flex items-center gap-2">
                  <span
                    className="mv-tag"
                    style={{
                      background:
                        entry.amount > 0 ? "var(--color-success-soft)" : "var(--color-hover-soft)",
                    }}
                  >
                    {platformCreditKindLabel(entry.kind)}
                  </span>
                  {entry.sourceTenantName === null ? null : (
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {entry.sourceTenantName}
                    </span>
                  )}
                  {entry.note === null ? null : (
                    <span style={{ color: "var(--color-text-muted)" }}>{entry.note}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {entry.recognizedAgorot > 0 ? (
                    <span style={{ color: "var(--color-success)", fontWeight: 700 }}>
                      {shekels(entry.recognizedAgorot)}
                    </span>
                  ) : null}
                  <span style={{ fontWeight: 700 }}>
                    {entry.amount > 0 ? "+" : ""}
                    {entry.amount}
                  </span>
                  <time
                    dateTime={entry.createdAt}
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {dateFmt.format(new Date(entry.createdAt))}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "success" | "danger";
}): React.JSX.Element {
  const color =
    tone === "success"
      ? "var(--color-success)"
      : tone === "danger"
        ? "var(--color-danger)"
        : "var(--color-text)";
  return (
    <div className="mv-stat-tile">
      <span className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
        {icon}
        {label}
      </span>
      <strong style={{ fontSize: 20, fontWeight: 800, color }}>{value}</strong>
      <span style={{ color: "var(--color-text-muted)" }}>{sub}</span>
    </div>
  );
}

/**
 * פס יחסי בין מה שהוכר לבין מה שהונפק.
 *
 * גרף ולא שני מספרים: היחס הוא הסיפור. עמלה של 10% מול בונוס של 20%
 * נראית סבירה כשני אחוזים ברשימה, ומיד לא סבירה כשני חלקים של פס.
 */
function Balance({
  recognized,
  issued,
}: {
  recognized: number;
  issued: number;
}): React.JSX.Element | null {
  const total = recognized + issued;
  if (total <= 0) return null;
  const recognizedPct = Math.round((recognized / total) * 100);
  return (
    <div>
      <div
        className="flex overflow-hidden rounded-lg"
        style={{ height: 14, background: "var(--color-hover-soft)" }}
        role="img"
        aria-label={`הוכר ${recognizedPct}% מתוך הסכום, והשאר הונפק כבונוס`}
      >
        <span style={{ width: `${recognizedPct}%`, background: "var(--color-success)" }} />
        <span style={{ width: `${100 - recognizedPct}%`, background: "var(--color-danger)" }} />
      </div>
      <div className="mt-1 flex justify-between" style={{ color: "var(--color-text-muted)" }}>
        <span>הוכר {shekels(recognized)}</span>
        <span>בונוס {shekels(issued)}</span>
      </div>
    </div>
  );
}

