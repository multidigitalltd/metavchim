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
import { describeDistance } from "./proximity.js";

/**
 * שם האייקון — **לא האייקון עצמו.**
 *
 * המודול הזה טהור ואינו יכול להחזיק JSX, אבל הבעיה האמיתית אינה
 * טכנית: גרסה קודמת החזירה כאן אימוג'ים, והם נראו זרים לצד ערכת
 * הקווים של שאר המערכת — שתי שפות חזותיות באותו מסך. שם סמלי משאיר
 * את ההחלטה "איך זה נראה" במקום אחד, `app/icons.tsx`, ואת ההחלטה
 * "מה מוצג" כאן.
 *
 * איחוד סגור ולא מחרוזת חופשית: שם שאין לו אייקון נתפס בהידור ולא
 * מתגלה כריבוע ריק על מסך של מתווך.
 */
export type NetworkChipIcon =
  | "tag"
  | "key"
  | "home"
  | "door"
  | "ruler"
  | "map"
  | "pin"
  | "coins"
  | "bolt"
  | "calendar"
  | "bank"
  | "banknote"
  | "flame"
  | "clock"
  | "check"
  | "star"
  | "stairs"
  | "sparkle";

/**
 * פריט אחד בכרטיס: אייקון, טקסט, וטון.
 *
 * האייקון אינו קישוט — הוא מה שמאפשר לסרוק כרטיס במבט אחד במקום
 * לקרוא שורת טקסט. `tone` קובע צבע, ו-`title` הוא ההסבר שמופיע
 * בריחוף למי שרוצה לוודא.
 */
export interface NetworkChip {
  icon: NetworkChipIcon;
  text: string;
  tone?: "plain" | "primary" | "money" | "hot" | "good";
  title?: string;
}

/** תוויות למצב המימון של הקונה — משוכפל בכוונה מטבלת הייצוא כדי לא לתלות מסך בקובץ CSV. */
const FINANCING_CHIP: Record<string, NetworkChip> = {
  cash: { icon: "banknote", text: "משלם במזומן", tone: "good" },
  pre_approved: { icon: "bank", text: "אישור עקרוני ביד", tone: "good" },
  in_process: { icon: "bank", text: "משכנתה בתהליך" },
  not_started: { icon: "bank", text: "מימון טרם התחיל" },
};

/** בשלות — רק כשהיא אומרת משהו. "מתעניין" הוא ברירת המחדל ואינו מידע. */
const MATURITY_CHIP: Record<
  string,
  { icon: NetworkChipIcon; tone: NetworkChip["tone"] }
