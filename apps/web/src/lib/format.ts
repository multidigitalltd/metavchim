import { buyerSourceLabel, normalizePhoneForWhatsapp,
  JERUSALEM_TZ,
  type PropertyStatus,
  type PropertyType,
} from "@metavchim/shared";

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

const numberFmt = new Intl.NumberFormat("he-IL");

/**
 * מספר בפורמט ישראלי — „2,650,000”.
 *
 * ‎**למה מספרים עוברים דרך עזר ולא קוראים ל-`toLocaleString` בעצמם.**
 * שער `verify:timezone` אוסר את שם המתודה `toLocaleString` בלי שום
 * חריג, כי על `Date` היא קוראת את שעון המכשיר — ושם המתודה זהה
 * בשני הטיפוסים. שער טקסטואלי אינו יודע מה טיפוס המקבל, ולכן
 * האפשרות היחידה הייתה רשימת היתרים — בדיוק המנגנון שמחזיר את
 * החור שהשער נועד לסגור (ארבעה מופעים על `Date` חמקו ממנו כך
 * בסבב הקודם, ביקורת Codex). ארבעה מופעים על מספרים עברו לכאן,
 * והאיסור נעשה מוחלט.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return options === undefined
    ? numberFmt.format(value)
    : new Intl.NumberFormat("he-IL", options).format(value);
}

const dateFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ, dateStyle: "medium" });

export function formatDate(value: string | Date | undefined): string {
  return value === undefined ? "—" : dateFmt.format(new Date(value));
}

const dateTimeFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: JERUSALEM_TZ, dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | Date | undefined): string {
  return value === undefined ? "—" : dateTimeFmt.format(new Date(value));
}

/**
 * ‎**„לפני כמה זמן” — ולא תאריך מלא.**
 *
 * ‏„30 באוגוסט 2026, 10:14” מחייב את מי שקורא לחשב בעצמו כמה זמן
 * זה מחכה; „לפני 3 שעות” הוא התשובה עצמה. בתור של פניות זו השאלה
 * היחידה שנשאלת על הזמן, ולכן זה מה שמוצג — התאריך המדויק נשאר
 * זמין כ-`title` על אותה שורה.
 *
 * הפונקציה נכתבה כאן אחרי שנמצאו לה שני עותקים פרטיים במסכים
 * שונים. גרסה שלישית הייתה נכתבת מחדש בניסוח רביעי.
 */
export function timeAgo(value: string | Date | undefined): string {
  if (value === undefined) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
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

/**
 * ‎**`satisfies` ולא טיפוס על המשתנה** — הוא מה שהופך סוג חסר לשגיאת
 * הידור.
 *
 * הטבלה הזו נכתבה ביד ופיגרה אחרי הסכימה: חמישה סוגים היו חסרים בה
 * בשקט, והמסך פשוט הציג את שם השדה באנגלית. `Record<string, string>`
 * לבדו אינו תופס את זה — כל מפתח חוקי בו.
 *
 * הייצוא נשאר `Record<string, string>` בכוונה, כי רוב המסכים
 * מאנדקסים אותה במחרוזת שהגיעה מהשרת. הטיפוס ההדוק על הליטרל נותן
 * את הבדיקה; הייצוא הרחב נותן את הנוחות — בלי אף המרה שתסתיר פער.
 */
const PROPERTY_TYPE_LABEL_TABLE = {
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
  accessible_apartment: "דירת נכה",
  plot: "מגרש",
  /*
   * ‎„מסחרי” נשאר כערך — הוא „מסחרי שלא נאמר איזה”, ולא רק תאימות
   * לשורות קיימות. התווית מבחינה אותו מתשעת הענפים שתחתיו.
   */
  commercial: "מסחרי (לא צוין)",
  commercial_shop: "חנות",
  commercial_office: "משרד",
  commercial_warehouse: "מחסן",
  commercial_industrial: "תעשייה",
  commercial_basement: "מרתף",
  commercial_building: "בניין",
  commercial_logistics: 'מרלו"ג',
  commercial_parking: "חניה",
  commercial_gas_station: "תחנת דלק",
  other: "אחר",
} satisfies Record<PropertyType, string>;

export const PROPERTY_TYPE_LABELS: Record<string, string> = PROPERTY_TYPE_LABEL_TABLE;

/**
 * ‎**סוגי הנכס לבורר — עם „מסחרי” כקבוצה.**
 *
 * ## למה `optgroup` ולא שני בוררים משורשרים
 *
 * הבקשה הייתה „בוחרים מסחרי ונפתחות תת-קטגוריות”, וזה בדיוק מה
 * ש-`optgroup` עושה: כותרת „מסחרי” ותשעת הענפים מתחתיה. ההבדל הוא
 * שזו **לחיצה אחת** ולא שתיים, ואין מצב ביניים של „נבחר מסחרי ולא
 * נבחר ענף” שצריך לאמת בשרת.
 *
 * וחשוב מזה: הבורר הזה חוזר בארבעה מסכים (נכס חדש, עריכת נכס,
 * המרת ליד, דרישות קונה). קבוצה בטבלה אחת מגיעה לארבעתם; רכיב
 * מדורג היה צריך להיכתב לכל אחד מהם בנפרד — או להפוך את ארבעתם
 * לרכיב אחד, שינוי גדול בהרבה ממה שהתבקש.
 *
 * ‎**„מסחרי (לא צוין)” נשאר בתוך הקבוצה** ולא מחוצה לה: הוא ערך
 * חוקי — „מסחרי שטרם דייקתי” — ולא כותרת.
 */
export interface PropertyTypeGroup {
  /** ‎`undefined` = ערכים בשורש הרשימה, בלי כותרת קבוצה. */
  label?: string;
  options: { value: string; label: string }[];
}

export function propertyTypeGroups(): PropertyTypeGroup[] {
  const entries = Object.entries(PROPERTY_TYPE_LABEL_TABLE) as [string, string][];
  const isCommercial = (value: string): boolean =>
    value === "commercial" || value.startsWith("commercial_");
  return [
    {
      options: entries
        .filter(([value]) => !isCommercial(value))
        .map(([value, label]) => ({ value, label })),
    },
    {
      label: "מסחרי",
      options: entries
        .filter(([value]) => isCommercial(value))
        .map(([value, label]) => ({ value, label })),
    },
  ];
}


export const STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: "טיוטה",
  active: "פעיל",
  on_hold: "בהמתנה",
  sold: "נמכר",
  rented: "הושכר",
  archived: "בארכיון",
};

/* התוויות יושבות ליד הסכימה — ראו `lead-labels.ts` לאותו נימוק. */
export { FINANCING_LABELS } from "@metavchim/shared";

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

/** ‏1.2MB ⟵ "1.2MB"; 850KB ⟵ "850KB" — לתווית קובץ מצורף. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
