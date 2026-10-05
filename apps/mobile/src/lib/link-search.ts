import { propertyAddressOr } from "@metavchim/shared";
import type { PickOption } from "@/components/LinkPicker";
import { apiGet, apiList } from "./api";
import type { BuyerRow, LeadRow, PropertyRow } from "./dtos";

/**
 * ‏מקורות הבחירה לקישורי הפגישה — אותם נתיבים כמו `link-pickers.tsx`
 * ‏ב-web: `/search?q=` לחיפוש, והרשימות האחרונות כשאין טקסט.
 */

const RECENT_LIMIT = 8;

/** ‏החלק מ-`SearchResults` (השרת) שהבוחרים צריכים. */
interface SearchSubset {
  properties: {
    id: string;
    city: string | null;
    street: string | null;
    houseNumber: string | null;
    neighborhood: string | null;
    marketingTitle: string | null;
  }[];
  buyers: { id: string; name: string; phone?: string }[];
  leads: { id: string; name: string; phone?: string }[];
}

export type PersonKind = "lead" | "buyer";

export interface PickedPerson extends PickOption {
  kind: PersonKind;
  phone?: string;
}

function propertyLabel(p: SearchSubset["properties"][number]): string {
  return propertyAddressOr(
    {
      street: p.street,
      houseNumber: p.houseNumber,
      neighborhood: p.neighborhood,
      city: p.city,
    },
    p.marketingTitle ?? "נכס ללא כתובת",
  );
}

export async function searchProperties(query: string): Promise<PickOption[]> {
  const res = await apiGet<SearchSubset>(
    `/search?q=${encodeURIComponent(query)}`,
  );
  return apiList(res.properties, "properties").map((p) => ({
    id: p.id,
    label: propertyLabel(p),
  }));
}

export async function recentProperties(): Promise<PickOption[]> {
  const res = await apiGet<{ items: PropertyRow[] }>(
    `/properties?limit=${RECENT_LIMIT}`,
  );
  return apiList(res.items, "items").map((p) => ({
    id: p.id,
    label: propertyAddressOr(
      {
        street: p.street,
        houseNumber: p.houseNumber,
        neighborhood: p.neighborhood,
        city: p.city,
      },
      "נכס ללא כתובת",
    ),
  }));
}

export async function searchPeople(query: string): Promise<PickedPerson[]> {
  const res = await apiGet<SearchSubset>(
    `/search?q=${encodeURIComponent(query)}`,
  );
  return [
    ...apiList(res.buyers, "buyers").map((b) => ({
      kind: "buyer" as const,
      id: b.id,
      label: b.name,
      sub: "לקוח",
      phone: b.phone,
    })),
    ...apiList(res.leads, "leads").map((l) => ({
      kind: "lead" as const,
      id: l.id,
      label: l.name,
      sub: "ליד",
      phone: l.phone,
    })),
  ];
}

/**
 * ‏האחרונים — שתי הרשימות במקביל, וכל אחת נופלת לריק בנפרד: סוכן
 * ‏בלי הרשאת צפייה בלידים עדיין צריך לראות את הלקוחות שלו.
 */
export async function recentPeople(): Promise<PickedPerson[]> {
  const [buyers, leads] = await Promise.all([
    apiGet<{ items: BuyerRow[] }>(`/buyers?limit=${RECENT_LIMIT}`)
      .then((r) => apiList(r.items, "items"))
      .catch(() => [] as BuyerRow[]),
    apiGet<{ items: LeadRow[] }>(`/leads?limit=${RECENT_LIMIT}`)
      .then((r) => apiList(r.items, "items"))
      .catch(() => [] as LeadRow[]),
  ]);
  return [
    ...buyers.map((b) => ({
      kind: "buyer" as const,
      id: b.id,
      label: b.contact.name,
      sub: "לקוח",
      phone: b.contact.phone,
    })),
    ...leads.map((l) => ({
      kind: "lead" as const,
      id: l.id,
      label: l.contact.name,
      sub: "ליד",
      phone: l.contact.phone,
    })),
  ];
}
