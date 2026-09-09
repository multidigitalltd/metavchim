import {
  DEAL_TYPE_LABELS_HE,
  type RecruitmentFieldKey,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
  sourceUrlHost,
} from "@metavchim/shared";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";

/**
 * ‏שורת גיוס כפי שהשרת מחזיר אותה — **טיפוס אחד לרשימה, לחלונית,
 * ‏לעמוד ולטופס.**
 *
 * ‏עד עכשיו הרשימה החזיקה `TargetRow` משלה, תת-קבוצה של השדות,
 * ‏והטופס `TargetValues` מלא. שני הטיפוסים תיארו את אותה תשובה של
 * ‎`GET /recruitment`, ולכן החלונית ברשימה לא יכלה להראות את מה
 * ‏שהשורה כבר נשאה (שכונה, קומה, סוג עסקה) — הטיפוס פשוט לא ידע
 * ‏עליו. שדה שנוסף לשרת היה צריך להיזכר בשני מקומות.
 */
export interface TargetValues {
  id?: string;
  status?: string;
  source?: string;
  sourceUrl?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  /** ‏רשום בטאבו משותף — עובדה משפטית שנוסעת להמרה. */
  sharedTabu?: boolean;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  notes?: string;
  /** ‏הנכס שנוצר מהשורה — קיים רק אחרי המרה. */
  convertedPropertyId?: string;
}

/**
 * ‏הכתובת בשורה אחת — „הרצל 12, בני ברק”.
 *
 * ‏אותה הרכבה בטבלה, בחלונית ובכותרת: כתובת שנקראת אחרת בכל מסך
 * ‏נראית כמו שני נכסים.
 */
export function targetAddress(target: TargetValues): string {
  const line = [target.street, target.houseNumber].filter(Boolean).join(" ");
  return [line, target.city].filter(Boolean).join(", ") || "בלי כתובת";
}

/**
 * ‎**הערך של שדה כפי שהוא נקרא על המסך.**
 *
 * ‏מקום אחד להמרות: אגורות→שקלים, `apartment`→„דירה”, `sale`→„מכירה”.
 * ‏שלוש טבלאות המרה שונות בשלושה מסכים הן שלוש הזדמנויות להציג
 * ‏„sale” למתווך.
 *
 * ‏מוחזר `null` כשאין ערך — ולא „—”. הקורא הוא שמחליט אם להציג
 * ‏מקף או להשמיט את השורה, וההבחנה הזאת היא כל ההבדל בין תצוגה
 * ‏שמראה מה שידוע לבין תצוגה שמראה עשרה מקפים.
 */
export function recruitmentFieldText(
  target: TargetValues,
  key: RecruitmentFieldKey,
): string | null {
  switch (key) {
    case "status":
      return target.status === undefined ? null : recruitmentStatusLabel(target.status);
    case "source":
      return target.source === undefined ? null : recruitmentSourceLabel(target.source);
    /* ‏שם האתר ולא הכתובת: מודעה ביד2 היא מאה תווים של מזהים */
    case "sourceUrl":
      return target.sourceUrl === undefined
        ? null
        : (sourceUrlHost(target.sourceUrl) ?? target.sourceUrl);
    case "propertyType":
      return target.propertyType === undefined
        ? null
        : (PROPERTY_TYPE_LABELS[target.propertyType] ?? target.propertyType);
    case "dealType":
      return target.dealType === undefined
        ? null
        : (DEAL_TYPE_LABELS_HE[target.dealType as "sale" | "rent"] ?? target.dealType);
    /*
     * ‎**„לא” הוא תשובה, ולכן הוא מוצג.** העמודה `NOT NULL`, ו„נבדק
     * ‏ואינו מושאע” הוא מידע שמי שמסתכל על הנכס צריך — שתיקה כאן
     * ‏הייתה נקראת כ„לא נשאל”.
     */
    case "sharedTabu":
      return target.sharedTabu === undefined ? null : target.sharedTabu ? "כן" : "לא";
    case "priceAgorot":
      return target.priceAgorot === undefined ? null : formatPrice(target.priceAgorot);
    case "rooms":
      return target.rooms === undefined ? null : `${target.rooms} חד׳`;
    case "areaSqm":
      return target.areaSqm === undefined ? null : `${target.areaSqm} מ״ר`;
    /*
     * ‎**קומה 0 היא קומת קרקע.** `?? null` ולא בדיקת אמיתות: אפס
     * ‏הוא הערך השכיח ביותר בשדה הזה, ותצוגה שמסתירה אותו מכריזה
     * ‏על נכס ידוע כחסר.
     */
    case "floor":
      return target.floor === undefined ? null : target.floor === 0 ? "קרקע" : String(target.floor);
    case "totalFloors":
      return target.totalFloors === undefined ? null : String(target.totalFloors);
    default: {
      const value = target[key];
      return value === undefined || value.trim() === "" ? null : value;
    }
  }
}
