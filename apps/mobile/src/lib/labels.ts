import {
  BUYER_SOURCE_LABELS,
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  LEAD_INTENT_LABELS,
  LEAD_STATUS_LABELS,
  MATURITY_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  leadSourceText,
} from "@metavchim/shared";
import type { Tone } from "@/components";

/** ‏תווית עברית לערך מהשרת; ערך שאינו ברשימה מוצג כמות שהוא. */
function labelOf(map: Record<string, string>, value: string | undefined): string {
  if (value === undefined) return "";
  return map[value] ?? value;
}

export const leadStatusLabel = (v: string) => labelOf(LEAD_STATUS_LABELS, v);
export const leadIntentLabel = (v: string) => labelOf(LEAD_INTENT_LABELS, v);
export const leadSourceLabel = (source: string, note?: string) => leadSourceText(source, note);
export const maturityLabel = (v: string) => labelOf(MATURITY_LABELS, v);
export const buyerSourceLabel = (v: string) => labelOf(BUYER_SOURCE_LABELS, v);
export const financingLabel = (v: string) => labelOf(FINANCING_LABELS, v);
export const propertyStatusLabel = (v: string) => labelOf(PROPERTY_STATUS_LABELS, v);
export const propertyTypeLabel = (v: string | undefined) => labelOf(PROPERTY_TYPE_LABELS, v);
export const dealTypeLabel = (v: string | undefined) => labelOf(DEAL_TYPE_LABELS, v);

/* ‏אותה משפחת צבעים כמו הגלולות ב-web */
export function leadStatusTone(status: string): Tone {
  switch (status) {
    case "new":
      return "success";
    case "in_progress":
    case "waiting_customer":
      return "amber";
    default:
      return "neutral";
  }
}

export function maturityTone(maturity: string): Tone {
  switch (maturity) {
    case "very_hot":
      return "danger";
    case "hot":
      return "amber";
    case "interested":
      return "success";
    default:
      return "neutral";
  }
}

export function propertyStatusTone(status: string): Tone {
  switch (status) {
    case "active":
      return "success";
    case "draft":
    case "on_hold":
      return "amber";
    default:
      return "neutral";
  }
}

export const TASK_PRIORITY_TONE: Record<string, Tone> = {
  high: "danger",
  normal: "neutral",
  low: "neutral",
};
