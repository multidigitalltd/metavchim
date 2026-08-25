"use client";

import {
  APPOINTMENT_KIND_LABELS,
  COOP_DEAL_STAGE_LABELS,
  agentResultList,
  isAggregateResult,
  officeReportStats,
  type CoopDealStage,
} from "@metavchim/shared";
import { formatPrice } from "@/lib/format";
import {
  IconCalendar,
  IconCheck,
  IconCloudSun,
  IconFlame,
  IconHandshake,
  IconHome,
  IconPhone,
  IconSnow,
  IconUser,
} from "../icons";

/**
 * התשובה לשאילתה — **כאן, ולא במסך אחר.**
 *
 * מתווך ששאל „מי מחפש 4 חדרים בגבעתיים” רוצה את השמות, לא ניווט
 * לרשימת הקונים עם מסננים שהוא צריך לפענח. הקישור למסך המלא נשאר
 * לצדה, למי שרוצה להמשיך לעבוד שם.
 *
 * הרשימה חתוכה ל-50, ו-`hasMore` נאמר במפורש: „נמצאו 50” כשיש
 * יותר הוא שקר שקט.
 */

interface BuyerRow {
  id: string;
  name: string;
  cities: string[];
  maturity: string;
  roomsMin?: number;
  roomsMax?: number;
  budgetMaxAgorot?: number;
}

interface PropertyRow {
  id: string;
  title: string;
  city: string | null;
  rooms: number | null;
  priceAgorot: number | null;
  status: string;
}

const MATURITY_ICON: Record<string, React.JSX.Element> = {
  very_hot: <IconFlame s={15} />,
  hot: <IconFlame s={15} />,
  interested: <IconCloudSun s={15} />,
  not_ripe: <IconSnow s={15} />,
};

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  startsAt: string;
  status: string;
}

interface TaskRow {
  id: string;
  title: string;
  dueAt?: string;
  entityLabel?: string;
}

/** שורה ברשימת „למי לחזור” — האדם, המספר, והסיבה. */
interface CallbackRow {
  contactId: string;
  name: string;
  /** `null` = אין מספר בכרטיס. השורה נשארת, עם אמירה מפורשת. */
  phone: string | null;
  reasonText: string;
  waitedText: string;
  href: string;
  detail?: string;
  alsoCount: number;
}

interface CallRow {
  id: string;
  direction: "inbound" | "outbound";
  contactName?: string;
  phone?: string;
  occurredAt: string;
  outcome: string;
  summary?: string;
}

interface DealRow {
  id: string;
  title: string;
  stage: string;
  counterpartOffice: string;
  lastActivityAt: string;
}

/*
 * התוויות מגיעות מהלוגיקה המשותפת, ולא נכתבות כאן.
 *
 * שתי המפות היו מקומיות, ו-`DEAL_STAGE` כבר **הספיקה להתפצל**:
 * מסך העסקה המשותפת אומר „לא יצא לפועל”, והפאנל הזה אמר „בוטל”
 * על אותו שלב בדיוק. אותו סוכן, שתי תשובות.
 */

