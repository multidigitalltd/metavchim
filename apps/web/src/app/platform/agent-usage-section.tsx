"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, ApiError, apiGet } from "@/lib/api";
import {
  IconBolt,
  IconClock,
  IconCoins,
  IconDownload,
  IconSparkle,
  IconWarning,
} from "../icons";
import { Notice } from "../notice";

/**
 * שימוש ועלות של הסוכן — המסך שהופך "הסוכן יקר" למספרים.
 *
 * המפתח של Gemini הוא של הפלטפורמה, ולכן העלות כולה של בעל
 * הפלטפורמה — והמסך הזה עונה על שלוש שאלות: כמה פקודות רצו, כמה
 * אסימונים הן שרפו (החשיבה יקרה, המטמון זול), וכמה מהן בכלל הבין
 * המודל לעומת נפילה לזיהוי הבסיסי. למטה — פירוק לפי משרד, וכפתור
 * שמוריד את דאטת האימון שנצברה.
 */

interface Totals {
  interpretCount: number;
  executeCount: number;
  rulesCount: number;
  /** לחיצות שנחסמו — ההרשאה נשללה, ולכן לא רץ שום פירוש */
  blockedCount: number;
  whatsappCount: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  avgLatencyMs: number;
}

interface Report {
  totals: Totals;
  perTenant: ({ tenantId: string; tenantName: string } & Totals)[];
  perDay: { day: string; interpretCount: number; tokens: number }[];
}

const num = new Intl.NumberFormat("he-IL");