> = {
  very_hot: { icon: "flame", tone: "hot" },
  hot: { icon: "flame", tone: "hot" },
  not_ripe: { icon: "clock", tone: "plain" },
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
      return { icon: "bolt", text: "כניסה מיידית", tone: "good" };
    case "flexible":
      return { icon: "calendar", text: "מועד כניסה גמיש" };
    case "by_date":
      return {
        icon: "calendar",
        text: dateText === null ? "מועד כניסה מוגדר" : `עד ${dateText}`,
      };
    case "on_date":
    case "from_date":
      return {
        icon: "calendar",
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
  /** חסר = הקונה טרם מסר תקציב; הצ'יפ אומר זאת במפורש. */
  budgetMaxAgorot?: number | undefined;
  roomsMin?: number | undefined;
  roomsMax?: number | undefined;
  areaSqmMin?: number | undefined;
  entryType?: string | undefined;
  entryBy?: string | Date | undefined;
  financing?: string | undefined;
  maturity?: string | undefined;
  mustFeatures: string[];
  niceFeatures?: string[] | undefined;
  /**
   * אזורי המפה שהקונה סימן — רדיוס ותווית בלבד. הקואורדינטות אינן
   * נכנסות לצ'יפים: "אבן גבירול, בני ברק · רדיוס 1 ק"מ" אומר לצד
   * השני כל מה שהוא צריך כדי להחליט אם יש לו נכס שם.
   */
  searchAreas?: { radiusKm: number; label?: string }[] | undefined;
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
      ? { icon: "key", text: "להשכרה", tone: "primary" }
      : { icon: "tag", text: "לקנייה", tone: "primary" },
  );

  const types = (demand.propertyTypes ?? [])
    .map(
      (t) =>
        PROPERTY_TYPE_LABELS_HE[t as keyof typeof PROPERTY_TYPE_LABELS_HE] ?? t,
    )
    .filter((t) => t !== "");
  if (types.length > 0) chips.push({ icon: "home", text: types.join(" · ") });

  const rooms = roomsText(demand.roomsMin, demand.roomsMax);
  if (rooms !== null) chips.push({ icon: "door", text: rooms });

  if (demand.areaSqmMin !== undefined && demand.areaSqmMin > 0) {
    chips.push({ icon: "ruler", text: `מ-${demand.areaSqmMin} מ״ר` });
  }

  if (demand.cities.length > 0)
    chips.push({ icon: "map", text: demand.cities.join(" · ") });
  const neighborhoods = demand.neighborhoods ?? [];
  if (neighborhoods.length > 0) {
    chips.push({ icon: "pin", text: neighborhoods.join(" · ") });
  }
  /*
   * האזור שסומן על המפה — על הכרטיס עצמו ולא רק בפופאפ (בקשת
   * המשתמש): מתווך שסורק את הפיד מחליט לפי "איפה בדיוק", והאזור
   * המסומן מדויק יותר מרשימת הערים.
   */
  for (const area of demand.searchAreas ?? []) {
    chips.push({
      icon: "pin",
      text:
        area.label !== undefined && area.label !== ""
          ? `${area.label} — רדיוס ${describeDistance(area.radiusKm)}`
          : `אזור מסומן במפה — רדיוס ${describeDistance(area.radiusKm)}`,
      title: "אזור החיפוש שהקונה סימן על המפה",
    });
  }

  /*
   * טווח ולא מספר. הסכומים כבר מעוגלים ל-100 אלף ₪ בשמירה — כאן רק
   * מנוסחים, כדי שהמסך לא יוכל בטעות להציג משהו מדויק יותר ממה
   * שהטבלה שמרה.
   */
  /*
   * ביקוש בלי תקציב אומר זאת במפורש.
   *
   * `money(undefined)` היה מציג "0 ₪", כלומר מודעה שנראית כאילו
   * הקונה אינו יכול לשלם דבר — במקום מודעה שאומרת שהתקציב טרם
   * נמסר. השנייה עדיין שווה הצעה; הראשונה נראית כמו טעות.
   */
  chips.push(
    demand.budgetMaxAgorot === undefined
      ? {
          icon: "coins",
          text: "תקציב לא צוין",
          tone: "money",
          title: "הקונה טרם מסר תקציב — שווה לבדוק מול המשרד המפרסם",
        }
      : {
          icon: "coins",
          text:
            demand.budgetMinAgorot !== undefined && demand.budgetMinAgorot > 0
              ? `${money(demand.budgetMinAgorot)}–${money(demand.budgetMaxAgorot)}`
              : `עד ${money(demand.budgetMaxAgorot)}`,
          tone: "money",
          title: "התקציב מעוגל ל-100 אלף ₪ — טווח ולא סכום מדויק",
        },
  );

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

  /*
   * הדרישות נשארות בטון הנייטרלי, והאייקון הוא שמבדיל בין חובה
   * לעדיפות. **צבע אחד = משמעות אחת**: כשגם המימון וגם כל מאפיין
   * חובה נצבעו בירוק, כרטיס עם ארבע דרישות היה קיר ירוק שבו "אישור
   * עקרוני ביד" — העובדה שקובעת אם שווה להשקיע נכס — נבלע בין
   * "מעלית" ל"ממ״ד". הירוק שמור לאות על רצינות הקונה.
   */
  for (const feature of demand.mustFeatures) {
    chips.push({
      icon: "check",
      text: propertyFeatureLabel(feature),
      title: "דרישת חובה",
    });
  }
  for (const feature of demand.niceFeatures ?? []) {
    chips.push({
      icon: "star",
      text: propertyFeatureLabel(feature),
      title: "עדיפות — לא חובה",
    });
  }

  return chips;
}

