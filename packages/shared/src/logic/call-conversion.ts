import type { CallHighlights } from "./call-summary.js";

/**
 * ‎**מה השיחה יודעת לומר על ההמשך — ואיך זה מוצג.**
 *
 * ## הבעיה
 *
 * ליד שנפתח משיחה יכול להפוך לשני דברים הפוכים: כרטיס קונה (שולחים
 * לו נכסים) או נכס (מבקשים ממנו בלעדיות). שני כפתורים זהים מבקשים
 * מהמתווך להחליט מחדש משהו שהוא **בדיוק שמע** בשיחה.
 *
 * ## ההכרעה
 *
 * ‎`highlights.side` חולץ ממה שנאמר בפועל, ולכן הוא קובע את **הסדר**
 * ‎— הכיוון שזוהה מופיע ראשון.
 *
 * ‎**ולא מסתיר את השני.** זיהוי אוטומטי טועה לפעמים, ואם הטעות
 * סוגרת את הדרך הנכונה המתווך נתקע בלי מוצא: הוא יודע שהלקוח מוכר,
 * המסך מציע רק „המרה לקונה”, ואין כפתור לומר אחרת. סדר הוא רמז;
 * הסתרה היא החלטה.
 *
 * ## ולמה כאן ולא במסך
 *
 * שלוש הטענות — מי ראשון, איזו עסקה, ומה נאמר למתווך — הן קוד טהור
 * שאפשר לבדוק. בתוך ה-JSX הן היו שלושה תנאים שאיש אינו בודק, ושינוי
 * בהן היה נראה כמו שינוי עיצוב.
 */

/** ‎`side` בלשון שמתווך קורא, ולא בשם השדה. */
const SIDE_SENTENCE: Record<NonNullable<CallHighlights["side"]>, string> = {
  buyer: "הלקוח מחפש לקנות",
  renter: "הלקוח מחפש לשכור",
  seller: "הלקוח מוכר נכס",
  landlord: "הלקוח משכיר נכס",
};

export interface CallConversionHint {
  /**
   * ‎**המרה לנכס מופיעה ראשונה.** ברירת המחדל היא „קונה ראשון”: שיחה
   * שלא זוהה בה צד היא ברוב המכריע פנייה של מחפש, וזה גם המסלול
   * הנפוץ יותר במשרד.
   */
  sellerFirst: boolean;
  /**
   * סוג העסקה שנגזר מהצד — `rent` לשוכר ולמשכיר. חסר = לא נגזר דבר,
   * והטופס נשאר על ברירת המחדל שלו.
   *
   * ‎**קנייה אינה נגזרת במפורש** אף פעם: „קונה” הוא כבר ברירת המחדל
   * של הטופס, וקביעה מפורשת שלו הייתה מסתירה מתי הזיהוי אמר משהו
   * ומתי לא.
   */
  dealType?: "rent";
  /** מה שנאמר למתווך מעל הכפתורים. ריק = לא זוהה צד, ואין מה לומר. */
  sentence: string;
}

export function callConversionHint(
  highlights: CallHighlights | undefined,
): CallConversionHint {
  const side = highlights?.side;
  if (side === undefined) return { sellerFirst: false, sentence: "" };
  return {
    sellerFirst: side === "seller" || side === "landlord",
    ...(side === "renter" || side === "landlord" ? { dealType: "rent" as const } : {}),
    sentence: `${SIDE_SENTENCE[side]} — אבל ההחלטה שלכם.`,
  };
}

/**
 * ‎**מה שהשיחה כבר ידעה — בשמות שההמרה משתמשת בהם.**
 *
 * ‏עיר, תקציב, חדרים וכתובת חולצו מהשיחה, והמסך ממלא בהם את טופס
 * ‏ההמרה מראש. הבוט לא עשה זאת: הוא המיר עם `leadId` ו-`dealType`
 * ‏בלבד, כלומר פתח כרטיס **ריק** על שיחה שכל הפרטים נאמרו בה —
 * ‏וכרטיס בלי דרישות אינו משתתף בהתאמות עד שמישהו מקליד מחדש את
 * ‏מה שכבר נשמע (ביקורת Codex, P2).
 *
 * ‏הפונקציה כאן היא המקור לשני הערוצים: המסך בונה ממנה את
 * ‎`ConvertPrefill`, והבוט את פרמטרי הפעולה. שתי חילוצים נפרדים
 * ‏מאותם `highlights` היו נפרדים בשקט ביום שנוסף שדה.
 */
export interface CallConvertSeed {
  city?: string;
  /** ‏בשקלים — תקציב אצל קונה, מחיר מבוקש אצל מוכר. */
  priceShekels?: number;
  rooms?: number;
  /** ‏כתובת שנאמרה — נכנסת לרחוב בהמרה לנכס בלבד. */
  street?: string;
}

export function callConvertSeed(
  highlights: CallHighlights | undefined,
): CallConvertSeed {
  return {
    ...(highlights?.city === undefined ? {} : { city: highlights.city }),
    ...(highlights?.budget === undefined ? {} : { priceShekels: highlights.budget }),
    ...(highlights?.rooms === undefined ? {} : { rooms: highlights.rooms }),
    ...(highlights?.address === undefined ? {} : { street: highlights.address }),
  };
}

/**
 * ‎**אותו זרע, בשמות הפרמטרים של פעולת ההמרה.**
 *
 * ‏קונה ונכס מקבלים שמות שונים לאותו נתון, וזה לא שרירותי: לקונה
 * ‏החדרים הם **טווח**, ובשיחה נאמר מספר אחד — אותה המרה שכבר
 * ‏נקבעה בקטלוג („4 חדרים” ⇒ המינימום והמקסימום 4), כדי שאותו
 * ‏משפט ייצר אותו כרטיס בכל ערוץ. הכתובת נכנסת לנכס בלבד: לקונה
 * ‏אין „רחוב”, יש אזורי חיפוש.
 */
export function callConvertParams(
  seed: CallConvertSeed,
  target: "buyer" | "property",
): Record<string, unknown> {
  if (target === "buyer") {
    return {
      ...(seed.city === undefined ? {} : { cities: [seed.city] }),
      ...(seed.rooms === undefined ? {} : { roomsMin: seed.rooms, roomsMax: seed.rooms }),
      ...(seed.priceShekels === undefined ? {} : { budgetMaxShekels: seed.priceShekels }),
    };
  }
  return {
    ...(seed.city === undefined ? {} : { city: seed.city }),
    ...(seed.rooms === undefined ? {} : { rooms: seed.rooms }),
    ...(seed.street === undefined ? {} : { street: seed.street }),
    ...(seed.priceShekels === undefined ? {} : { priceShekels: seed.priceShekels }),
  };
}