export function AgentUsageSection(): React.JSX.Element {
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  /*
   * מזהה בקשה רץ: מעבר מהיר בין חלונות משאיר את שתי הבקשות באוויר,
   * והאיטית (90 יום) יכולה לחזור אחרי המהירה ולדרוס אותה בזמן
   * שהכותרת כבר מציגה "7 ימים" (ביקורת Codex). רק התשובה של הבקשה
   * האחרונה מתקבלת.
   */
  const requestRef = useRef(0);
  const load = useCallback((window: number) => {
    const requestId = ++requestRef.current;
    setError(null);
    apiGet<Report>(`/platform/agent-usage?days=${window}`)
      .then((res) => {
        if (requestRef.current === requestId) setReport(res);
      })
      .catch((err: unknown) => {
        if (requestRef.current !== requestId) return;
        setError(err instanceof ApiError ? err.message : "טעינת דוח הסוכן נכשלה");
      });
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  /**
   * ההורדה ב-fetch עם Credentials ולא בקישור ישיר: ה-API בדומיין
   * אחר ודורש את עוגיית ה-Session, וקישור רגיל לא נושא אותה.
   */
  async function downloadTraining(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/platform/agent-usage/export?days=${days}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `agent-training-${days}d.jsonl`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("הורדת דאטת האימון נכשלה — נסו שוב");
    } finally {
      setDownloading(false);
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

  const t = report.totals;
  /*
   * ‎**הבסיס הוא פקודות שבאמת נפרשו.**
   *
   * לחיצה שנחסמה נספרת ב-`interpretCount` אבל לא רץ בה שום מנוע —
   * לא מודל ולא חוקים. גזירת „כמה הבין המודל” כהפרש מול `rulesCount`
   * בלבד הייתה סופרת כל חסימה כקריאה ששולמה, בדיוק בנתון שנועד
   * למדוד עלות (ביקורת Codex). אותו בסיס משמש גם לשיעור הזיהוי
   * הבסיסי, אחרת אותה הטיה נכנסת גם להתראה שמתבססת עליו.
   */
  const attempted = t.interpretCount - t.blockedCount;
  const llmCount = attempted - t.rulesCount;
  const rulesPct = attempted === 0 ? 0 : Math.round((t.rulesCount / attempted) * 100);
  const cachedPct =
    t.promptTokens === 0 ? 0 : Math.round((t.cachedTokens / t.promptTokens) * 100);

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="agent-usage-heading">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconSparkle s={20} />
        <h2 id="agent-usage-heading" className="m-0" style={{ fontSize: "calc(18 / 16 * 1rem)", fontWeight: 800 }}>
          שימוש ועלות של הסוכן
        </h2>
        <span className="mv-tag" style={{ background: "var(--color-hover-soft)" }}>
          {days === 30 ? "30 הימים האחרונים" : `${days} הימים האחרונים`}
        </span>
        <span className="ms-auto flex gap-1">
          {[7, 30, 90].map((option) => (
            <button
              key={option}
              type="button"
              className="mv-tag"
              aria-pressed={days === option}
              onClick={() => setDays(option)}
              style={{
                cursor: "pointer",
                border: "1px solid var(--color-input-border)",
                background: days === option ? "var(--color-hover-soft)" : "transparent",
                fontWeight: days === option ? 700 : 400,
              }}
            >
              {option} ימים
            </button>
          ))}
        </span>
      </div>

      <div className="mv-stat-grid mb-4">
        <Stat
          icon={<IconBolt s={18} />}
          label="פקודות שפוענחו"
          value={num.format(t.interpretCount)}
          sub={`${num.format(t.executeCount)} בוצעו · ${num.format(t.whatsappCount)} מוואטסאפ`}
        />
        <Stat
          icon={<IconCoins s={18} />}
          label="אסימוני קלט"
          value={num.format(t.promptTokens)}
          sub={`${cachedPct}% מהמטמון של Google (מוזל)`}
          tone={cachedPct >= 50 ? "success" : undefined}
        />
        <Stat
          icon={<IconCoins s={18} />}
          label="אסימוני פלט וחשיבה"
          value={num.format(t.outputTokens + t.thoughtTokens)}
          sub={`מתוכם חשיבה: ${num.format(t.thoughtTokens)} — הרכיב היקר`}
          tone={t.thoughtTokens > t.outputTokens ? "danger" : "success"}
        />
        <Stat
          icon={<IconClock s={18} />}
          label="זמן תשובה ממוצע"
          value={t.avgLatencyMs === 0 ? "—" : `${(t.avgLatencyMs / 1000).toFixed(1)} שנ׳`}
          sub={[
            `${num.format(llmCount)} הבין המודל`,
            `${num.format(t.rulesCount)} זיהוי בסיסי`,
            // מוצג רק כשיש — „0 נחסמו” הוא רעש קבוע
            ...(t.blockedCount > 0 ? [`${num.format(t.blockedCount)} נחסמו`] : []),
          ].join(" · ")}
        />
      </div>

      {rulesPct > 20 && attempted >= 10 ? (
        <p
          className="mb-4 flex items-center gap-2 rounded-xl px-4 py-3"
          style={{ background: "#fdeee7", border: "1px solid var(--color-danger)" }}
        >
          <IconWarning s={18} />
          {rulesPct}% מהפקודות נפלו לזיהוי הבסיסי — כדאי להריץ „בדיקת מנוע ההבנה” ולבדוק
          את המפתח והמודל.
        </p>
      ) : null}

      {report.perTenant.length > 1 ? (
        <div className="mb-4">
          <h3 className="m-0 mb-2" style={{ fontSize: "var(--type-button)", fontWeight: 700 }}>
            לפי משרד
          </h3>
          <ul className="m-0 list-none p-0">
            {[...report.perTenant]
              .sort(
                (a, b) =>
                  b.promptTokens + b.outputTokens + b.thoughtTokens -
                  (a.promptTokens + a.outputTokens + a.thoughtTokens),
              )
              .map((row) => (
                <li
                  key={row.tenantId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  style={{ borderBlockEnd: "1px solid var(--color-border)" }}
                >
                  <span style={{ fontWeight: 700 }}>{row.tenantName}</span>
                  <span className="flex items-center gap-3" style={{ color: "var(--color-text-muted)" }}>
                    <span>{num.format(row.interpretCount)} פקודות</span>
                    <span>
                      {num.format(row.promptTokens + row.outputTokens + row.thoughtTokens)} אסימונים
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={downloadTraining} disabled={downloading || t.interpretCount === 0}>
          <span className="flex items-center gap-2">
            <IconDownload s={16} />
            {downloading ? "מוריד…" : "הורדת דאטת האימון (JSONL)"}
          </span>
        </Button>
        <span style={{ color: "var(--color-text-muted)" }}>
          כל צמדי „מה נאמר ⟵ מה הובן” מהתקופה — הבסיס לאימון מודל ייעודי.
        </span>
      </div>

      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
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
      <strong style={{ fontSize: "var(--type-metric)", fontWeight: 800, color }}>{value}</strong>
      <span style={{ color: "var(--color-text-muted)" }}>{sub}</span>
    </div>
  );
}
