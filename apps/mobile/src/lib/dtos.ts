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
    entryType?: string;
    /** ‏ISO — רק ל-`by_date` */
    entryBy?: string;
    flexibilityNotes?: string;
    features: Record<string, "must" | "nice">;
  };
  financing: string;
  agentNotes?: string;
}

export interface MatchRow {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  property: { address: string; title?: string; priceAgorot?: number };
  /** ‏שם הקונה — רק כשיש הרשאה אליו; אחרת „קונה של סוכן אחר”. */
  buyerName: string | null;
}

/** ‏`OfferDto` — קישור שנוצר; `pending_approval` = טרם יצא בשום ערוץ. */
export interface OfferInfo {
  id: string;
  status: string;
  url: string;
  openCount: number;
}

export interface TaskRow {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: string;
  priority: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  assigneeName?: string;
  assignedByName?: string;
  automatic?: boolean;
  /** ‏השרת אומר; המסך לא מנחש. חסר בשרת ישן = מותר. */
  canEdit?: boolean;
  createdAt?: string;
}

export interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  buyerId?: string;
  startsAt: string;
  endsAt?: string;
  status: string;
  outcome?: string;
  notes?: string;
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
