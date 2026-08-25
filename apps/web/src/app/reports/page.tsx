"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { useFeature, useFeaturesReady } from "@/lib/use-features";
import { roleLabel } from "@metavchim/shared";
import { BarChart, DonutChart } from "../charts";
import {
  IconBolt,
  IconCalendar,
  IconClock,
  IconEdit,
  IconEye,
  IconFlame,
  IconHandshake,
  IconHome,
  IconInbox,
  IconKey,
  IconSend,
  IconTarget,
  IconThumbUp,
  IconUser,
  IconUsers,
  IconWarning,
} from "../icons";

/** דוחות ביצועים למשרד (אפיון §16, מסלול Agency). */

interface OfficeStats {
  properties: { total: number; active: number; needsCompletion: number };
  buyers: { total: number; hot: number };
  leads: { open: number; requiresHuman: number; converted: number };
  offers: { sent: number; opened: number; interested: number };
  deals: { closed: number };
  viewings: { held: number; missingOutcome: number };
  daysToFirstOffer: number | null;
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

/**
 * אריח מדד — אייקון, מספר, והסבר קצר.
 *
 * האייקון אינו קישוט: לוח של שנים-עשר מספרים זהים נסרק לאט, ואייקון
 * הוא מה שמאפשר לחזור לאותו מדד בפעם הבאה בלי לקרוא את כל התוויות
 * מחדש. הצבע שמור למדדים שיש בהם פעולה — „דורש טיפול אנושי” אדום,
 * „עסקאות שנסגרו” ירוק, והשאר ניטרלי. צבע על הכול הוא צבע על כלום.
 */
function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "success" | "danger" | "warning";
}) {
  const color =
    tone === "success"
      ? "var(--color-success)"
      : tone === "danger"
        ? "var(--color-danger)"
        : tone === "warning"
          ? "#8a6414"
          : "var(--color-text)";
  return (
    <div className="mv-stat-tile">
      <dt className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
        {icon}
        {label}
      </dt>
      <dd className="m-0" style={{ fontSize: "calc(24 / 16 * 1rem)", fontWeight: 800, color }}>
        {value}
      </dd>
      {hint ? <p className="m-0" style={{ color: "var(--color-text-muted)" }}>{hint}</p> : null}
    </div>
  );
}

