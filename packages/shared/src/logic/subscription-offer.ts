/**
 * הצעות מנוי בלינק — עסקה שנסגרה בשיחה והופכת לתשלום בלחיצה.
 *
 * שני שימושים, מנגנון אחד:
 *
 * 1. **הצעה אישית** — מנהל הפלטפורמה תופר למשרד מסוים חבילה: מסלול
 *    בסיס, תוספות בתשלום (מספרי טלפון, הטמעה וכד'), תכונות שנפתחות
 *    מעבר למסלול, ומחיר סופי. הלינק חד-פעמי ונעול למשרד הזה.
 * 2. **לינק מכירה לחבילה** — סוכן מכירות שולח אחרי שיחה לינק שפותח
 *    דף תשלום על מסלול קיים. כל משרד מחובר יכול לממש, גם כשמסלול
 *    אינו מוצג בפומבי — יצירת הלינק היא ההרשאה.
 *
 * הקובץ הזה לא נוגע בבסיס נתונים ולא בסולק: הוא מגדיר מה הצעה
 * תקפה, כמה גובים עליה, ואיך מסבירים דחייה — שלוש שאלות שנשאלות
 * גם ביצירה (מסך הפלטפורמה), גם בצפייה (דף הלקוח) וגם בפתיחת
 * התשלום (השרת). שלושה עותקים של התשובות היו נפרדים בשקט.
 */

import {
  effectiveCyclePriceAgorot,
  isBillingCycle,
  type BillingCycle,
  type TenantPriceOverride,
} from "./billing.js";
import type { PlanDefinition } from "./plans.js";
import { formatIsraeliNumber } from "./israel-time.js";

/** custom = הצעה אישית למשרד; plan_link = לינק מכירה לחבילה קיימת. */
export type OfferKind = "custom" | "plan_link";

export function isOfferKind(value: string): value is OfferKind {
  return value === "custom" || value === "plan_link";
}

/** שורת תוספת בהצעה — "2 מספרי טלפון", "הטמעה" וכד'. */
export interface OfferLineItem {
  label: string;
  amountAgorot: number;
}

/*
 * גבולות שפיות, לא מדיניות מחירים — כמו בקטלוג המסלולים. התקרה על
 * מחיר ההצעה זהה לזו של מחיר מסלול, כדי ששני המסכים ידחו את אותה
 * טעות הקלדה.
 */
export const MAX_OFFER_LINE_ITEMS = 12;
export const MAX_OFFER_ITEM_LABEL = 80;
export const MAX_OFFER_PRICE_AGOROT = 100_000_000;
export const MAX_OFFER_NOTE = 500;

/** ההצעה כפי שהיא שמורה — מה שכל הבדיקות כאן מקבלות. */
export interface SubscriptionOfferDefinition {
  id: string;
  token: string;
  kind: OfferKind;
  /** ההצעה נעולה למשרד הזה; null = כל משרד מחובר (לינק מכירה). */
  tenantId: string | null;
  planCode: string;
  billingCycle: BillingCycle;
  /** המחיר הסופי למחזור, באגורות. null = מחיר המסלול הרגיל. */
  priceAgorot: number | null;
  lineItems: OfferLineItem[];
  /** תכונות שנפתחות למשרד עם התשלום, מעבר למסלול. */
  featureGrants: string[];
  /** הערה חופשית שמוצגת ללקוח בדף ההצעה. */
  note: string;
  /** null = בלי הגבלת מימושים. */
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * ניקוי שורות התוספת שהגיעו מבחוץ — מהמסך או מעמודת JSON.
 *
 * שורה שאינה במבנה נזרקת ולא "מתוקנת": תווית ריקה או סכום שאינו
 * מספר שלם הם טעות הזנה, ושמירה שלהם הייתה מציגה ללקוח שורת חיוב
 * שאי אפשר לקרוא. סכום אפס תקין — "כלול במחיר" הוא שורה לגיטימית.
 */
export function sanitizeOfferLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return [];
  const items: OfferLineItem[] = [];
  for (const raw of input) {
    if (items.length >= MAX_OFFER_LINE_ITEMS) break;
    if (typeof raw !== "object" || raw === null) continue;
    const label = typeof (raw as { label?: unknown }).label === "string"
      ? ((raw as { label: string }).label).trim()
      : "";
    const amount = (raw as { amountAgorot?: unknown }).amountAgorot;
    if (label === "" || label.length > MAX_OFFER_ITEM_LABEL) continue;
    if (typeof amount !== "number" || !Number.isInteger(amount)) continue;
    if (amount < 0 || amount > MAX_OFFER_PRICE_AGOROT) continue;
    items.push({ label, amountAgorot: amount });
  }
  return items;
}

