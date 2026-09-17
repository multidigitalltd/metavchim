import { PURCHASE_TAX_ADDITIONAL_HOME, PURCHASE_TAX_SINGLE_HOME, PURCHASE_TAX_YEAR, type TaxBracket } from "./forum.js";

/**
 * ‏מס שבח על דירת מגורים — הערכה למתווך, לא שומה.
 *
 * ‏מה מחושב כאן, ובאילו כללים:
 * - ‏**השבח הנומינלי** = מחיר המכירה פחות שווי הרכישה וההוצאות
 *   ‏המוכרות (עו״ד, תיווך, מס רכישה, שיפוץ).
 * - ‏**השבח האינפלציוני** (עליית המדד על שווי הרכישה) פטור — המשתמש
 *   ‏מזין את שיעור עליית המדד בין התאריכים, כי המדד אינו זמין כאן.
 * - ‏**חישוב ליניארי מוטב**: החלק מהשבח הריאלי המיוחס לתקופה שעד
 *   ‏31.12.2013 פטור; היתר חייב ב-25%.
 * - ‏**דירה יחידה**: פטור מלא עד תקרת הפטור (מתעדכנת מדי ינואר); מעל
 *   ‏התקרה — החלק היחסי שמעל התקרה חייב, ועליו חל החישוב הליניארי.
 *
 * ‏מה לא נמצא כאן, בכוונה: פחת, הוצאות מימון, דירה שאינה „דירת
 * ‏מגורים מזכה”, ירושה ומתנה, ותנאי הפטור (מכירה אחת ל-18 חודשים,
 * ‏תושבות). המחשבון אומר את זה ליד התוצאה, ומפנה לסימולטור של רשות
 * ‏המסים לפני שמצטטים ללקוח.
 */

export const CAPITAL_GAINS_RATE_PERCENT = 25;
/** ‏מועד ההתחלה של החיוב בחישוב הליניארי המוטב */
export const CAPITAL_GAINS_LINEAR_CUTOFF = "2014-01-01";

/** ‏הטבלאות שמתעדכנות בחוק — נשמרות בפלטפורמה, ומנהל הפלטפורמה מעדכן */
export interface TaxTables {
  purchase: { year: number; singleHome: TaxBracket[]; additionalHome: TaxBracket[] };
  capitalGains: { year: number; singleHomeCeiling: number };
}

export const DEFAULT_TAX_TABLES: TaxTables = {
  purchase: {
    year: PURCHASE_TAX_YEAR,
    singleHome: [...PURCHASE_TAX_SINGLE_HOME],
    additionalHome: [...PURCHASE_TAX_ADDITIONAL_HOME],
  },
  /* ‏תקרת הפטור לדירה יחידה שפורסמה לינואר 2025 */
  capitalGains: { year: 2025, singleHomeCeiling: 5_008_000 },
};

export interface CapitalGainsInput {
  purchasePriceShekels: number;
  /** ‏YYYY-MM-DD */
  purchaseDate: string;
  salePriceShekels: number;
  saleDate: string;
  /** ‏הוצאות מוכרות: עו״ד, תיווך, מס רכישה, שיפוץ */
  expensesShekels: number;
  /** ‏עליית המדד בין הרכישה למכירה, באחוזים; 0 = בלי ניכוי אינפלציוני */
  cpiPercent: number;
  singleHome: boolean;
  singleHomeCeilingShekels: number;
}

export interface CapitalGainsResult {
  nominalGain: number;
  inflationary: number;
  realGain: number;
  /** ‏חלק השבח הריאלי שפטור בחישוב הליניארי (0–1) */
  linearExemptShare: number;
  /** ‏חלק המחיר שמעל תקרת הפטור לדירה יחידה (0–1); 0 = פטור מלא / לא דירה יחידה */
  taxableShare: number;
  taxableGain: number;
  tax: number;
  notes: string[];
}


function dayOf(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return null;
  const at = new Date(`${iso}T00:00:00.000Z`).getTime();
  return Number.isNaN(at) ? null : at;
}

/** ‏חלק התקופה שעד 31.12.2013 מתוך תקופת ההחזקה — פטור בחישוב הליניארי. */
export function linearExemptShare(purchaseDate: string, saleDate: string): number {
  const bought = dayOf(purchaseDate);
  const sold = dayOf(saleDate);
  const cutoff = dayOf(CAPITAL_GAINS_LINEAR_CUTOFF)!;
  if (bought === null || sold === null || sold <= bought) return 0;
  if (bought >= cutoff) return 0;
  if (sold <= cutoff) return 1;
  return (cutoff - bought) / (sold - bought);
}

export function capitalGains(input: CapitalGainsInput): CapitalGainsResult {
  const notes: string[] = [];
  const cost = Math.max(0, input.purchasePriceShekels) + Math.max(0, input.expensesShekels);
  const nominalGain = Math.max(0, input.salePriceShekels) - cost;
  if (nominalGain <= 0) {
    return { nominalGain, inflationary: 0, realGain: 0, linearExemptShare: 0, taxableShare: 0, taxableGain: 0, tax: 0, notes: ["אין שבח — מחיר המכירה אינו עולה על שווי הרכישה וההוצאות."] };
  }
  const inflationary = Math.min(nominalGain, Math.max(0, cost * (input.cpiPercent / 100)));
  const realGain = nominalGain - inflationary;
  if (inflationary > 0) notes.push("השבח האינפלציוני (עליית המדד על שווי הרכישה) פטור ממס.");

  const linear = linearExemptShare(input.purchaseDate, input.saleDate);
  if (linear > 0) {
    notes.push(
      linear >= 1
        ? "כל תקופת ההחזקה לפני 1.1.2014 — השבח הריאלי פטור בחישוב הליניארי המוטב."
        : `חישוב ליניארי מוטב: ${Math.round(linear * 100)}% מהשבח הריאלי מיוחסים לתקופה שעד 31.12.2013 ופטורים.`,
    );
  }

  let taxableShare = 1;
  if (input.singleHome) {
    const ceiling = Math.max(0, input.singleHomeCeilingShekels);
    if (input.salePriceShekels <= ceiling) {
      taxableShare = 0;
      notes.push("דירה יחידה עד תקרת הפטור — פטור מלא, בכפוף לתנאי הפטור (מכירה אחת ל-18 חודשים, תושבות).");
    } else {
      taxableShare = (input.salePriceShekels - ceiling) / input.salePriceShekels;
      notes.push(`דירה יחידה מעל התקרה: ${Math.round(taxableShare * 100)}% מהשבח (החלק שמעל התקרה) חייבים במס.`);
    }
  }

  const taxableGain = Math.round(realGain * (1 - linear) * taxableShare);
  const tax = Math.round((taxableGain * CAPITAL_GAINS_RATE_PERCENT) / 100);
  return { nominalGain, inflationary: Math.round(inflationary), realGain: Math.round(realGain), linearExemptShare: linear, taxableShare, taxableGain, tax, notes };
}
