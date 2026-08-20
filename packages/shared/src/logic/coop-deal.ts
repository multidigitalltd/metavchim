/**
 * חדר העסקה — סביבת העבודה המשותפת של שני משרדים בשיתוף פעולה.
 *
 * ## מה היה חסר
 *
 * עד כאן הרשת ידעה לחבר: משרד פרסם, משרד אחר הציע, והצד המקבל לחץ
 * „מעניין”. שם זה נגמר — הסטטוס השתנה ל-`interested` ושום דבר אחר
 * לא קרה. שני המשרדים נשארו עם התאמה על המסך ובלי שום דרך לעבוד
 * עליה: לא ידעו מי הסוכן שמולם, לא היה איפה לתאם סיור, ומי שכן
 * המשיך עשה זאת בוואטסאפ — כלומר מחוץ למערכת, בלי תיעוד ובלי
 * שהמשרד יודע מה קרה עם הנכס שלו.
 *
 * המייל שנשלח על הצעת נכס כבר הבטיח את זה במפורש — „אישור החיבור
 * במסך פותח את הקשר בין שני המשרדים” — וגם ההערה על `CoopOffer`
 * בסכימה („כתובת מלאה רק אחרי אישור חיבור”). חדר העסקה הוא קיום
 * שתי ההבטחות האלה.
 *
 * ## מה נחשף בחדר, ומה לא
 *
 * נחשף: **הסוכנים** — שם, טלפון, אימייל ומשרד, לשני הצדדים; וכן
 * **הכתובת המדויקת של הנכס** לסוכן שמביא את הקונה, כי בלעדיה אי
 * אפשר להגיע לסיור.
 *
 * לא נחשף: **הלקוחות**. הקונה נשאר של המשרד שהביא אותו והמוכר נשאר
 * של המשרד שגייס אותו — זה בדיוק מה ששיתוף פעולה בין מתווכים הוא,
 * ולכן חדר העסקה אינו מעביר פרטי לקוח לצד השני גם אחרי החיבור.
 * מתווך שרוצה לדבר עם הלקוח של עמיתו עושה זאת דרך העמית.
 */

/* ---------- שלבי העסקה ---------- */

/**
 * השלבים לפי סדר ההתקדמות. לא סטטוס חופשי אלא ציר קצר וקבוע: שני
 * משרדים שכל אחד מהם ממציא לעצמו שמות למצבים אינם רואים אותה תמונה,
 * וכל השאלה בחדר היא „איפה זה עומד אצלך”.
 */
export const COOP_DEAL_STAGES = [
  "contact",
  "viewing",
  "negotiation",
  "signed",
  "cancelled",
] as const;

export type CoopDealStage = (typeof COOP_DEAL_STAGES)[number];

/** השלבים שמהם אין המשך — העסקה נסגרה, לטוב או לרע. */
export const COOP_DEAL_FINAL_STAGES: readonly CoopDealStage[] = [
  "signed",
  "cancelled",
];

export function isCoopDealStage(value: string): value is CoopDealStage {
  return (COOP_DEAL_STAGES as readonly string[]).includes(value);
}

export function isFinalCoopDealStage(stage: CoopDealStage): boolean {
  return COOP_DEAL_FINAL_STAGES.includes(stage);
}

/**
 * התוויות בעברית. חיות כאן ולא במסך משום שהשרת כותב אותן אל תוך
 * שורת האירוע בשרשור („מעבר לשלב סיור בנכס”), והמסך מציג את אותה
 * שורה — שני מקורות היו מייצרים שני ניסוחים לאותו מעבר.
 */
export const COOP_DEAL_STAGE_LABELS: Record<CoopDealStage, string> = {
  contact: "יצירת קשר",
  viewing: "סיור בנכס",
  negotiation: "משא ומתן",
  signed: "נחתם",
  cancelled: "לא יצא לפועל",
};

/**
 * למה כל שלב מתאים — מוצג מתחת לתווית בבורר השלב.
 *
 * לא קישוט: „משא ומתן” ו„סיור בנכס” הם מונחים שכל משרד מבין קצת
 * אחרת, והשורה הזו היא מה שמסנכרן בין השניים בלי לשאול.
 */
