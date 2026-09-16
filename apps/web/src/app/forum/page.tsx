"use client";

import { useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { EntityTabs, TabPanel, useEntityTab } from "../entity-tabs";
import { IconBell, IconChat, IconGear, IconStar, IconUsers } from "../icons";
import { Calculators } from "./forum-calculators";
import { FollowingPanel } from "./forum-following";
import { ListingDirectory } from "./forum-listings";
import { ThreadList } from "./forum-threads";

/**
 * הפורום המקצועי — המסך שמאחורי ההבטחה שהייתה כאן כ„בקרוב” (docs/16).
 *
 * ארבע לשוניות: השאלות והדיונים, הכלים, בעלי המקצוע, ומה שאני
 * עוקב/ת אחריו. הלשונית נשמרת בכתובת, כדי שקישור „לפורום, לכלים”
 * יוביל לכלים.
 *
 * ‎**בלי לשונית „בעילום שם” ובלי מונים** (החלטת בעל המוצר): עילום
 * שם הוא אפשרות בפרסום ובתגובה, לא מדור; ארבעת המונים שהיו כאן
 * ("שרשורים 0") אמרו על פורום צעיר רק שהוא ריק. הלשוניות הן
 * הניווט הראשי של המסך, ולכן גדולות מברירת המחדל של כרטיס ישות.
 */

const TABS = [
  { key: "threads", label: "שאלות ודיונים", icon: <IconChat s={18} /> },
  { key: "tools", label: "כלים ומחשבונים", icon: <IconGear s={18} /> },
  { key: "pros", label: "בעלי מקצוע", icon: <IconStar s={18} /> },
  { key: "following", label: "במעקב שלי", icon: <IconBell s={18} /> },
] as const;
const TAB_KEYS = TABS.map((t) => t.key);

export default function ForumPage() {
  const { loading } = useRequireAuth();
  const hasWhatsapp = useFeature("voice_intake");
  const [tab, setTab] = useEntityTab([...TAB_KEYS], "threads");

  if (loading) return null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page py-6">
      <header className="mv-hero">
        <span className="mv-hero-icon" aria-hidden="true"><IconUsers s={26} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">הפורום המקצועי</h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            ידע מקצועי, שאלות ותשובות וכלי עבודה למתווכים — במקום אחד.
          </p>
        </div>
      </header>

      <div className="mv-forum-tabs mt-5">
        <EntityTabs
          tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
          active={tab}
          onSelect={setTab}
          label="לשוניות הפורום"
        />
      </div>

      <div className="mt-2">
        <TabPanel tab="threads" active={tab}>
          <ThreadList />
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
