"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { FIELD_LABELS, MATURITY_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { DuplicateContacts } from "./duplicate-contacts";
import { SetupBanner } from "./setup-banner";
import { NowStamp } from "./now-stamp";

/**
 * דשבורד לפי קובץ העיצוב: ברכה עם תאריך, ארבעה כרטיסי מונים,
 * ולוח דו-טורי — "מה חשוב לעשות היום" (שורות ממוספרות) לצד
 * "היום ביומן" וכרטיס קידום הקליטה בקול.
 *
 * הפעולות נגזרות מהדאטה האמיתי (docs/06 §2): לידים שדורשים אדם,
 * המלצות עוזר המכירות, נכסים לא מושלמים וקונים חמים.
 */

interface PropertyRow {
  id: string;
  city?: string;
  street?: string;
  status?: string;
  readinessScore: number;
  missingFields: string[];
}

interface BuyerRow {
  id: string;
  contact: { name: string };
  maturity: string;
}

interface LeadRow {
  id: string;
  contact: { name: string };
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
}

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  status: string;
}

interface OfferRow {
  id: string;
  status: string;
  openCount: number;
}

const APPOINTMENT_KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

const timeFmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });

interface Recommendation {
  priority: number;
  type: string;
  title: string;
  body: string;
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

function recHref(rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    case "appointment":
      return "/calendar";
    default:
      return null;
  }
}

/** ברכה לפי שעת היום — הדשבורד בעיצוב פותח ב"בוקר טוב". */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

/* צבעי מספור השורות — הפלטה מקובץ העיצוב; ירוק הטקסט מועמק ל-AA */
const TONE = {
  danger: { bg: "#faf1ec", fg: "#b0512c" },
  green: { bg: "#E5FCEA", fg: "#0C6E34" },
  amber: { bg: "#f7efdd", fg: "#7a5c1f" },
  neutral: { bg: "#EDEFED", fg: "#3F4742" },
} as const;

