"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { EntityTabs, TabPanel, useEntityTab } from "../entity-tabs";
import { IconBell, IconChat, IconCheck, IconEye, IconSparkle, IconStar, IconUsers, IconGear } from "../icons";
import { Calculators } from "./forum-calculators";
import { FollowingPanel } from "./forum-following";
import { ListingDirectory } from "./forum-listings";
import { ThreadList } from "./forum-threads";

/**
 * הפורום המקצועי — המסך שמאחורי ההבטחה שהייתה כאן כ„בקרוב” (docs/14).
 *
 * חמש לשוניות: השאלות והדיונים, השאלות האנונימיות בנפרד (כי זה
 * הפיצ'ר), הכלים, בעלי המקצוע, ומה שאני עוקב/ת אחריו. הלשונית
 * נשמרת בכתובת, כדי שקישור „לפורום, לכלים” יוביל לכלים.
 */

const TABS = [
  { key: "threads", label: "שאלות ודיונים" },
  { key: "anonymous", label: "בעילום שם" },
  { key: "tools", label: "כלים" },
  { key: "pros", label: "בעלי מקצוע" },
  { key: "following", label: "עוקב/ת" },
] as const;
const TAB_KEYS = TABS.map((t) => t.key);

interface Summary {
  threads: number;
  answered: number;
  repliesThisWeek: number;
  following: number;
}

export default function ForumPage() {
  const { loading } = useRequireAuth();
  const hasWhatsapp = useFeature("voice_intake");
  const [tab, setTab] = useEntityTab([...TAB_KEYS], "threads");
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (loading) return;
    apiGet<Summary>("/forum/summary").then(setSummary).catch(() => undefined);
  }, [loading, tab]);

  if (loading) return null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page py-6">
      <header className="mv-hero">
        <span className="mv-hero-icon" aria-hidden="true"><IconUsers s={26} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">
            הפורום המקצועי
            <span
              className="mx-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 align-middle text-[length:var(--type-body-sm)] font-extrabold"
              style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
            >
              <IconEye s={14} /> גם בעילום שם
            </span>
          </h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            מתווכים מכל הארץ, במקום אחד — שאלות שלא שואלים בקבוצה, תשובות שנשארות.
          </p>
        </div>
      </header>

      <dl className="mt-5 grid gap-3 sm:grid-cols-4">
        <Kpi domain="mv-domain-blue" icon={<IconChat s={16} />} label="שרשורים" value={summary?.threads} />
        <Kpi domain="mv-domain-green" icon={<IconCheck s={16} />} label="שאלות שנענו" value={summary?.answered} />
        <Kpi domain="mv-domain-amber" icon={<IconSparkle s={16} />} label="תגובות השבוע" value={summary?.repliesThisWeek} />
        <Kpi domain="mv-domain-violet" icon={<IconBell s={16} />} label="שיחות במעקב שלי" value={summary?.following} />
      </dl>

      <div className="mt-5">
        <EntityTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} active={tab} onSelect={setTab} label="לשוניות הפורום" />
      </div>

      <div className="mt-4">
        <TabPanel tab="threads" active={tab}>
          <ThreadList />
        </TabPanel>
        <TabPanel tab="anonymous" active={tab}>
          <ThreadList anonymousOnly />
        </TabPanel>
        <TabPanel tab="tools" active={tab}>
          <section aria-labelledby="calc-heading" className="mb-6">
            <div className="mv-card-head mb-3">
              <span className="mv-tile mv-domain-green" aria-hidden="true"><IconGear s={19} /></span>
              <h2 id="calc-heading" className="mv-card-head__title m-0">מחשבוני המקצוע</h2>
            </div>
            <Calculators />
          </section>
          <section aria-labelledby="tools-heading">
            <div className="mv-card-head mb-3">
              <span className="mv-tile mv-domain-blue" aria-hidden="true"><IconStar s={19} /></span>
              <h2 id="tools-heading" className="mv-card-head__title m-0">כלים שהקהילה ממליצה עליהם</h2>
            </div>
            <ListingDirectory kind="tool" />
          </section>
        </TabPanel>
        <TabPanel tab="pros" active={tab}>
          <ListingDirectory kind="pro" />
        </TabPanel>
        <TabPanel tab="following" active={tab}>
          <FollowingPanel hasWhatsapp={hasWhatsapp} />
        </TabPanel>
      </div>
    </div>
  );
}

function Kpi({ domain, icon, label, value }: { domain: string; icon: React.ReactNode; label: string; value: number | undefined }) {
  const zero = value === undefined || value === 0;
  return (
    <div className={`mv-kpi mv-kpi--static mv-kpi--compact ${zero ? "mv-domain-neutral" : domain}`}>
      <dt className="mv-kpi__head">
        <span className="mv-kpi__label">{label}</span>
        <span className="mv-tile" aria-hidden="true">{icon}</span>
      </dt>
      <dd className="mv-kpi__value mv-ltr m-0">{value === undefined ? "…" : value}</dd>
    </div>
  );
}
