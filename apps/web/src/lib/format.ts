import { buyerSourceLabel, normalizePhoneForWhatsapp } from "@metavchim/shared";

const nis = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/** אגורות → "2,650,000 ₪". כסף נשמר תמיד כ-Integer באגורות (docs/03). */
export function formatPrice(agorot: number | undefined): string {
  return agorot === undefined ? "—" : nis.format(agorot / 100);
}

/** ₪ בקלט המשתמש → אגורות */
export function shekelsToAgorot(shekels: number): number {
  return Math.round(shekels * 100);
}

const dateFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" });

export function formatDate(value: string | Date | undefined): string {
  return value === undefined ? "—" : dateFmt.format(new Date(value));
}

const dateTimeFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | Date | undefined): string {
  return value === undefined ? "—" : dateTimeFmt.format(new Date(value));
}

export { MATURITY_LABELS } from "@metavchim/shared";

/**
 * סוג העסקה **מצד הלקוח** — „קונה” ו„שוכר”, ולא „מכירה” ו„השכרה”.
 *
 * אותו ערך בדיוק נקרא הפוך בשני הצדדים: על נכס `sale` הוא „מכירה”,
 * ועל אדם הוא „קונה”. תווית אחת לשניהם הייתה מתייגת לקוח כ„מכירה”.
 */
export const DEAL_TYPE_LABELS: Record<string, string> = {
  sale: "קונה",
  rent: "שוכר",
};

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartment: "דירה",
  garden_apartment: "דירת גן",
  penthouse: "פנטהאוז",
  duplex: "דופלקס",
  private_house: "בית פרטי",
  two_family: "דו-משפחתי",
  studio: "סטודיו",
  unit: "יחידת דיור",
  shared_tabu: "טאבו משותף",
  divisible_apartment: "דירה מתאימה לחלוקה",
  plot: "מגרש",
  commercial: "מסחרי",
  other: "אחר",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה",
  active: "פעיל",
  on_hold: "בהמתנה",
  sold: "נמכר",
  rented: "הושכר",
  archived: "בארכיון",
};

/* התוויות יושבות ליד הסכימה — ראו `lead-labels.ts` לאותו נימוק. */
export { FINANCING_LABELS } from "@metavchim/shared";

export { BUYER_SOURCE_LABELS } from "@metavchim/shared";

/** קישור צ'אט וואטסאפ מטלפון שמור (E.164) — wa.me דורש ספרות בלבד */
export function waMeUrl(phone: string, text?: string): string {
  // הנרמול משותף עם השרת: `wa.me/0501234567` אינו נפתח — וואטסאפ
  // קורא את הספרות הראשונות כקידומת מדינה
  const base = `https://wa.me/${normalizePhoneForWhatsapp(phone)}`;
  // טקסט מוכן מראש — נפתח בתיבת ההודעה, השליחה תמיד ביד המתווך
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** מקור קונה לתצוגה — כולל קונים שהומרו מליד (source = "lead:<מקור הליד>") */
export function formatBuyerSource(source: string): string {
  return buyerSourceLabel(source) ?? source;
}

export const FIELD_LABELS: Record<string, string> = {
  city: "עיר",
  neighborhood: "שכונה",
  street: "רחוב",
  propertyType: "סוג נכס",
  dealType: "סוג עסקה",
  rooms: "חדרים",
  areaSqm: 'שטח במ"ר',
  floor: "קומה",
  hasElevator: "מעלית",
  hasParking: "חניה",
  priceAgorot: "מחיר",
  entryType: "מועד כניסה/מסירה",
  entryDate: "תאריך כניסה",
};
