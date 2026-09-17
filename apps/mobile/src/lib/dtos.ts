import type { PropertyStatus } from "@metavchim/shared";

/**
 * ‏צורות התשובה של ה-API — אותן הצהרות שהמסכים ב-web משתמשים בהן.
 * ‏`apiGet<T>` הוא הצהרה בלבד; מה שהשרת מחזיר נקבע אצלו.
 */

export interface LeadRow {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  sourceNote?: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  agentName?: string;
  createdAt: string;
}

export interface LeadDetail extends LeadRow {
  contact: { id: string; name: string; phone: string; email?: string; sharedTabu: boolean };
  requiresHumanReason?: string;
  summary?: string;
}

export interface TimelineItem {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
}

export interface PropertyRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  rooms?: number;
  priceAgorot?: number;
  status: PropertyStatus;
  readinessScore: number;
  agentName?: string;
  missingFields: string[];
  suggestedMatchCount?: number;
  createdAt?: string;
}

export interface PropertyDetail extends PropertyRow {
  dealType?: string;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  entryNote?: string;
  internalNotes?: string;
  marketingTitle?: string;
  ownerContact?: { id: string; name: string; phone: string };
  ownerRedacted?: boolean;
}

export interface BuyerRow {
  id: string;
  contact: { name: string; phone: string };
  requirements: {
    dealType?: string;
    cities: string[];
    budgetMinAgorot?: number;
    budgetMaxAgorot?: number;
    roomsMin?: number;
    roomsMax?: number;
  };
  maturity: string;
  agentName?: string;
  source: string;
  offersReceived?: number;
  lastActivityAt?: string;
}

export interface BuyerDetail extends BuyerRow {
  contact: { id: string; name: string; phone: string };
  requirements: BuyerRow["requirements"] & {
    neighborhoods: string[];
    propertyTypes: string[];
    areaSqmMin?: number;
    flexibilityNotes?: string;
    features: Record<string, "must" | "nice">;
  };
  financing: string;
}

export interface MatchRow {
  id: string;
  propertyId: string;
  score: number;
  explanation: string;
  status: string;
  property: { address: string; title?: string; priceAgorot?: number };
}

export interface TaskRow {
  id: string;
  title: string;
  dueAt?: string;
  status: string;
  priority: string;
  entityLabel?: string;
}

export interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  startsAt: string;
  status: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  readAt?: string;
  createdAt: string;
}