/**
 * שורה אחת ברשימת "כל הפרטים" — תווית וערך.
 *
 * `value` חסר פירושו **"לא צוין" ולא "אל תציג"**: המסך מציג את
 * השורה עם ציון מפורש שהשדה ריק. מתווך שפותח את הפופאפ צריך לדעת
 * שהשדה קיים ולא מולא — שדה שנעלם נקרא כמידע שמוסתר ממנו, וזה
 * בדיוק חוסר האמון שהורג רשת שיתופים.
 */
export interface NetworkDetailRow {
  label: string;
  value?: string;
}

/**
 * כל השדות של הביקוש, מתויגים — לפופאפ "כל הפרטים".
 *
 * **אותו גבול חיסיון של `demandChips`**: הקלט הוא צילום הרשת, ששם
 * וטלפון מעולם לא נכנסו אליו. ההבדל הוא הצורה — הצ'יפים בכרטיס הם
 * תקציר לסריקה, וכאן רשימה מלאה שבה כל שדה מופיע עם תווית, גם
 * כשהוא ריק.
 */
export function demandDetailRows(
  demand: NetworkDemandFields & { cities: string[] },
): NetworkDetailRow[] {
  const joined = (values: readonly string[] | undefined): string | undefined =>
    values !== undefined && values.length > 0 ? values.join(" · ") : undefined;
  const rooms = roomsText(demand.roomsMin, demand.roomsMax);
  const areas = (demand.searchAreas ?? []).map((area) =>
    area.label !== undefined && area.label !== ""
      ? `${area.label} — רדיוס ${describeDistance(area.radiusKm)}`
      : `רדיוס ${describeDistance(area.radiusKm)}`,
  );
  const budget =
    demand.budgetMaxAgorot === undefined
      ? undefined
      : demand.budgetMinAgorot !== undefined && demand.budgetMinAgorot > 0
        ? `${money(demand.budgetMinAgorot)}–${money(demand.budgetMaxAgorot)}`
        : `עד ${money(demand.budgetMaxAgorot)}`;
  const entry = entryChip(demand.entryType, demand.entryBy);
  const financing =
    demand.financing === undefined
      ? undefined
      : FINANCING_CHIP[demand.financing]?.text;
  return [
    {
      label: "סוג עסקה",
      value: demand.dealType === "rent" ? "שכירות" : "קנייה",
    },
    {
      label: "סוגי נכס",
      value: joined(
        (demand.propertyTypes ?? [])
          .map(
            (t) =>
              PROPERTY_TYPE_LABELS_HE[
                t as keyof typeof PROPERTY_TYPE_LABELS_HE
              ] ?? t,
          )
          .filter((t) => t !== ""),
      ),
    },
    { label: "חדרים", value: rooms ?? undefined },
    {
      label: "שטח מינימלי",
      value:
        demand.areaSqmMin !== undefined && demand.areaSqmMin > 0
          ? `${demand.areaSqmMin} מ״ר`
          : undefined,
    },
    { label: "ערים", value: joined(demand.cities) },
    { label: "שכונות", value: joined(demand.neighborhoods) },
    { label: "אזורי חיפוש במפה", value: joined(areas) },
    { label: "תקציב", value: budget },
    { label: "מועד כניסה", value: entry?.text },
    { label: "מימון", value: financing },
    {
      label: "רצינות הקונה",
      value:
        demand.maturity === undefined
          ? undefined
          : (MATURITY_LABELS[demand.maturity] ?? demand.maturity),
    },
    {
      label: "דרישות חובה",
      value: joined(demand.mustFeatures.map(propertyFeatureLabel)),
    },
    {
      label: "עדיפויות (לא חובה)",
      value: joined((demand.niceFeatures ?? []).map(propertyFeatureLabel)),
    },
  ];
}

