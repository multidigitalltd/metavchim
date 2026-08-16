/**
 * כרטיס ברשת השיתופים — **מה מוצג, ומה לעולם לא.**
 *
 * הכרטיסים באזור השיתופים הציגו ארבעה פרטים: ערים, חדרים, תקציב
 * ומאפייני חובה. משרד שראה "קונה מחפש 4 חדרים בפתח תקווה עד 2.4
 * מיליון" לא ידע אם מדובר בדירה או בבית פרטי, אם הקונה צריך להיכנס
 * מחר או בעוד שנה, ואם יש לו אישור עקרוני — כלומר לא ידע אם שווה לו
 * להשקיע נכס ולחכות לתשובה. התוצאה הייתה הצעות באוויר משני הצדדים.
 *
 * ## למה מודול משותף ולא JSX
 *
 * אותו ביקוש מוצג בשלושה מסכים — פיד הרשת, כרטיס הנכס וכרטיס הקונה
 * — ובכל אחד מהם נכתב פעם שלישית איזה שדה מוצג ואיך. פונקציה טהורה
 * אחת היא גם מקום אחד לבדוק, וגם ההגנה האמיתית: **פרט שאינו נכנס
 * לרשימה כאן אינו מגיע למסך.**
 *
 * ## הגבול
 *
 * שם, טלפון, אימייל, כתובת מדויקת והערות פנימיות אינם עוברים כאן
 * ואינם נשמרים בטבלאות הרשת מלכתחילה. התקציב מעוגל ל-100 אלף ₪
 * לשני הכיוונים — טווח ולא מספר, כי מספר מדויק הוא חתימה שמזהה
 * לקוח כשמצליבים אותו עם מודעה.
 */

import { MATURITY_LABELS } from "../schemas/buyer.js";
import { PROPERTY_TYPE_LABELS_HE } from "./csv-export.js";
import { propertyFeatureLabel } from "./matching.js";

/**
 * פריט אחד בכרטיס: אימוג'י, טקסט, וטון.
 *
 * האימוג'י אינו קישוט — הוא מה שמאפשר לסרוק כרטיס במבט אחד במקום
 * לקרוא שורת טקסט. `tone` קובע צבע, ו-`title` הוא ההסבר שמופיע
 * בריחוף למי שרוצה לוודא.
 */
export interface NetworkChip {
  icon: string;
  text: string;
  tone?: "plain" | "primary" | "money" | "hot" | "good";
  title?: string;
}

/** תוויות למצב המימון של הקונה — משוכפל בכוונה מטבלת הייצוא כדי לא לתלות מסך בקובץ CSV. */
const FINANCING_CHIP: Record<
  string,
  { icon: string; text: string; tone?: NetworkChip["tone"] }
> = {
  cash: { icon: "💵", text: "משלם במזומן", tone: "good" },
  pre_approved: { icon: "🏦", text: "אישור עקרוני ביד", tone: "good" },
  in_process: { icon: "🏦", text: "משכנתה בתהליך" },
  not_started: { icon: "🏦", text: "מימון טרם התחיל" },
};

/** בשלות — רק כשהיא אומרת משהו. "מתעניין" הוא ברירת המחדל ואינו מידע. */
const MATURITY_CHIP: Record<
  string,
  { icon: string; tone: NetworkChip["tone"] }
> = {
  very_hot: { icon: "🔥", tone: "hot" },
  hot: { icon: "🔥", tone: "hot" },
  not_ripe: { icon: "🕓", tone: "plain" },
};

/**
 * מועד כניסה — **המצב, והתאריך רק כשהוא באמת קיים.**
 *
 * מכסה את שני האוצרות: הקונה (`immediate | by_date | flexible`)
 * והנכס (`immediate | on_date | from_date | flexible`). ערך שאינו
 * מוכר מחזיר `null` ולא נכנס לכרטיס — עדיף שדה חסר מאשר שדה שקרי.
 */
export function entryChip(
  type: string | undefined,
  date: string | Date | undefined,
): NetworkChip | null {
  const when = date === undefined ? null : new Date(date);
  const dateText =
    when !== null && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString("he-IL")
      : null;
  switch (type) {
    case "immediate":
      return { icon: "⚡", text: "כניסה מיידית", tone: "good" };
    case "flexible":
      return { icon: "🗓️", text: "מועד כניסה גמיש" };
    case "by_date":
      return {
        icon: "🗓️",
        text: dateText === null ? "מועד כניסה מוגדר" : `עד ${dateText}`,
      };
    case "on_date":
    case "from_date":
      return {
        icon: "🗓️",
        text: dateText === null ? "מועד כניסה מוגדר" : `מ-${dateText}`,
      };
    default:
      return null;
  }
}

