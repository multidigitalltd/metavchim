import { PURCHASE_TAX_ADDITIONAL_HOME, PURCHASE_TAX_SINGLE_HOME, PURCHASE_TAX_YEAR, type TaxBracket } from "./forum.js";

/**
 * ‏מס שבח על דירת מגורים — הערכה למתווך, לא שומה.
 *
 * ‏מה מחושב כאן, ובאילו כללים:
 * - ‏**השבח הנומינלי** = מחיר המכירה פחות שווי הרכישה וההוצאות
 *   ‏המוכרות (עו״ד, תיווך, מס רכישה, שיפוץ).
 * - ‏**השבח האינפלציוני** (עליית המדד על מחיר הרכישה בלבד — ההוצאות
 *   ‏אינן מוצמדות, כי מועדן אינו ידוע) פטור מ-1.1.1994; החלק שנצבר עד
 *   ‏31.12.1993 חייב ב-10%. המשתמש מזין את שיעור עליית המדד בין
 *   ‏התאריכים, כי המדד אינו זמין כאן, והחלוקה ל-1993 היא ליניארית לפי
 *   ‏הזמן.
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
/** ‏שבח אינפלציוני שנצבר עד סוף 1993 — חייב ב-10% */
export const INFLATIONARY_PRE_1994_RATE_PERCENT = 10;
export const INFLATIONARY_EXEMPT_FROM = "1994-01-01";
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
  /** ‏עליית המדד בין הרכישה למכירה, באחוזים; חל על מחיר הרכישה בלבד; 0 = בלי ניכוי אינפלציוני */
  cpiPercent: number;
  singleHome: boolean;
  singleHomeCeilingShekels: number;
}

export interface CapitalGainsResult {
  nominalGain: number;
  inflationary: number;
  /** ‏החלק מהשבח האינפלציוני שנצבר עד 31.12.1993 — חייב ב-10% */
  inflationaryTaxable: number;
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

/** ‏חלק תקופת ההחזקה שלפני מועד נתון (0–1), לפי הזמן. */
function shareBefore(purchaseDate: string, saleDate: string, cutoffIso: string): number {
  const bought = dayOf(purchaseDate);
  const sold = dayOf(saleDate);
  const cutoff = dayOf(cutoffIso)!;
  if (bought === null || sold === null || sold <= bought) return 0;
  if (bought >= cutoff) return 0;
  if (sold <= cutoff) return 1;
  return (cutoff - bought) / (sold - bought);
}

/** ‏חלק התקופה שעד 31.12.2013 מתוך תקופת ההחזקה — פטור בחישוב הליניארי. */
export function linearExemptShare(purchaseDate: string, saleDate: string): number {
  return shareBefore(purchaseDate, saleDate, CAPITAL_GAINS_LINEAR_CUTOFF);
}

export function capitalGains(input: CapitalGainsInput): CapitalGainsResult {
  const notes: string[] = [];
  const purchase = Math.max(0, input.purchasePriceShekels);
  const cost = purchase + Math.max(0, input.expensesShekels);
  const nominalGain = Math.max(0, input.salePriceShekels) - cost;
  if (nominalGain <= 0) {
    return { nominalGain, inflationary: 0, inflationaryTaxable: 0, realGain: 0, linearExemptShare: 0, taxableShare: 0, taxableGain: 0, tax: 0, notes: ["אין שבח — מחיר המכירה אינו עולה על שווי הרכישה וההוצאות."] };
  }
  /* ‏המדד חל על מחיר הרכישה בלבד: מועד ההוצאות אינו ידוע, והצמדתן מנפחת את הפטור */
  const inflationary = Math.min(nominalGain, Math.max(0, purchase * (input.cpiPercent / 100)));
  const realGain = nominalGain - inflationary;
  /* ‏שבח אינפלציוני שנצבר עד 31.12.1993 — חייב ב-10%; מ-1994 פטור */
  const pre1994 = shareBefore(input.purchaseDate, input.saleDate, INFLATIONARY_EXEMPT_FROM);
  const inflationaryTaxable = Math.round(inflationary * pre1994);
  if (inflationary > 0) {
    notes.push(
      inflationaryTaxable > 0
        ? `השבח האינפלציוני על מחיר הרכישה: ${Math.round(pre1994 * 100)}% ממנו מיוחסים לתקופה שעד 31.12.1993 וחייבים ב-${INFLATIONARY_PRE_1994_RATE_PERCENT}%; היתר פטור.`
        : "השבח האינפלציוני (עליית המדד על מחיר הרכישה) פטור ממס; ההוצאות אינן מוצמדות.",
    );
  }

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
  const tax = Math.round(
    (taxableGain * CAPITAL_GAINS_RATE_PERCENT) / 100 +
      (inflationaryTaxable * taxableShare * INFLATIONARY_PRE_1994_RATE_PERCENT) / 100,
  );
  return { nominalGain, inflationary: Math.round(inflationary), inflationaryTaxable, realGain: Math.round(realGain), linearExemptShare: linear, taxableShare, taxableGain, tax, notes };
}