/**
 * כל השדות של הנכס, מתויגים — התאום של `demandDetailRows` לצד השני.
 * הקלט הוא צילום הרשת: רחוב, מספר בית ובעלים אינם קיימים בו כלל.
 */
export function presentationDetailRows(
  p: NetworkPresentationFields,
): NetworkDetailRow[] {
  const entry = entryChip(p.entryType, p.entryDate);
  return [
    {
      label: "סוג עסקה",
      value:
        p.dealType === undefined
          ? undefined
          : p.dealType === "rent"
            ? "השכרה"
            : "מכירה",
    },
    {
      label: "סוג נכס",
      value:
        p.propertyType === undefined
          ? undefined
          : (PROPERTY_TYPE_LABELS_HE[
              p.propertyType as keyof typeof PROPERTY_TYPE_LABELS_HE
            ] ?? p.propertyType),
    },
    { label: "עיר", value: p.city },
    { label: "שכונה", value: p.neighborhood },
    {
      label: "חדרים",
      value: p.rooms === undefined ? undefined : `${p.rooms}`,
    },
    {
      label: "שטח",
      value: p.areaSqm === undefined ? undefined : `${p.areaSqm} מ״ר`,
    },
    {
      label: "קומה",
      value:
        p.floor === undefined
          ? undefined
          : p.totalFloors !== undefined
            ? `${p.floor} מתוך ${p.totalFloors}`
            : `${p.floor}`,
    },
    {
      label: "מצב הנכס",
      value:
        p.condition === undefined
          ? undefined
          : (CONDITION_LABELS[p.condition] ?? p.condition),
    },
    {
      label: p.dealType === "rent" ? "שכר דירה" : "מחיר",
      value: p.priceAgorot === undefined ? undefined : money(p.priceAgorot),
    },
    { label: "מועד כניסה", value: entry?.text },
    {
      label: "מאפיינים",
      value:
        p.features !== undefined && p.features.length > 0
          ? p.features.map(propertyFeatureLabel).join(" · ")
          : undefined,
    },
  ];
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
        ? { icon: "key", text: "להשכרה", tone: "primary" }
        : { icon: "tag", text: "למכירה", tone: "primary" },
    );
  }
  if (p.propertyType !== undefined) {
    chips.push({
      icon: "home",
      text:
        PROPERTY_TYPE_LABELS_HE[
          p.propertyType as keyof typeof PROPERTY_TYPE_LABELS_HE
        ] ?? p.propertyType,
    });
  }
  if (p.rooms !== undefined)
    chips.push({ icon: "door", text: `${p.rooms} חדרים` });
  if (p.areaSqm !== undefined)
    chips.push({ icon: "ruler", text: `${p.areaSqm} מ״ר` });
  if (p.floor !== undefined) {
    chips.push({
      icon: "stairs",
      text:
        p.totalFloors !== undefined
          ? `קומה ${p.floor} מתוך ${p.totalFloors}`
          : `קומה ${p.floor}`,
    });
  }
  const where = [p.neighborhood, p.city].filter(
    (v) => v !== undefined && v !== "",
  );
  if (where.length > 0) chips.push({ icon: "map", text: where.join(", ") });
  if (p.condition !== undefined) {
    chips.push({
      icon: "sparkle",
      text: CONDITION_LABELS[p.condition] ?? p.condition,
    });
  }
  if (p.priceAgorot !== undefined) {
    chips.push({ icon: "coins", text: money(p.priceAgorot), tone: "money" });
  }
  const entry = entryChip(p.entryType, p.entryDate);
  if (entry !== null) chips.push(entry);
  for (const feature of p.features ?? []) {
    chips.push({ icon: "check", text: propertyFeatureLabel(feature) });
  }
  return chips;
}
