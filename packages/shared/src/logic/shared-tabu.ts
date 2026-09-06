import type { SharedTabuStance } from "../schemas/buyer.js";

/**
 * ‎**טאבו משותף (מושאע) — שער התאמה, לא מאפיין משוקלל.**
 *
 * ‏רישום משותף אינו „נחמד שיהיה” כמו מעלית או מרפסת: אין חלקה
 * ‏נפרדת, כל עסקה דורשת התייחסות לשותפים, והבנקים מגבילים מימון.
 * ‏קונה שאמר „לא” אמר לא — ולא „פחות מעניין אותי”.
 *
 * ‏לכן זה נאכף כפסילה ולא כניקוד. משקל, ולו הכבד ביותר, היה מאפשר
 * ‏לנכס מושלם בכל שאר הקריטריונים לעלות מעל הסף ולהופיע — כלומר
 * ‏להציע לקונה בדיוק את מה שהוא סירב לו במפורש. פסילה אינה ניתנת
 * ‏לכיול, וזה העניין.
 */
export interface SharedTabuFit {
  /** ‏הנכס לא יוצג לקונה הזה בכלל */
  excluded: boolean;
  /**
   * ‏מה לומר לסוכן. `undefined` = אין מה לומר — הנכס אינו רשום
   * ‏במשותף, ושתיקה על עובדה שאינה קיימת היא הדבר הנכון.
   */
  note?: string;
  /**
   * ‎**האם ההתאמה הזו רשאית להיכנס לשידוך שותפים.**
   *
   * ‏רק „אישר במפורש”. „טרם נשאל” אינו נכנס — וזו אי-סימטריה
   * ‏מכוונת מול הפסילה: להציע נכס למי שלא נשאל הוא הצעה שאפשר
   * ‏לסרב לה בשיחה, ולצרף אותו לשותפות עם אדם אחר הוא לייחס לו
   * ‏החלטה משפטית שמעולם לא קיבל.
   */
  partnerable: boolean;
}

/** תוויות לתצוגה — מקור אחד למסך, לסינון ולהסבר ההתאמה. */
export const SHARED_TABU_STANCE_LABELS: Record<SharedTabuStance, string> = {
  accepts: "מוכן לטאבו משותף",
  refuses: "אינו מוכן לטאבו משותף",
};

/** ‏מה שכתוב על ההתאמה כשהקונה אישר — ומופיע גם בהסבר. */
export const SHARED_TABU_ACCEPTED_NOTE = "טאבו משותף — הקונה אישר מראש";
/** ‏מה שכתוב כשאיש לא שאל. משפט שמזמין שיחה, ולא פסילה שקטה. */
export const SHARED_TABU_UNKNOWN_NOTE = "טאבו משותף — לא נשאל אם הקונה מוכן לכך";
/** ‏מה שכתוב כשהקונה סירב. זו הסיבה שההתאמה אינה מוצגת. */
export const SHARED_TABU_REFUSED_NOTE = "הנכס רשום בטאבו משותף והקונה סימן שאינו מעוניין בכך";

/**
 * ‏האם להציע נכס בטאבו משותף לקונה — ומה לומר עליו.
 *
 * ‏נכס שאינו רשום במשותף אינו מושפע מהעמדה **לשום כיוון**: מי
 * ‏שסימן „מוכן” לא ביקש דווקא מושאע, הוא רק הסיר מחסום. הפיכת
 * ‏ההסכמה לדרישה הייתה מסתירה ממנו את כל השוק הרגיל.
 */
export function sharedTabuFit(
  propertySharedTabu: boolean,
  stance: SharedTabuStance | undefined,
): SharedTabuFit {
  if (!propertySharedTabu) return { excluded: false, partnerable: false };
  if (stance === "refuses") {
    return { excluded: true, note: SHARED_TABU_REFUSED_NOTE, partnerable: false };
  }
  if (stance === "accepts") {
    return { excluded: false, note: SHARED_TABU_ACCEPTED_NOTE, partnerable: true };
  }
  return { excluded: false, note: SHARED_TABU_UNKNOWN_NOTE, partnerable: false };
}