/** ₪ בפורמט קצר לכרטיס: 2,400,000 ולא "2400000 אגורות". */
function money(agorot: number): string {
  return `${Math.round(agorot / 100).toLocaleString("he-IL")} ₪`;
}

/**
 * טווח החדרים.
 *
 * בלי הגבלה מחזיר `null` ולא "?–?": קונה שלא הגביל את עצמו מתאים
 * ליותר נכסים, לא לפחות, ולכן זה אינו חסר שצריך לסמן.
 */
function roomsText(
  min: number | undefined,
  max: number | undefined,
): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min} חדרים` : `${min}–${max} חדרים`;
  }
  return min !== undefined ? `${min}+ חדרים` : `עד ${String(max)} חדרים`;
}

/** ביקוש כפי שהרשת מכירה אותו — בדיוק השדות שהטבלה שומרת. */
export interface NetworkDemandFields {
  dealType: string;
  cities: string[];
  neighborhoods?: string[] | undefined;
  propertyTypes?: string[] | undefined;
  budgetMinAgorot?: number | undefined;
  budgetMaxAgorot: number;
  roomsMin?: number | undefined;
  roomsMax?: number | undefined;
  areaSqmMin?: number | undefined;
  entryType?: string | undefined;
  entryBy?: string | Date | undefined;
  financing?: string | undefined;
  maturity?: string | undefined;
  mustFeatures: string[];
  niceFeatures?: string[] | undefined;
}

/**
 * כל מה שידוע על הביקוש, בסדר שבו מחליטים.
 *
 * הסדר אינו שרירותי: קודם **מה** מחפשים (עסקה, סוג, חדרים, שטח),
 * אחר כך **איפה**, אחר כך **בכמה**, ולבסוף מה שמעיד על רצינות
 * הקונה — מועד, מימון ובשלות. מתווך שסורק פיד עוצר על שתי השורות
 * הראשונות, ומי שכבר עצר רוצה לדעת אם הקונה אמיתי.
 */
export function demandChips(demand: NetworkDemandFields): NetworkChip[] {
  const chips: NetworkChip[] = [];

  chips.push(
    demand.dealType === "rent"
      ? { icon: "🔑", text: "להשכרה", tone: "primary" }
      : { icon: "🏷️", text: "לקנייה", tone: "primary" },
  );

  const types = (demand.propertyTypes ?? [])
    .map(
      (t) =>
        PROPERTY_TYPE_LABELS_HE[t as keyof typeof PROPERTY_TYPE_LABELS_HE] ?? t,
    )
    .filter((t) => t !== "");
  if (types.length > 0) chips.push({ icon: "🏠", text: types.join(" · ") });

  const rooms = roomsText(demand.roomsMin, demand.roomsMax);
  if (rooms !== null) chips.push({ icon: "🚪", text: rooms });

  if (demand.areaSqmMin !== undefined && demand.areaSqmMin > 0) {
    chips.push({ icon: "📐", text: `מ-${demand.areaSqmMin} מ״ר` });
  }

  if (demand.cities.length > 0)
    chips.push({ icon: "🗺️", text: demand.cities.join(" · ") });
  const neighborhoods = demand.neighborhoods ?? [];
  if (neighborhoods.length > 0) {
    chips.push({ icon: "📍", text: neighborhoods.join(" · ") });
  }

  /*
   * טווח ולא מספר. הסכומים כבר מעוגלים ל-100 אלף ₪ בשמירה — כאן רק
   * מנוסחים, כדי שהמסך לא יוכל בטעות להציג משהו מדויק יותר ממה
   * שהטבלה שמרה.
   */
  chips.push({
    icon: "💰",
    text:
      demand.budgetMinAgorot !== undefined && demand.budgetMinAgorot > 0
        ? `${money(demand.budgetMinAgorot)}–${money(demand.budgetMaxAgorot)}`
        : `עד ${money(demand.budgetMaxAgorot)}`,
    tone: "money",
    title: "התקציב מעוגל ל-100 אלף ₪ — טווח ולא סכום מדויק",
  });

  const entry = entryChip(demand.entryType, demand.entryBy);
  if (entry !== null) chips.push(entry);

  const financing =
    demand.financing === undefined
      ? undefined
      : FINANCING_CHIP[demand.financing];
  if (financing !== undefined) chips.push(financing);

  const maturity =
    demand.maturity === undefined ? undefined : MATURITY_CHIP[demand.maturity];
  if (maturity !== undefined && demand.maturity !== undefined) {
    chips.push({
      icon: maturity.icon,
      text: MATURITY_LABELS[demand.maturity] ?? demand.maturity,
      tone: maturity.tone,
      title: "בשלות הקונה כפי שהמשרד המשתף סימן אותה",
    });
  }

  for (const feature of demand.mustFeatures) {
    chips.push({
      icon: "✅",
      text: propertyFeatureLabel(feature),
      tone: "good",
      title: "דרישת חובה",
    });
  }
  for (const feature of demand.niceFeatures ?? []) {
    chips.push({
      icon: "⭐",
      text: propertyFeatureLabel(feature),
      title: "עדיפות — לא חובה",
    });
  }

  return chips;
}

/** צילום הנכס כפי שהוא נשלח לצד השני — בלי רחוב, בלי מספר בית, בלי בעלים. */
export interface NetworkPresentationFields {
  city?: string | undefined;
  neighborhood?: string | undefined;
  propertyType?: string | undefined;
  dealType?: string | undefined;
  rooms?: number | undefined;
  areaSqm?: number | undefined;
  floor?: number | undefined;
  totalFloors?: number | undefined;
  condition?: string | undefined;
  priceAgorot?: number | undefined;
  entryType?: string | undefined;
  entryDate?: string | Date | undefined;
  features?: string[] | undefined;
  title?: string | undefined;
}

const CONDITION_LABELS: Record<string, string> = {
  new: "חדש מקבלן",
  renovated: "משופץ",
  good: "במצב טוב",
  needs_renovation: "דורש שיפוץ",
  preserved: "שמור",
};

/**
 * הנכס שהוצע, באותה שפה חזותית כמו הביקוש.
 *
 * הצד המקבל ראה עד כה שורה אחת — "4 חדרים בגבעתיים · 2,300,000 ₪"
 * — והיה צריך לאשר חיבור רק כדי לגלות שהנכס בקומה שביעית בלי
 * מעלית. אישור חיבור הוא צעד שקשה לחזור ממנו, ולכן כל מה שאינו
 * מזהה צריך להיות ידוע לפניו.
 */
export function presentationChips(p: NetworkPresentationFields): NetworkChip[] {
  const chips: NetworkChip[] = [];

  if (p.dealType !== undefined) {
    chips.push(
      p.dealType === "rent"
        ? { icon: "🔑", text: "להשכרה", tone: "primary" }
        : { icon: "🏷️", text: "למכירה", tone: "primary" },
    );
  }
  if (p.propertyType !== undefined) {
    chips.push({
      icon: "🏠",
      text:
        PROPERTY_TYPE_LABELS_HE[
          p.propertyType as keyof typeof PROPERTY_TYPE_LABELS_HE
        ] ?? p.propertyType,
    });
  }
  if (p.rooms !== undefined)
    chips.push({ icon: "🚪", text: `${p.rooms} חדרים` });
  if (p.areaSqm !== undefined)
    chips.push({ icon: "📐", text: `${p.areaSqm} מ״ר` });
  if (p.floor !== undefined) {
    chips.push({
      icon: "🪜",
      text:
        p.totalFloors !== undefined
          ? `קומה ${p.floor} מתוך ${p.totalFloors}`
          : `קומה ${p.floor}`,
    });
  }
  const where = [p.neighborhood, p.city].filter(
    (v) => v !== undefined && v !== "",
  );
  if (where.length > 0) chips.push({ icon: "🗺️", text: where.join(", ") });
  if (p.condition !== undefined) {
    chips.push({
      icon: "✨",
      text: CONDITION_LABELS[p.condition] ?? p.condition,
    });
  }
  if (p.priceAgorot !== undefined) {
    chips.push({ icon: "💰", text: money(p.priceAgorot), tone: "money" });
  }
  const entry = entryChip(p.entryType, p.entryDate);
  if (entry !== null) chips.push(entry);
  for (const feature of p.features ?? []) {
    chips.push({
      icon: "✅",
      text: propertyFeatureLabel(feature),
      tone: "good",
    });
  }
  return chips;
}
