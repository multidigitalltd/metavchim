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
/**
 * ‎**עמדת הקונה — מהשדה המפורש, ואחרת מהדרישה הישנה** (ביקורת
 * ‏Codex, P1).
 *
 * ## ‏אותה טעות בדיוק, בצד השני של השידוך
 *
 * ‏בצד הנכס כבר קבעתי שהדגל הוא הבית והסוג הוא קלט לגיטימי שנכתב
 * ‏לתוכו (`isSharedTabuProperty`). בצד הקונה הוספתי עמודה חדשה
 * ‏ולא עשיתי את אותו דבר: קונה שביקש `propertyTypes: ["shared_tabu"]`
 * ‏— והם קיימים מאז לפני ה-PR הזה — נשאר עם עמדה `NULL`, כלומר
 * ‏„טרם נשאל”, ונפל מחוץ לשידוך השותפים.
 *
 * ‏זה בדיוק ההפך מהכוונה: אלה **הקונים היחידים שכבר אמרו** שהם
 * ‏מוכנים לטאבו משותף, והם היו האחרונים לקבל את הפיצ׳ר. וזה חוזר
 * ‏גם בטופס החדש — מי שבוחר את סוג הנכס ומשאיר „טרם נשאל”.
 *
 * ## ‏למה `refuses` גובר, ו„טרם נשאל” אינו
 *
 * ‏סירוב מפורש הוא אמירה של הלקוח; „טרם נשאל” הוא היעדר אמירה,
 * ‏והדרישה הישנה **היא** האמירה שבאה במקומה. לכן `undefined` פונה
 * ‏לדרישה, וכל ערך מפורש עומד בפני עצמו.
 */
export function buyerSharedTabuStance(requirements: {
  sharedTabu?: SharedTabuStance | undefined;
  propertyTypes?: readonly string[] | undefined;
}): SharedTabuStance | undefined {
  if (requirements.sharedTabu !== undefined) return requirements.sharedTabu;
  return requirements.propertyTypes?.includes(SHARED_TABU_PROPERTY_TYPE) === true
    ? "accepts"
    : undefined;
}

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

/**
 * ‎**הערך שקדם לדגל — והסיבה שיש שני מקורות לעובדה אחת.**
 *
 * ‏`shared_tabu` קיים ב-`PropertyTypeSchema` מלפני הדגל, והמסלולים
 * ‏שמזינים אותו חיים: מחלץ הנכס מהקלטה, ייבוא ה-CSV, וכל שורה
 * ‏שנרשמה כך עד היום. דגל בוליאני חדש לצדו אינו „שדה נוסף” אלא
 * ‏**פיצול של מקור האמת**, ושתי הדליפות שלו הפוכות זו לזו:
 *
 * ‏דירה רגילה שסומן עליה הדגל **נפסלה** מקונה שביקש את הסוג
 * ‏הקיים, ונכס שנרשם בסוג הקיים נשאר עם דגל `false` — כלומר בלי
 * ‏האזהרה המשפטית, בלי הסינון, ובלי שידוך שותפים. דווקא הנכסים
 * ‏שהתכונה נבנתה בשבילם היו היחידים שלא מקבלים אותה.
 *
 * ‏לכן שאלה **אחת**: הדגל או הסוג. הדגל הוא הצורה המדויקת יותר —
 * ‏הוא מרכיב עם כל סוג מבנה, בעוד שהסוג תופס את המשבצת היחידה
 * ‏ומוחק את המידע „פנטהאוז” או „דירת גן”. הסוג נשאר כקלט לגיטימי
 * ‏שנכתב אל הדגל, ולא נמחק: שורות קיימות נושאות אותו, וקונים
 * ‏ביקשו אותו ברשימת הסוגים שלהם.
 */
export const SHARED_TABU_PROPERTY_TYPE = "shared_tabu";

/**
 * ‏האם הנכס רשום בטאבו משותף — **התשובה היחידה בקוד.**
 *
 * ‏כל מי ששואל את השאלה קורא לכאן: המנוע, שידוך השותפים, המיפוי
 * ‏מהשורה ואליה. הצורה השנייה היחידה היא ה-SQL של הסינון, והיא
 * ‏נבדקת מול הפונקציה הזו על אותה טבלת מקרים.
 */
export function isSharedTabuProperty(fields: {
  sharedTabu?: boolean | undefined;
  propertyType?: string | null | undefined;
}): boolean {
  return fields.sharedTabu === true || fields.propertyType === SHARED_TABU_PROPERTY_TYPE;
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