function whenText(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export function AgentResults({ data }: { data: unknown }): React.JSX.Element | null {
  if (typeof data !== "object" || data === null) return null;
  const payload = data as {
    hasMore?: boolean;
    buyers?: BuyerRow[];
    properties?: PropertyRow[];
    appointments?: AppointmentRow[];
    tasks?: TaskRow[];
    callbacks?: CallbackRow[];
    calls?: CallRow[];
    deals?: DealRow[];
    matches?: unknown[];
    report?: unknown;
  };

  /*
   * **תוצאת חיפוש כללי — לפני כל מקטע בודד.**
   *
   * `SearchService.search` מחזירה תמיד את כל המקטעים, כולל הריקים,
   * ולכן שרשרת התנאים שלמטה זיהתה כל חיפוש כרשימת פגישות ריקה
   * וענתה „אין פגישות”. אותו באג בדיוק היה בצד וואטסאפ, ולכן
   * ההכרעה עצמה משותפת (`isAggregateResult`) ולא נכתבת כאן שוב.
   *
   * הרשימה המאוחדת מרונדרת מהשורות המשותפות — היא חוצה סוגים,
   * ולכן אין לה JSX ייעודי. מקטע יחיד ממשיך לתצוגה העשירה שלו.
   */
  if (isAggregateResult(data)) {
    return <SharedRows data={data} empty="לא נמצא כלום" />;
  }

  /*
   * התאמות — הצורה היחידה שלא הוצגה כאן **בכלל**. הן חוצות סוגים
   * (קונים לנכס, נכסים לקונה), ולכן הן מרונדרות מהשורות המשותפות
   * ולא מ-JSX ייעודי.
   */
  if (Array.isArray(payload.matches)) {
    return <SharedRows data={data} empty="אין התאמות פעילות" />;
  }

  if (Array.isArray(payload.appointments)) {
    return (
      <ResultList
        hasMore={false}
        count={payload.appointments.length}
        noun="פגישות"
        empty="אין פגישות ביום הזה"
      >
        {payload.appointments.map((a) => (
          <li key={a.id} className="mv-result-row">
            <a href="/calendar" className="font-medium underline">
              <IconCalendar s={15} /> {a.title || APPOINTMENT_KIND_LABELS[a.kind] || "פגישה"}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>{whenText(a.startsAt)}</span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (Array.isArray(payload.tasks)) {
    return (
      <ResultList
        hasMore={false}
        count={payload.tasks.length}
        noun="משימות פתוחות"
        empty="אין משימות פתוחות"
      >
        {payload.tasks.map((t) => (
          <li key={t.id} className="mv-result-row">
            <a href="/tasks" className="font-medium underline">
              <IconCheck s={15} /> {t.title}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              {[t.entityLabel ?? null, t.dueAt === undefined ? null : whenText(t.dueAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (Array.isArray(payload.callbacks)) {
    return (
      <ResultList
        hasMore={false}
        count={payload.callbacks.length}
        noun="ממתינים לחזרה"
        empty="אין כרגע אף אחד שממתין לחזרה"
      >
        {payload.callbacks.map((row) => (
          <li key={row.contactId} className="mv-result-row">
            <a href={row.href} className="font-medium underline">
              <IconPhone s={15} /> {row.name}
            </a>
            {/*
              המספר הוא קישור חיוג ולא טקסט.
              המתווך ביקש „מספרים שצריך לחזור אליהם”; מספר שאי אפשר
              ללחוץ עליו משאיר אותו בדיוק במקום שבו התחיל — במיוחד
              בטלפון, שם `tel:` פותח את החייגן.
            */}
            {row.phone === null ? (
              <span style={{ color: "var(--color-text-muted)" }}>אין מספר בכרטיס</span>
            ) : (
              <a href={`tel:${row.phone}`} dir="ltr" className="font-medium underline">
                {row.phone}
              </a>
            )}
            <span style={{ color: "var(--color-text-muted)" }}>
              {[
                row.reasonText,
                row.waitedText,
                row.alsoCount > 0 ? `+${row.alsoCount} בכרטיס` : null,
                row.detail ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (Array.isArray(payload.calls)) {
    return (
      <ResultList
        hasMore={false}
        count={payload.calls.length}
        noun="שיחות"
        empty="אין שיחות אחרונות"
      >
        {payload.calls.map((c) => (
          <li key={c.id} className="mv-result-row">
            <a href="/calls" className="font-medium underline">
              <IconPhone s={15} /> {c.contactName || c.phone || "מספר חסוי"}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              {[
                c.direction === "inbound" ? "נכנסת" : "יוצאת",
                whenText(c.occurredAt),
                c.summary ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (Array.isArray(payload.deals)) {
    return (
      <ResultList
        hasMore={false}
        count={payload.deals.length}
        noun="עסקאות משותפות"
        empty="אין עסקאות משותפות"
      >
        {payload.deals.map((d) => (
          <li key={d.id} className="mv-result-row">
            <a href={`/collaboration/deals/${d.id}`} className="font-medium underline">
              <IconHandshake s={15} /> {d.title}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              {[COOP_DEAL_STAGE_LABELS[d.stage as CoopDealStage] ?? d.stage, d.counterpartOffice].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (typeof payload.report === "object" && payload.report !== null) {
    /*
     * אילו מדדים, באיזה סדר ובאילו שמות — בלוגיקה המשותפת, כדי
     * שהסוכן בוואטסאפ ימסור בדיוק את אותו דוח.
     */
    const stats = officeReportStats(payload.report);
    return (
      <ul className="flex flex-col gap-2">
        {stats
          .map(({ label, value }) => (
            <li key={label} className="mv-result-row">
              <span className="font-medium">{label}</span>
              <span style={{ color: "var(--color-text-muted)" }}>{value}</span>
            </li>
          ))}
        <li className="mv-result-row">
          <a href="/reports" className="font-medium underline">
            לדוח המלא
          </a>
        </li>
      </ul>
    );
  }

  if (Array.isArray(payload.buyers)) {
    return (
      <ResultList
        hasMore={payload.hasMore === true}
        count={payload.buyers.length}
        noun="קונים"
        empty="לא נמצאו קונים שמתאימים לקריטריונים"
      >
        {payload.buyers.map((buyer) => (
          <li key={buyer.id} className="mv-result-row">
            <a href={`/buyers/${buyer.id}`} className="font-medium underline">
              {MATURITY_ICON[buyer.maturity] ?? <IconUser s={15} />} {buyer.name}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              {[
                roomsText(buyer.roomsMin, buyer.roomsMax),
                buyer.cities.join(" / ") || null,
                buyer.budgetMaxAgorot === undefined
                  ? null
                  : `עד ${formatPrice(buyer.budgetMaxAgorot)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  if (Array.isArray(payload.properties)) {
    return (
      <ResultList
        hasMore={payload.hasMore === true}
        count={payload.properties.length}
        noun="נכסים"
        empty="אין נכסים שעונים על התנאים"
      >
        {payload.properties.map((property) => (
          <li key={property.id} className="mv-result-row">
            <a href={`/properties/${property.id}`} className="font-medium underline">
              <IconHome s={15} /> {property.title || "נכס"}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              {[
                property.rooms === null ? null : `${property.rooms} חדרים`,
                property.city,
                property.priceAgorot === null ? null : formatPrice(property.priceAgorot),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ResultList>
    );
  }

  return null;
}

/**
 * רשימה שנבנתה מהשורות המשותפות — לצורות שאין להן JSX ייעודי.
 *
 * אלה הצורות שחוצות סוגים: תוצאת חיפוש כללי והתאמות. הכותרת,
 * הפרטים והקישור נגזרים ב-`agentResultList`, בדיוק כמו בוואטסאפ —
 * ולכן שתי התשובות זהות בתוכן ונבדלות רק בצורה.
 */
function SharedRows({ data, empty }: { data: unknown; empty: string }): React.JSX.Element | null {
  const list = agentResultList(data);
  if (list === null) return null;
  return (
    <ResultList hasMore={list.hasMore} count={list.rows.length} noun={list.noun} empty={empty}>
      {list.rows.map((row, index) => (
        <li key={`${row.href ?? row.label}-${index}`} className="mv-result-row">
          {row.href === undefined ? (
            <span className="font-medium">{row.label}</span>
          ) : (
            <a href={row.href} className="font-medium underline">
              {row.label}
            </a>
          )}
          <span style={{ color: "var(--color-text-muted)" }}>
            {[row.detail, row.phone].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ResultList>
  );
}

function ResultList({
  hasMore,
  count,
  noun,
  empty,
  children,
}: {
  hasMore: boolean;
  count: number;
  noun: string;
  empty: string;
  children: React.ReactNode;
}): React.JSX.Element {
  if (count === 0) {
    return (
      <p className="text-[15px]" style={{ color: "var(--color-text-muted)" }}>
        {empty}
      </p>
    );
  }
  return (
    <>
      <p className="mb-2 text-[15px] font-medium">
        {hasMore
          ? `מוצגים ${count} ${noun} ראשונים — יש עוד`
          : `נמצאו ${count} ${noun}`}
      </p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </>
  );
}

function roomsText(min?: number, max?: number): string | null {
  if (min === undefined) return null;
  if (max !== undefined && max !== min) return `${min}–${max} חדרים`;
  return `${min} חדרים`;
}
