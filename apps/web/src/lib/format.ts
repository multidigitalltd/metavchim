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

export const MATURITY_LABELS: Record<string, string> = {
  very_hot: "חם מאוד",
  hot: "חם",
  interested: "מתעניין",
  not_ripe: "לא בשל",
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
  entryDate: "תאריך כניסה",
};