export default function ReportsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [agents, setAgents] = useState<AgentPerfRow[] | null>(null);
  const [upsell, setUpsell] = useState(false);
  const [days, setDays] = useState("30");
  const canReports = useFeature("analytics");
  const featuresReady = useFeaturesReady();

  useEffect(() => {
    if (authLoading) return;
    // עד שהמסלול ידוע לא יוצאים לרשת — ראו useFeaturesReady
    if (!featuresReady) return;
    /*
     * מסלול בלי דוחות — לא שולחים בכלל.
     *
     * השרת ממילא עונה 403, והמסך כבר ידע להציג את הודעת השדרוג; מה
     * שלא היה בסדר הוא שכל כניסה למסך ייצרה שתי שגיאות אדומות
     * בקונסול. מפתח שפותח את הקונסול כדי לחפש תקלה אמיתית מוצא רעש
     * שהוא התנהגות תקינה. הבדיקה כאן היא תצוגה בלבד — האכיפה
     * נשארת בשרת.
     */
    if (!canReports) {
      setUpsell(true);
      return;
    }
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
  }, [authLoading, canReports, featuresReady, days]);

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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)" }}
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
        <h2 id="office-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <IconEye s={18} /> תמונת מצב עכשיו
        </h2>
        <dl className="mv-stat-grid m-0 mb-4">
          <StatCard icon={<IconHome s={18} />} label="נכסים פעילים" value={stats.properties.active} hint={`מתוך ${stats.properties.total}`} />
          <StatCard icon={<IconEdit s={18} />} label="נכסים להשלמה" value={stats.properties.needsCompletion} tone={stats.properties.needsCompletion > 0 ? "warning" : undefined} />
          <StatCard icon={<IconFlame s={18} />} label="קונים חמים" value={stats.buyers.hot} hint={`מתוך ${stats.buyers.total}`} />
          <StatCard icon={<IconInbox s={18} />} label="לידים פתוחים" value={stats.leads.open} />
          <StatCard icon={<IconWarning s={18} />} label="דורש טיפול אנושי" value={stats.leads.requiresHuman} tone={stats.leads.requiresHuman > 0 ? "danger" : undefined} />
          <StatCard icon={<IconCalendar s={18} />} label="פגישות מתוכננות" value={stats.appointments.upcoming} />
        </dl>
        {/*
          טבעת ולא עוד שני מספרים: היחס בין „פעילים” ל„להשלמה” הוא
          הסיפור, ושני מספרים זה לצד זה מחייבים לחשב אותו בראש.
        */}
        <div className="mv-list-card px-5 py-4">
          <DonutChart
            slices={[
              { label: "פעילים", value: stats.properties.active, color: "var(--color-primary-accent)", href: "/properties?status=active" },
              { label: "להשלמה", value: stats.properties.needsCompletion, color: "#c8912f", href: "/properties" },
              {
                label: "אחר",
                value: Math.max(0, stats.properties.total - stats.properties.active - stats.properties.needsCompletion),
                color: "var(--color-border-hover)",
              },
            ]}
            centerValue={String(stats.properties.total)}
            centerLabel="נכסים"
          />
        </div>
      </section>

      {/* תוצאות לפני פעילות, במכוון: מתווך שפותח דוח רוצה לדעת כמה
          סגר — לא כמה שלח. פעילות היא הסבר לתוצאה, לא תחליף לה. */}
      <section aria-labelledby="results-heading" className="mb-8">
        <h2 id="results-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <IconTarget s={18} /> תוצאות בתקופה
        </h2>
        <dl className="mv-stat-grid m-0">
          <StatCard
            icon={<IconHandshake s={18} />}
            label="עסקאות שנסגרו"
            value={stats.deals.closed}
            hint="נמכר או הושכר"
            tone={stats.deals.closed > 0 ? "success" : undefined}
          />
          <StatCard
            icon={<IconKey s={18} />}
            label="סיורים שהתקיימו"
            value={stats.viewings.held}
            hint={
              stats.viewings.missingOutcome > 0
                ? `${stats.viewings.missingOutcome} ללא תיעוד`
                : "כולם תועדו"
            }
            tone={stats.viewings.missingOutcome > 0 ? "warning" : undefined}
          />
          <StatCard
            icon={<IconClock s={18} />}
            label="זמן עד הצעה ראשונה"
            value={stats.daysToFirstOffer === null ? "—" : `${stats.daysToFirstOffer} ימים`}
            hint="מכניסת הקונה ועד ההצעה"
          />
        </dl>
      </section>

      <section aria-labelledby="funnel-heading" className="mb-8">
        <h2 id="funnel-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <IconBolt s={18} /> פעילות בתקופה
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {/*
            משפך ולא ארבעה מספרים נפרדים. „נשלחו 40, נפתחו 12” הוא
            אותו נתון בדיוק — אבל בשלוש עמודות שמתקצרות רואים איפה
            הדליפה, ובארבעה ריבועים צריך לחשב אותה.
          */}
          <div className="mv-list-card px-5 py-4">
            <h3 className="m-0 mb-3" style={{ fontSize: "var(--type-button)", fontWeight: 700 }}>
              מסע ההצעה
            </h3>
            <BarChart
              slices={[
                { label: "נשלחו", value: stats.offers.sent, color: "var(--color-primary-accent)" },
                { label: "נפתחו", value: stats.offers.opened, color: "#4aa96c" },
                { label: "הביעו עניין", value: stats.offers.interested, color: "var(--color-action)" },
              ]}
            />
            <p className="m-0 mt-3" style={{ color: "var(--color-text-muted)" }}>
              שיעור פתיחה {stats.offerOpenRate}%
            </p>
          </div>
          <dl className="mv-stat-grid m-0">
            <StatCard icon={<IconSend s={18} />} label="הצעות שנשלחו" value={stats.offers.sent} />
            <StatCard icon={<IconEye s={18} />} label="הצעות שנפתחו" value={stats.offers.opened} />
            <StatCard icon={<IconThumbUp s={18} />} label="הביעו עניין" value={stats.offers.interested} tone={stats.offers.interested > 0 ? "success" : undefined} />
            <StatCard icon={<IconUser s={18} />} label="לידים שהומרו" value={stats.leads.converted} />
          </dl>
        </div>
      </section>

      {agents && agents.length > 0 ? (
        <section aria-labelledby="agents-heading">
          <h2 id="agents-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <IconUsers s={18} /> ביצועים לפי סוכן
          </h2>
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
                      <span className="flex items-center gap-2">
                        <span className="mv-avatar-dot" aria-hidden="true">
                          {agent.name.trim().slice(0, 1)}
                        </span>
                        <span>
                          <span className="font-medium">{agent.name}</span>
                          <span className="block" style={{ color: "var(--color-text-muted)" }}>
                            {roleLabel(agent.role)}
                          </span>
                        </span>
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