/** סך התוספות — למסך היצירה, שמציע מחיר סופי של בסיס + תוספות. */
export function offerLineItemsTotalAgorot(items: readonly OfferLineItem[]): number {
  return items.reduce((sum, item) => sum + item.amountAgorot, 0);
}

/**
 * כמה גובים על ההצעה בפועל, למחזור אחד.
 *
 * המחיר הסופי שנקבע בהצעה גובר על הכול — זו כל מהותו. בלעדיו נופלים
 * למחיר של המשרד: המחיר המוסכם אם סוכם כזה, אחרת מחיר המסלול. אותו
 * סדר עדיפויות בדיוק כמו בחידוש האוטומטי, כי הסכום שנגבה בלינק הוא
 * ההבטחה למה שייגבה בכל חודש שאחריו.
 *
 * `null` = אין סכום לגבות (מסלול בלי מחיר במחזור הזה ובלי מחיר
 * בהצעה) — הצעה כזו נדחית ביצירה, אבל הבדיקה כאן שוב כי הקטלוג
 * יכול היה להשתנות מאז.
 */
export function offerAmountAgorot(
  offer: Pick<SubscriptionOfferDefinition, "priceAgorot" | "billingCycle">,
  plan: PlanDefinition | undefined,
  override?: TenantPriceOverride,
): number | null {
  if (offer.priceAgorot !== null) return offer.priceAgorot;
  if (plan === undefined) return null;
  const agorot = effectiveCyclePriceAgorot(plan, offer.billingCycle, override);
  return agorot !== null && agorot > 0 ? agorot : null;
}

/** למה אי אפשר לממש את ההצעה — קוד מכונה; הנוסח למשתמש נפרד. */
export type OfferRejection =
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "wrong_tenant";

/**
 * האם ההצעה ניתנת למימוש עכשיו, על ידי המשרד הזה.
 *
 * ‎**`wrong_tenant` מיד אחרי „לא קיים”, לפני כל מצב אחר.**
 *
 * הנוסח שלו זהה ל-`not_found` כדי שמי שהגיע ללינק של משרד אחר לא
 * ילמד ממנו דבר — אבל נוסח זהה אינו שווה דבר אם בדיקה מוקדמת יותר
 * עונה קודם. לינק אישי שבוטל, פג או מוצה, שהגיע לזר, החזיר לו
 * „ההצעה בוטלה”: זו כבר הודעה שאומרת „הטוקן הזה שייך להצעה
 * אמיתית”, ומוסיפה את מצבה. ההגנה הייתה בניסוח בלבד, והסדר עקף
 * אותה (ביקורת Codex).
 *
 * שאלת השייכות קודמת לשאלת המצב: למי שאינו בעל ההצעה אין מצב
 * לדווח עליו.
 *
 * בין שלושת המצבים הסדר מכוון ונשאר: ביטול לפני תפוגה לפני מכסה —
 * מי שקיבל לינק שבוטל צריך לשמוע „ההצעה בוטלה” ולא „פג תוקפה”, כי
 * התגובה הנכונה שונה (לבקש הצעה חדשה מול לבקש הארכה).
 */
export function offerRejection(
  offer: SubscriptionOfferDefinition | null | undefined,
  ctx: { tenantId: string; now: Date },
): OfferRejection | null {
  if (!offer) return "not_found";
  if (offer.tenantId !== null && offer.tenantId !== ctx.tenantId) return "wrong_tenant";
  if (offer.revokedAt !== null) return "revoked";
  if (offer.expiresAt !== null && offer.expiresAt.getTime() <= ctx.now.getTime()) {
    return "expired";
  }
  if (offer.maxRedemptions !== null && offer.redemptions >= offer.maxRedemptions) {
    return "exhausted";
  }
  return null;
}

/** הנוסח למשתמש — מה שמוצג בדף ההצעה כשאי אפשר לממש. */
export function describeOfferRejection(rejection: OfferRejection): string {
  switch (rejection) {
    case "revoked":
      return "ההצעה בוטלה — פנו אלינו לקבלת הצעה מעודכנת";
    case "expired":
      return "תוקף ההצעה פג — פנו אלינו לקבלת הצעה מעודכנת";
    case "exhausted":
      return "ההצעה כבר מומשה במלואה";
    /*
     * לינק לא קיים ולינק של משרד אחר מקבלים אותו נוסח בכוונה —
     * ההבדל ביניהם הוא מידע על הצעה של מישהו אחר.
     */
    case "not_found":
    case "wrong_tenant":
      return "הלינק אינו תקף — בדקו שהועתק במלואו, או פנו אלינו";
  }
}

