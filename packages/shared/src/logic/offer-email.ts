import type { EmailContent } from "./email-template.js";
import { formatIsraeliNumber } from "./israel-time.js";
import { MATCH_THRESHOLDS } from "../schemas/match.js";

/**
 * מייל ההצעות האוטומטי — התאמות פנימיות של המשרד בלבד.
 *
 * הקובץ מרכז את **ההחלטות**, לא את השאילתות: איזו התאמה ראויה
 * להישלח ללקוח בלי שסוכן הסתכל עליה, כמה הצעות נכנסות למייל אחד,
 * ואיך נראית ההודעה. השרת מביא נתונים; הכללים גרים כאן, עם בדיקות,
 * כדי שהמסך והשרת יספרו את אותו סיפור.
 */

/**
 * רק התאמות **מומלצות** (≥85) נשלחות אוטומטית.
 *
 * הסף גבוה בכוונה, וגבוה מסף התצוגה לסוכן (50): כשסוכן שולח הצעה
 * הוא שיקול הדעת; כשהמערכת שולחת לבד, ההצעה הבינונית שמגיעה למייל
 * של לקוח היא זו שמלמדת אותו להתעלם גם מהמצוינת.
 */
export const AUTO_OFFER_MIN_SCORE = MATCH_THRESHOLDS.recommended;

/**
 * תקרת הצעות במייל אחד. שאר ההתאמות מחכות לסבב הבא — לקוח שנרשם
 * הרגע ומתאים לחצי מהמאגר אמור לקבל רשימה קריאה, לא קטלוג.
 */
export const AUTO_OFFER_MAX_PER_EMAIL = 5;

/** הצעה אחת בתוך המייל — מה שהלקוח רואה בשורה. */
export interface OfferEmailItem {
  title: string;
  priceAgorot?: number;
  url: string;
}

export interface OfferEmailInput {
  /** שם המשרד — ההודעה מדברת בשמו, לא בשם הפלטפורמה. */
  officeName: string;
  /** שם הלקוח לברכה. ריק = בלי שורת ברכה. */
  buyerName: string;
  offers: readonly OfferEmailItem[];
  /** קישור ההסרה — חובה בכל דיוור אוטומטי (חוק התקשורת §30א). */
  optOutUrl: string;
}

/** כותרת ההצעה בשורה — עם המחיר כשידוע, בפורמט ישראלי. */
export function offerEmailLineLabel(item: OfferEmailItem): string {
  return item.priceAgorot === undefined
    ? item.title
    : `${item.title} — ‏${formatIsraeliNumber(Math.round(item.priceAgorot / 100))} ₪`;
}

/**
 * בניית המייל כולו — נושא + תוכן לתבנית המשותפת.
 *
 * ההודעה קצרה במתכוון: הפירוט המלא (תמונות, מאפיינים, תיאור) גר
 * בדף ההצעה הציבורי, ששם גם נאכף שער ההחתמה בכל צפייה. המייל הוא
 * ההזמנה, לא הנכס.
 */
export function buildOfferEmail(input: OfferEmailInput): {
  subject: string;
  content: EmailContent;
} {
  const count = input.offers.length;
  return {
    subject:
      count === 1
        ? `נכס חדש שמתאים לחיפוש שלכם — ${input.officeName}`
        : `${formatIsraeliNumber(count)} נכסים חדשים שמתאימים לחיפוש שלכם — ${input.officeName}`,
    content: {
      heading: count === 1 ? "מצאנו נכס שמתאים לכם" : "מצאנו נכסים שמתאימים לכם",
      ...(input.buyerName === "" ? {} : { greeting: `שלום ${input.buyerName},` }),
      paragraphs: [
        count === 1
          ? "נכס חדש במאגר שלנו תואם את מה שחיפשתם. כל הפרטים בקישור:"
          : "נכסים חדשים במאגר שלנו תואמים את מה שחיפשתם. כל הפרטים בקישורים:",
      ],
      links: input.offers.map((offer) => ({
        label: offerEmailLineLabel(offer),
        url: offer.url,
      })),
      footnote:
        `ההודעה נשלחה אוטומטית על ידי ${input.officeName} כי ביקשתם מאיתנו לחפש עבורכם נכס. ` +
        `להסרה מקבלת הצעות במייל: ${input.optOutUrl}`,
    },
  };
}
