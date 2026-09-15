import type { EmailContent } from "./email-template.js";
import { formatIsraeliNumber } from "./israel-time.js";

/**
 * ‎**„שליחת הצעת נכס” — הצעה שסוכן בחר לשלוח, ולא סבב אוטומטי.**
 *
 * ## ‏למה זה אינו `buildOfferEmail`
 *
 * ‏מייל ההצעות הקיים נשלח מהסבב האוטומטי, ולכן הוא אומר „ההודעה
 * ‏נשלחה אוטומטית כי ביקשתם מאיתנו לחפש עבורכם”. כאן **סוכן בחר
 * ‏נכס ובחר למי לשלוח אותו** — אותו נוסח היה אמירה לא נכונה על מה
 * ‏שקרה, ובדיוק בשדה שנועד להסביר ללקוח למה הוא קיבל את המייל.
 *
 * ‏שני המיילים גם מצביעים למקומות שונים: הסבב שולח לדף ההצעה
 * ‏האישי, וכאן הקישור הוא **דף הנחיתה של הנכס** — הדף שיש בו טופס
 * ‏השארת פרטים, וזה מה שהופך את המייל לפנייה שאפשר לענות עליה.
 */

/** ‏מה שהמייל מספר על הנכס — בלי כתובת מדויקת, כמו דף הנחיתה. */
export interface PitchProperty {
  /** ‏כותרת שיווקית, או תיאור נגזר כשאין. */
  title: string;
  city?: string;
  neighborhood?: string;
  rooms?: number;
  areaSqm?: number;
  priceAgorot?: number;
  /** ‏דף הנחיתה של הנכס — שם משאירים פרטים. */
  landingUrl: string;
}

export interface PropertyPitchInput {
  officeName: string;
  /** ‏שם הלקוח לברכה. ריק = בלי שורת ברכה. */
  buyerName: string;
  properties: readonly PitchProperty[];
  /** ‏קישור ההסרה — חובה בכל דיוור שיווקי (חוק התקשורת §30א). */
  optOutUrl: string;
}

/**
 * ‏שורת התיאור של נכס — מה שמופיע ליד הקישור.
 *
 * ‏רק מה שידוע נכנס: „3 חדרים · 82 מ״ר · רעננה” על נכס שחסר בו
 * ‏שדה הופך ל„3 חדרים · רעננה”, ולא לשורה עם מפרידים ריקים.
 */
export function pitchPropertyLine(property: PitchProperty): string {
  const parts = [
    property.rooms === undefined ? null : `${formatIsraeliNumber(property.rooms)} חדרים`,
    property.areaSqm === undefined ? null : `${formatIsraeliNumber(property.areaSqm)} מ״ר`,
    [property.neighborhood, property.city].filter(Boolean).join(", ") || null,
    property.priceAgorot === undefined
      ? null
      : `${formatIsraeliNumber(Math.round(property.priceAgorot / 100))} ₪`,
  ].filter((part): part is string => part !== null && part !== "");
  return parts.length === 0 ? property.title : `${property.title} — ${parts.join(" · ")}`;
}

export function buildPropertyPitchEmail(input: PropertyPitchInput): {
  subject: string;
  content: EmailContent;
} {
  const count = input.properties.length;
  const single = count === 1 ? input.properties[0] : undefined;
  return {
    subject:
      single === undefined
        ? `${formatIsraeliNumber(count)} נכסים בשבילכם — ${input.officeName}`
        : `${single.title} — ${input.officeName}`,
    content: {
      heading: single === undefined ? "נכסים שאולי יתאימו לכם" : "נכס שאולי יתאים לכם",
      ...(input.buyerName === "" ? {} : { greeting: `שלום ${input.buyerName},` }),
      paragraphs: [
        single === undefined
          ? "אלה נכסים מהמאגר שלנו שחשבנו שיעניינו אתכם. בכל קישור תמצאו את הפרטים המלאים, ואפשר להשאיר פרטים ונחזור אליכם:"
          : "זה נכס מהמאגר שלנו שחשבנו שיעניין אתכם. בקישור תמצאו את הפרטים המלאים, ואפשר להשאיר פרטים ונחזור אליכם:",
      ],
      links: input.properties.map((property) => ({
        label: pitchPropertyLine(property),
        url: property.landingUrl,
      })),
      /*
       * ‎**„סוכן שלח” ולא „נשלח אוטומטית”.** הנוסח האוטומטי היה
       * ‏אמירה לא נכונה כאן, ודווקא בשדה שנועד להסביר ללקוח למה
       * ‏הוא קיבל את ההודעה.
       */
      footnote:
        `ההודעה נשלחה אליכם על ידי ${input.officeName}. ` +
        `להסרה מקבלת הצעות במייל: ${input.optOutUrl}`,
    },
  };
}

/**
 * ‎**האם אפשר לשלוח לקונה הזה — ולמה לא.**
 *
 * ‏שלושת המצבים נבדקים **לפני** הפתיחה של החלון, ולא בשליחה:
 * ‏המסך מסמן ליד השם „אין מייל” או „הוסר מדיוור”, כדי שמי שבוחר
 * ‏יידע מה ייצא בפועל. רשימה שמסתירה את זה ואז שולחת לחלק
 * ‏מהנבחרים היא בדיוק ה„✓ נשלח” שאינו נכון.
 */
export type PitchRecipientState = "ready" | "no_email" | "opted_out";

export function pitchRecipientState(input: {
  hasEmail: boolean;
  optedOut: boolean;
}): PitchRecipientState {
  /*
   * ‏ההסרה קודמת: לקוח שהסיר את עצמו לא יקבל גם אם יש לו מייל,
   * ‏וזו הסיבה החזקה יותר להציג.
   */
  if (input.optedOut) return "opted_out";
  return input.hasEmail ? "ready" : "no_email";
}

/** ‏מי מהנבחרים באמת יקבל — הסינון היחיד, ומשמש גם במסך וגם בשרת. */
export function pitchDeliverable<T extends { hasEmail: boolean; optedOut: boolean }>(
  recipients: readonly T[],
): T[] {
  return recipients.filter((row) => pitchRecipientState(row) === "ready");
}
