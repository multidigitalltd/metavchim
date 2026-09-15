import { billingAnchorDay, nextPeriodEnd } from "./billing.js";

/**
 * ‎**מקום שבעל הפלטפורמה מוסיף למשרד — שלוש דרכים, ומה כל אחת עושה.**
 *
 * ## למה זה לא המונה שכבר קיים
 *
 * ‎`whatsappAgentSeatsExtra` הוא מונה על המשרד, והוא מספיק בדיוק
 * למקרה אחד: „תן להם עוד אחד, בחינם, לתמיד”. הוא אינו יודע לומר
 * ‎**עד מתי**, ואינו יודע לשאת מחיר. פיילוט לחודש ומקום בתשלום
 * שסוכם בטלפון הם שני דברים שמונה אינו יכול לבטא — ולכן הם שורות,
 * בדיוק כמו המקומות שהמשרד קונה לעצמו (ראו `WhatsappSeat`).
 *
 * ## שלוש הדרכים
 *
 * | מצב | מחויב? | נגמר? |
 * | --- | --- | --- |
 * | `free` | לעולם לא | לעולם לא — עד שמבטלים ידנית |
 * | `trial` | לעולם לא | בתאריך שנקבע, והמכסה יורדת |
 * | `billed` | מהתקופה **השנייה** | לא — מנוי חודשי רגיל |
 *
 * ## למה החודש הראשון על חשבון הבית ב-`billed`
 *
 * מקום שהמשרד קונה לעצמו משלם חודש מראש בדף התשלום. מקום שמנהל
 * הפלטפורמה פותח אינו עובר בדף תשלום — ולחייב את הכרטיס השמור
 * סינכרונית מתוך מסך ניהול פירושו שפעולה אדמיניסטרטיבית מושכת כסף
 * ברגע הלחיצה, בלי שאיש מהמשרד אישר דבר. לכן התקופה הראשונה ניתנת,
 * והגבייה מתחילה בסופה — אז כבר קיים מנוי פעיל שהמשרד מודע לו.
 *
 * ## והשדה `origin` הוא מה שמונע חיוב של מתנה
 *
 * סורק החידושים אוסף כל שורה ש-`currentPeriodEnd` שלה עבר. מקום
 * ניסיון **חייב** תאריך סיום — אחרת אין מה שיסגור אותו — ובלי
 * הבחנה מפורשת הסורק היה מנסה לחייב עליו כרטיס, בסכום אפס, בכל
 * שעה. ‎`origin: "granted"` הוא הסימן שמוציא אותו מהגבייה ומכניס
 * אותו לשחרור.
 */
export type WhatsappSeatOrigin = "purchased" | "granted";

export type WhatsappSeatGrantMode = "free" | "trial" | "billed";

export interface WhatsappSeatGrant {
  origin: WhatsappSeatOrigin;
  monthlyAgorot: number;
  /** `null` = לא נגמר מעצמו. */
  currentPeriodEnd: Date | null;
  billingAnchorDay: number | null;
}

export class WhatsappSeatGrantError extends Error {}

/**
 * מה לכתוב בשורה, לפי מה שנבחר במסך. פונקציה טהורה בכוונה — ההכרעה
 * הזאת נבדקת בלי מסד ובלי סולק.
 */
export function whatsappSeatGrant(input: {
  mode: WhatsappSeatGrantMode;
  now: Date;
  /** ל-`trial` בלבד: מתי המקום נסגר. */
  endsAt?: Date | null;
  /** ל-`billed` בלבד: המחיר החודשי שסוכם, באגורות. */
  monthlyAgorot?: number | null;
}): WhatsappSeatGrant {
  const { mode, now } = input;

  if (mode === "free") {
    return { origin: "granted", monthlyAgorot: 0, currentPeriodEnd: null, billingAnchorDay: null };
  }

  if (mode === "trial") {
    const endsAt = input.endsAt ?? null;
    if (endsAt === null || Number.isNaN(endsAt.getTime())) {
      throw new WhatsappSeatGrantError("ניסיון חייב תאריך סיום");
    }
    /*
     * תאריך שכבר עבר היה נוצר ונסגר באותה שעה — מקום שנראה כאילו
     * הוענק ומיד נעלם, בלי שאיש יבין מה קרה.
     */
    if (endsAt <= now) throw new WhatsappSeatGrantError("תאריך הסיום כבר עבר");
    return { origin: "granted", monthlyAgorot: 0, currentPeriodEnd: endsAt, billingAnchorDay: null };
  }

  const monthlyAgorot = input.monthlyAgorot ?? 0;
  if (!Number.isInteger(monthlyAgorot) || monthlyAgorot <= 0) {
    throw new WhatsappSeatGrantError("מקום בתשלום חייב מחיר חודשי");
  }
  return {
    origin: "purchased",
    monthlyAgorot,
    /* התקופה הראשונה ניתנת; החיוב הראשון בסופה */
    currentPeriodEnd: nextPeriodEnd(null, now, "monthly", billingAnchorDay(now)),
    billingAnchorDay: billingAnchorDay(now),
  };
}

/** מה כתוב בשורה במסך — „הוענק”, „ניסיון עד…”, או המחיר. */
export function whatsappSeatOriginLabel(seat: {
  origin: string;
  monthlyAgorot: number;
  currentPeriodEnd: Date | string | null;
}): string {
  if (seat.origin !== "granted") return "בתשלום";
  return seat.currentPeriodEnd === null ? "הוענק — ללא חיוב" : "ניסיון — ללא חיוב";
}

/**
 * האם הסורק רשאי לחייב על השורה הזאת.
 *
 * הפונקציה קיימת כדי שהתנאי ייכתב **פעם אחת**: הוא מופיע גם בשאילתת
 * הסינון של הסורק וגם בבדיקה שלפני החיוב עצמו, ושני עותקים שלו הם
 * שני מקומות שייפרדו ביום שבו יתווסף מקור שלישי.
 */
export function whatsappSeatIsBillable(seat: { origin: string }): boolean {
  return seat.origin !== "granted";
}