interface TaskRow {
  key: string;
  tone: keyof typeof TONE;
  title: string;
  why: string;
  action: string;
  href: string | null;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canVoice = useFeature("voice_intake");
  const [properties, setProperties] = useState<PropertyRow[] | null>(null);
  const [buyers, setBuyers] = useState<BuyerRow[] | null>(null);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [today, setToday] = useState<AppointmentRow[] | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    apiGet<{ items: PropertyRow[] }>("/properties?limit=100")
      .then((r) => setProperties(r.items))
      .catch(() => setProperties([]));
    apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
      .then((r) => setBuyers(r.items))
      .catch(() => setBuyers([]));
    apiGet<{ items: LeadRow[] }>("/leads?limit=100")
      .then((r) => setLeads(r.items))
      .catch(() => setLeads([]));
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    apiGet<AppointmentRow[]>(`/appointments?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`)
      .then(setToday)
      .catch(() => setToday([]));
    apiGet<Recommendation[]>("/coach/recommendations")
      .then(setRecs)
      .catch(() => setRecs([]));
    apiGet<{ items: OfferRow[] }>("/offers")
      .then((r) => setOffers(r.items))
      .catch(() => setOffers([]));
  }, [authLoading, user]);

  if (authLoading || !user) return <p aria-live="polite">טוען…</p>;

  const urgentLeads = (leads ?? []).filter((l) => l.requiresHuman).slice(0, 2);
  const newLeads = (leads ?? []).filter((l) => l.status === "new" && !l.requiresHuman).slice(0, 2);
  const incomplete = (properties ?? []).filter((p) => p.readinessScore < 80).slice(0, 2);
  const hotBuyers = (buyers ?? [])
    .filter((b) => b.maturity === "very_hot" || b.maturity === "hot");
  const loading = properties === null || buyers === null || leads === null;

  const activeProps = (properties ?? []).filter(
    (p) => p.status === undefined || ["draft", "active", "on_hold"].includes(p.status),
  );
  const pendingOffers = (offers ?? []).filter((o) => o.status === "sent");
  const mullingOffer = pendingOffers.find((o) => o.openCount >= 2);

  /* ---- "מה חשוב לעשות היום": איחוד המקורות לרשימה ממוספרת אחת ---- */
  const tasks: TaskRow[] = [];
  const seen = new Set<string>();
  const push = (t: TaskRow): void => {
    if (t.href !== null && seen.has(t.href)) return;
    if (t.href !== null) seen.add(t.href);
    tasks.push(t);
  };
  for (const l of urgentLeads) {
    push({
      key: `urgent-${l.id}`,
      tone: "danger",
      title: `ליד דורש טיפול אנושי: ${l.contact.name}`,
      why: l.requiresHumanReason ?? "העוזר הדיגיטלי לא הצליח להתקדם לבד.",
      action: "טפל עכשיו",
      href: `/leads/${l.id}`,
    });
  }
  for (const rec of (recs ?? []).slice(0, 4)) {
    push({
      key: `rec-${rec.type}-${rec.entityId ?? ""}`,
      tone: rec.priority >= 90 ? "danger" : "green",
      title: rec.title,
      why: rec.body,
      action: "לפרטים",
      href: recHref(rec),
    });
  }
  for (const l of newLeads) {
    push({
      key: `new-${l.id}`,
      tone: "amber",
      title: `ליד חדש ממתין: ${l.contact.name}`,
      why: "מענה מהיר מכפיל את סיכוי ההמרה.",
      action: "פתח ליד",
      href: `/leads/${l.id}`,
    });
  }
  for (const p of incomplete) {
    push({
      key: `inc-${p.id}`,
      tone: "neutral",
      title: `${[p.street, p.city].filter(Boolean).join(", ") || "נכס ללא כתובת"} — מוכנות ${p.readinessScore}%`,
      why: `חסרים: ${p.missingFields.slice(0, 3).map((f) => FIELD_LABELS[f] ?? f).join(", ")}${p.missingFields.length > 3 ? " ועוד" : ""}. השלמה תפתח קונים חדשים.`,
      action: "השלם פרטים",
      href: `/properties/${p.id}/edit`,
    });
  }
  for (const b of hotBuyers.slice(0, 2)) {
    push({
      key: `hot-${b.id}`,
      tone: "green",
      title: `לבדוק התאמות עבור ${b.contact.name}`,
      why: `קונה ${MATURITY_LABELS[b.maturity] ?? b.maturity} — כדאי לוודא שקיבל הצעות רלוונטיות.`,
      action: "צפה בהתאמות",
      href: `/buyers/${b.id}`,
    });
  }
  const shownTasks = tasks.slice(0, 6);

  const todayEvents = (today ?? [])
    .filter((a) => a.status === "scheduled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);

  const statCards = [
    {
      label: "נכסים פעילים",
      value: properties === null ? undefined : activeProps.length,
      sub: incomplete.length > 0 ? `${incomplete.length} ממתינים להשלמת פרטים` : "כולם מוכנים לשיווק",
      href: "/properties",
      valueColor: undefined as string | undefined,
    },
    {
      label: "קונים חמים",
      value: buyers === null ? undefined : hotBuyers.length,
      sub: buyers === null ? "" : `מתוך ${buyers.length} קונים במאגר`,
      href: "/buyers",
      valueColor: "var(--color-danger)",
    },
    {
      label: "הצעות ממתינות למענה",
      value: offers === null ? undefined : pendingOffers.length,
      sub: mullingOffer !== undefined ? `אחת נפתחה ${mullingOffer.openCount} פעמים` : "",
      href: "/offers",
      valueColor: undefined,
    },
    {
      label: "לידים חדשים",
      value: leads === null ? undefined : leads.filter((l) => l.status === "new").length,
      sub: urgentLeads.length > 0 ? `${urgentLeads.length} דורשים טיפול אנושי` : "",
      href: "/leads",
      valueColor: undefined,
    },
  ];

  return (
    <>
      <SetupBanner />

      {/* ברכה + תאריך — בשורת בסיס אחת, כמו בעיצוב */}
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        {/* לועזי + עברי + שעון — מתווך ישראלי חי בשני לוחות */}
        <NowStamp />
      </div>

      <DuplicateContacts />

      <section aria-labelledby="counts-heading" className="mb-7">
        <h2 id="counts-heading" className="mv-visually-hidden">מונים</h2>
        <dl className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {statCards.map((card) => (
            <Link key={card.label} href={card.href} className="mv-stat-card no-underline">
              <dt className="text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                {card.label}
              </dt>
              <dd className="mv-stat-value m-0" style={card.valueColor ? { color: card.valueColor } : undefined}>
                {card.value ?? "…"}
              </dd>
              <dd className="m-0 text-[12.5px]" style={{ color: "var(--color-text-muted)", minHeight: "1.2em" }}>
                {card.sub}
              </dd>
            </Link>
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-6 lg:[grid-template-columns:1fr_340px]">
        {/* ---- מה חשוב לעשות היום ---- */}
        <section
          aria-labelledby="today-tasks-heading"
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div
            className="flex flex-wrap items-center gap-2.5 px-5 py-4"
            style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
          >
            <h2 id="today-tasks-heading" className="m-0" style={{ fontSize: 17, fontWeight: 800 }}>
              מה חשוב לעשות היום
            </h2>
            <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              מתעדכן לבד לפי המצב בשטח
            </span>
            {shownTasks.length > 0 ? (
              <span
                className="ms-auto rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
              >
                {shownTasks.length} פעולות
              </span>
            ) : null}
          </div>

          {loading ? (
            <p aria-live="polite" className="px-5 py-4">טוען…</p>
          ) : shownTasks.length === 0 ? (
            <p className="px-5 py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
              הכל מטופל ✓ — אפשר לקלוט נכס או קונה חדשים.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {shownTasks.map((t, index) => (
                <li
                  key={t.key}
                  className="flex items-center gap-3.5 px-5 py-3.5"
                  style={{ borderBottom: "1px solid var(--color-row-border)" }}
                >
                  <span
                    aria-hidden="true"
                    className="grid flex-none place-items-center text-[13px] font-extrabold"
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      background: TONE[t.tone].bg,
                      color: TONE[t.tone].fg,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0" style={{ lineHeight: 1.35 }}>
                    <span className="block text-[14.5px] font-bold">{t.title}</span>
                    <span className="block text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                      {t.why}
                    </span>
                  </span>
                  {t.href ? (
                    <Link
                      href={t.href}
                      className="ms-auto flex-none text-[13px] font-bold no-underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      {t.action}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- הטור הצדדי: היום ביומן + קליטה בקול ---- */}
        <div className="flex flex-col gap-4">
          <section
            aria-labelledby="today-heading"
            className="rounded-xl border px-5 py-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="mb-1 flex items-center">
              <h2 id="today-heading" className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
                היום ביומן
              </h2>
              <Link
                href="/calendar"
                className="ms-auto text-[12.5px] font-bold no-underline"
                style={{ color: "var(--color-primary)" }}
              >
                ליומן המלא
              </Link>
            </div>
            {todayEvents.length === 0 ? (
              <p className="m-0 py-2 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                אין פגישות מתוכננות להיום.
              </p>
            ) : (
              todayEvents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-baseline gap-3 py-2"
                  style={{ borderBottom: "1px solid var(--color-row-border)" }}
                >
                  <span
                    className="flex-none text-[13px] font-extrabold"
                    style={{ width: 40, color: "var(--color-primary)" }}
                  >
                    {timeFmt.format(new Date(a.startsAt))}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>
                    <span className="block text-[13.5px] font-bold">
                      {a.title ?? APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                    </span>
                    <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {APPOINTMENT_KIND_LABELS[a.kind] ?? a.kind}
                      {a.propertyId ? " · נכס" : a.leadId ? " · ליד" : ""}
                    </span>
                  </span>
                </div>
              ))
            )}
          </section>

          {/* קידום שמוביל לפיצ'ר שאינו במסלול נחסם בשרת — אין טעם
              להזמין אליו */}
          {canVoice ? (
            <section
              aria-labelledby="voice-promo-heading"
              className="rounded-xl p-[18px]"
              style={{ background: "#111513", color: "#dfe3e0" }}
            >
              <div className="mb-2 flex items-center gap-2">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#70EE91"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2.5" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
                  <line x1="12" y1="17.5" x2="12" y2="21" />
                </svg>
                <h2 id="voice-promo-heading" className="m-0 text-sm font-extrabold" style={{ color: "#fff" }}>
                  קלטו נכס בדיבור
                </h2>
              </div>
              <p className="m-0 text-[13px]" style={{ lineHeight: 1.5, color: "#aab3ad" }}>
                ״דירת 4 חדרים בהרצל 12 בית שמש, קומה 3, עם מעלית וחניה, 2.4 מיליון״ — פחות
                מדקה, וכרטיס הנכס מוכן.
              </p>
              <Link
                href="/voice"
                className="mt-3 block rounded-[9px] py-[9px] text-center text-[13.5px] font-bold no-underline"
                style={{ background: "#70EE91", color: "#0B1F12" }}
              >
                נסו עכשיו
              </Link>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
