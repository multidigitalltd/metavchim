"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/** דוחות ביצועים למשרד (אפיון §16, מסלול Agency). */

interface OfficeStats {
  properties: { total: number; active: number; needsCompletion: number };
  buyers: { total: number; hot: number };
  leads: { open: number; requiresHuman: number; converted: number };
  offers: { sent: number; opened: number; interested: number };
  appointments: { upcoming: number };
  offerOpenRate: number;
}

interface AgentPerfRow {
  userId: string;
  name: string;
  role: string;
  buyers: number;
  leads: number;
  offersSent: number;
  offersInterested: number;
  appointments: number;
}

const WINDOWS: [string, string][] = [
  ["30", "30 הימים האחרונים"],
  ["90", "3 חודשים אחרונים"],
  ["365", "שנה אחרונה"],
  ["all", "מאז ומעולם"],
];

const ROLE_LABELS: Record<string, string> = {
  owner: "בעלים",
  admin: "מנהל",
  agent: "סוכן",
  assistant: "עוזר",
  viewer: "צפייה",
};

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <dt className="text-sm" style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd className="text-2xl font-bold">{value}</dd>
      {hint ? <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{hint}</p> : null}
    </div>
  );
}

export default function ReportsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [agents, setAgents] = useState<AgentPerfRow[] | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [days, setDays] = useState("30");

  useEffect(() => {
    if (authLoading) return;
    apiGet<OfficeStats>(`/analytics/office?days=${days}`)
      .then(setStats)
      .catch((err: unknown) => {
        // מסלול שאינו Agency — הדוחות נעולים (הפיצ'ר נאכף בשרת)
        if (err instanceof ApiError && err.status === 403) setUpsell(true);
      });
    apiGet<AgentPerfRow[]>(`/analytics/agents?days=${days}`)
      .then(setAgents)
      .catch((err: unknown) => {
        // סוכן רגיל ללא users.manage — פשוט לא רואה את טבלת הצוות
        if (err instanceof ApiError && err.status === 403) setAgents([]);
      });
  }, [authLoading, days]);

  if (authLoading) return <p aria-live="polite">טוען דוחות…</p>;
  if (upsell) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h1 className="mb-2 text-2xl font-bold">דוחות ביצועים</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          דוחות הביצועים זמינים במסלול Agency ומעלה. לשדרוג — פנו לבעל המשרד.
        </p>
      </div>
    );
  }
  if (!stats) return <p aria-live="polite">טוען דוחות…</p>;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">דוחות ביצועים</h1>
        <label className="flex items-center gap-2">
          <span className="font-medium">תקופה:</span>
          <select
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {WINDOWS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* מצב מול תנועה: "נכסים פעילים ב-30 הימים האחרונים" הוא מספר
          חסר משמעות, ולכן מדדי המצב מופרדים ואינם מסוננים לפי תקופה */}
      <section aria-labelledby="office-heading" className="mb-8">
        <h2 id="office-heading" className="mb-1 text-lg font-semibold">תמונת מצב עכשיו</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          המצב הנוכחי של המשרד — לא מושפע מהתקופה שנבחרה.
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="נכסים פעילים" value={stats.properties.active} hint={`מתוך ${stats.properties.total}`} />
          <StatCard label="נכסים להשלמה" value={stats.properties.needsCompletion} />
          <StatCard label="קונים חמים" value={stats.buyers.hot} hint={`מתוך ${stats.buyers.total}`} />
          <StatCard label="לידים פתוחים" value={stats.leads.open} />
          <StatCard label="דורש טיפול אנושי" value={stats.leads.requiresHuman} />
          <StatCard label="פגישות מתוכננות" value={stats.appointments.upcoming} />
        </dl>
      </section>

      <section aria-labelledby="funnel-heading" className="mb-8">
        <h2 id="funnel-heading" className="mb-1 text-lg font-semibold">פעילות בתקופה</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {WINDOWS.find(([value]) => value === days)?.[1]}
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="הצעות שנשלחו" value={stats.offers.sent} />
          <StatCard label="הצעות שנפתחו" value={stats.offers.opened} />
          <StatCard label="הביעו עניין" value={stats.offers.interested} />
          <StatCard label="לידים שהומרו" value={stats.leads.converted} />
          <StatCard
            label="שיעור פתיחת הצעות"
            value={`${stats.offerOpenRate}%`}
            hint={`${stats.offers.opened}/${stats.offers.sent} נפתחו`}
          />
        </dl>
      </section>

      {agents && agents.length > 0 ? (
        <section aria-labelledby="agents-heading">
          <h2 id="agents-heading" className="mb-3 text-lg font-semibold">ביצועים לפי סוכן</h2>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
            <table className="w-full">
              <caption className="mv-visually-hidden">ביצועי הסוכנים בתקופה שנבחרה: קונים, לידים, הצעות, שיעור עניין ופגישות</caption>
              <thead style={{ background: "var(--color-surface)" }}>
                <tr>
                  <th scope="col" className="p-3 text-start">סוכן</th>
                  <th scope="col" className="p-3 text-start">קונים</th>
                  <th scope="col" className="p-3 text-start">לידים</th>
                  <th scope="col" className="p-3 text-start">הצעות</th>
                  <th scope="col" className="p-3 text-start">הביעו עניין</th>
                  <th scope="col" className="p-3 text-start">פגישות</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.userId} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                    <td className="p-3">
                      <span className="font-medium">{agent.name}</span>
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {ROLE_LABELS[agent.role] ?? agent.role}
                      </span>
                    </td>
                    <td className="p-3">{agent.buyers}</td>
                    <td className="p-3">{agent.leads}</td>
                    <td className="p-3">{agent.offersSent}</td>
                    <td className="p-3">
                      {agent.offersInterested}
                      {agent.offersSent > 0 ? (
                        <span className="ms-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                          ({Math.round((agent.offersInterested / agent.offersSent) * 100)}%)
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">{agent.appointments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