/** מה שנדרש כדי ליצור הצעה — הקלט של מסך הפלטפורמה. */
export interface OfferDraft {
  kind: OfferKind;
  tenantId: string | null;
  planCode: string;
  billingCycle: string;
  priceAgorot: number | null;
  lineItems: OfferLineItem[];
  maxRedemptions: number | null;
  expiresAt: Date | null;
}

/**
 * למה אי אפשר ליצור את ההצעה — הודעה בעברית, או `null` כשהיא תקינה.
 *
 * הבדיקה מול המסלול **בזמן היצירה** ולא רק במימוש: לינק שנשלח
 * ללקוח ונדחה כשהוא לוחץ הוא מכירה שנשרפה. עדיף שהטעות תיעצר מול
 * מנהל הפלטפורמה, שיכול לתקן אותה.
 *
 * ‎**`override` הוא המחיר המוסכם של משרד היעד, ונדרש כדי שהשער הזה
 * ישאל את אותה שאלה שהמימוש ישאל.** בהצעה אישית יש משרד ידוע, ולכן
 * גם מחיר מוסכם אפשרי; בלינק מכירה אין. שער שבודק רק את המחירון
 * חוסם בדיוק את המקרה שהחריגה נועדה לו — מסלול „לפי הצעה” שהמחיר
 * היחיד שלו הוא זה שסוכם.
 */
export function offerCreationRejection(
  draft: OfferDraft,
  plan: PlanDefinition | undefined,
  ctx: { override?: TenantPriceOverride; now: Date },
): string | null {
  if (!plan) return "המסלול אינו קיים";
  if (!isBillingCycle(draft.billingCycle)) return "מחזור חיוב לא מוכר";
  if (draft.kind === "custom" && draft.tenantId === null) {
    return "הצעה אישית חייבת משרד יעד";
  }
  if (draft.priceAgorot !== null) {
    if (
      !Number.isInteger(draft.priceAgorot) ||
      draft.priceAgorot < 1 ||
      draft.priceAgorot > MAX_OFFER_PRICE_AGOROT
    ) {
      return "המחיר הסופי חייב להיות סכום חיובי";
    }
  } else {
    /*
     * בלי מחיר בהצעה נופלים למחיר שהמשרד באמת ישלם — והוא חייב
     * להתקיים במחזור הזה. מסלול חינמי בלי מחיר סופי ובלי מחיר מוסכם
     * היה יוצר לינק שכל לחיצה עליו נדחית.
     *
     * ‎`effectiveCyclePriceAgorot` ולא `cyclePriceAgorot`: זו הפונקציה
     * שהמימוש מריץ, ושער שמחשב אחרת מהמימוש דוחה הצעות שהיו נפרעות
     * בלי בעיה.
     */
    const base = effectiveCyclePriceAgorot(plan, draft.billingCycle, ctx.override);
    if (base === null || base <= 0) {
      return "למסלול אין מחיר במחזור הזה — יש לקבוע מחיר סופי להצעה";
    }
  }
  if (draft.lineItems.length > MAX_OFFER_LINE_ITEMS) {
    return `אפשר עד ${MAX_OFFER_LINE_ITEMS} שורות תוספת`;
  }
  if (draft.maxRedemptions !== null && draft.maxRedemptions < 1) {
    return "מגבלת המימושים חייבת להיות חיובית";
  }
  /*
   * תפוגה שכבר חלפה — נעצרת כאן ולא בלחיצה של הלקוח. `offerRejection`
   * דוחה אותה במימוש, ולכן בלי הבדיקה הזו טעות הקלדה בתאריך מייצרת
   * לינק שנראה תקין, נשלח, ונדחה ברגע שנפתח (ביקורת Codex). אותו
   * היגיון כמו שאר הבדיקות כאן: מוטב שהטעות תיעצר מול מי שיכול
   * לתקן אותה.
   */
  if (draft.expiresAt !== null && draft.expiresAt.getTime() <= ctx.now.getTime()) {
    return "תאריך התפוגה כבר עבר";
  }
  return null;
}

/** "‎249 ₪ לחודש" — לתצוגת ההצעה, בלי לחשב בדפדפן. */
export function describeOfferPrice(amountAgorot: number, cycle: BillingCycle): string {
  const shekels = amountAgorot / 100;
  const rounded = Number.isInteger(shekels) ? shekels : Number(shekels.toFixed(2));
  return `${formatIsraeliNumber(rounded)} ₪ ${cycle === "yearly" ? "לשנה" : "לחודש"}`;
}