export const COOP_DEAL_STAGE_HINTS: Record<CoopDealStage, string> = {
  contact: "הסוכנים התחברו וטרם נקבע סיור",
  viewing: "נקבע או התקיים סיור עם הקונה",
  negotiation: "יש הצעת מחיר על השולחן",
  signed: "נחתם חוזה — העסקה נסגרה",
  cancelled: "העסקה ירדה מהפרק",
};

/**
 * מעברים מותרים.
 *
 * ציר ולא גרף מלא: אפשר להתקדם קדימה, לחזור שלב אחורה (סיור
 * שהתבטל הוא מציאות), ולסגור מכל שלב. אי אפשר לפתוח מחדש עסקה
 * סגורה — „נחתם” שחוזר ל„מו״מ” הוא שינוי היסטוריה, ושני משרדים
 * שחולקים עמלה צריכים שהרישום יהיה יציב.
 */
export function canMoveCoopDeal(from: CoopDealStage, to: CoopDealStage): boolean {
  if (from === to) return false;
  if (isFinalCoopDealStage(from)) return false;
  if (isFinalCoopDealStage(to)) return true;
  const order = COOP_DEAL_STAGES.indexOf(from);
  const target = COOP_DEAL_STAGES.indexOf(to);
  return Math.abs(order - target) === 1;
}

/**
 * הסבר הדחייה, כטקסט שאפשר להציג. `null` = המעבר מותר.
 *
 * מחזיר משפט ולא קוד שגיאה מאותה סיבה שכל שאר הכללים במערכת עושים
 * זאת: המסך והשרת חייבים לומר לסוכן את אותו הדבר.
 */
export function coopDealMoveRejectionReason(
  from: CoopDealStage,
  to: CoopDealStage,
): string | null {
  if (from === to) return "העסקה כבר נמצאת בשלב הזה";
  if (isFinalCoopDealStage(from))
    return `העסקה כבר נסגרה (${COOP_DEAL_STAGE_LABELS[from]}) ואי אפשר לפתוח אותה מחדש`;
  if (canMoveCoopDeal(from, to)) return null;
  return "אפשר להתקדם או לחזור שלב אחד בכל פעם, או לסגור את העסקה";
}

/* ---------- הודעות בחדר ---------- */

/**
 * שורה בשרשור היא או דבר שמישהו כתב, או דבר שקרה.
 *
 * טבלה אחת לשניהם ולא שתיים: הסיפור של העסקה הוא כרונולוגי, ושתי
 * רשימות נפרדות שצריך למזג בעין הן בדיוק מה שגורם לשאלה „רגע, מתי
 * עברנו למו״מ?”.
 */
export type CoopDealEntryKind = "message" | "event";

export const MAX_COOP_DEAL_MESSAGE = 2000;

/**
 * למה הודעה נדחית, או `null` כשהיא תקינה.
 *
 * גבול עליון גדול ומינימום של תו אחד אחרי גיזום: הודעה ריקה היא
 * לחיצה בטעות, וחדר שמתמלא בשורות ריקות מאבד את מה שכן נאמר בו.
 */
export function coopDealMessageRejectionReason(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return "אי אפשר לשלוח הודעה ריקה";
  if (trimmed.length > MAX_COOP_DEAL_MESSAGE)
    return `הודעה ארוכה מדי — עד ${MAX_COOP_DEAL_MESSAGE} תווים`;
  return null;
}

/** נוסח שורת האירוע על מעבר שלב — נכתב פעם אחת, נקרא בשני הצדדים. */
export function coopDealStageEventBody(
  to: CoopDealStage,
  by: string,
): string {
  return `${by} העביר את העסקה לשלב „${COOP_DEAL_STAGE_LABELS[to]}”`;
}

/* ---------- חלוקת העמלה בחדר ---------- */

/**
 * שני הצדדים של החלוקה במילים, מנקודת מבטו של הצופה.
 *
 * המספר השמור הוא תמיד חלקו של **צד הנכס**, כמו בפרסום עצמו. מסך
 * שמציג „50%” בלי לומר של מי הוא מסך שכל אחד מהצדדים קורא הפוך.
 */
export function coopDealSplitLabel(
  listingShare: number,
  viewerSide: "listing" | "buyer",
): string {
  const mine = viewerSide === "listing" ? listingShare : 100 - listingShare;
  return `${mine}% לכם · ${100 - mine}% לצד השני`;
}
