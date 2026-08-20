"use client";

import { formatPrice } from "@/lib/format";
import { IconCloudSun, IconFlame, IconHome, IconSnow, IconUser } from "../icons";

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

export function AgentResults({ data }: { data: unknown }): React.JSX.Element | null {
  if (typeof data !== "object" || data === null) return null;
  const payload = data as {
    hasMore?: boolean;
    buyers?: BuyerRow[];
    properties?: PropertyRow[];
  };

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
