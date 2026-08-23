/**
 * חלוקת העמלה בשני צדדים — צד הקונה וצד המוכר בנפרד.
 *
 * ## למה מספר אחד לא הספיק
 *
 * בעסקת תיווך יש **שני** תשלומים ולא אחד: הקונה משלם דמי תיווך
 * והמוכר משלם דמי תיווך. `commissionSplit` היחיד תיאר "כמה אני
 * לוקח מהעסקה", כאילו מדובר בקופה אחת, ולכן הוא לא ידע לבטא את
 * ההסדר הנפוץ ביותר בשוק — *כל צד גובה מהלקוח שלו*. גרוע מזה:
 * המסך עצמו הבטיח את ההסדר הזה במילים ("כל צד גובה מהלקוח שלו לפי
 * ההסכם שחתם איתו") בעוד השדה שמעליו כפה 33–67 על קופה מאוחדת.
 * שני המשרדים סיכמו דבר אחד וראו על המסך דבר אחר.
 *
 * ## למה „אחר” בטקסט חופשי
 *
 * חלוקות אמיתיות אינן תמיד אחוז: „כל צד גובה מהלקוח שלו”, „חצי
 * מהעמלה שלי מעל 1.5%”, „העמלה שלנו והם גובים מהמוכר בנפרד”. אחוז
 * שנכפה על הסדר כזה אינו קירוב — הוא הצהרה שגויה שהצד השני יסתמך
 * עליה. עדיף משפט מדויק בכתב על מספר לא נכון.
 *
 * ## מה נשאר מהמודל הישן
 *
 * `commissionSplit` נשאר על השורה כ**כותרת** — המספר שהצעה, הצעה
 * נגדית וחדר עסקה נושאים. הוא נגזר מהצד שהמשרד המפרסם מחזיק, ואינו
 * מוצג יותר במקום שבו התנאים המלאים זמינים: מסך שמראה "50% / 50%"
 * על פרסום שתנאיו נוסחו במילים הוא בדיוק אותה הצהרה שגויה.
 */

import {
  DEFAULT_COMMISSION_SPLIT,
  commissionSplitRejectionReason,
  describeCommissionSplit,
} from "./collaboration-cost.js";

/** צד העסקה — מי מבין שני הלקוחות משלם את דמי התיווך הנחלקים. */
export type CommissionSide = "buyer" | "seller";

/** סדר הלשוניות במסך. צד הקונה ראשון — הוא זה שנשאל עליו קודם. */
export const COMMISSION_SIDES: readonly CommissionSide[] = ["buyer", "seller"];

/** תווית הלשונית. */
export const COMMISSION_SIDE_LABEL: Readonly<Record<CommissionSide, string>> = {
  buyer: "חלוקת צד קונה",
  seller: "חלוקת צד מוכר",
};

/** מה בדיוק נחלק בלשונית הזו — משפט אחד מתחת לתווית. */
export const COMMISSION_SIDE_HINT: Readonly<Record<CommissionSide, string>> = {
  buyer: "דמי התיווך שהקונה משלם — איך הם מתחלקים בין שני המשרדים.",
  seller: "דמי התיווך שהמוכר משלם — איך הם מתחלקים בין שני המשרדים.",
};

/**
 * החלוקה בצד אחד.
 *
 * `split` הוא האחוז שהמשרד **המפרסם** לוקח, בדיוק כמו במודל הישן;
 * `null` פירושו „אחר”, ואז `note` נושא את הניסוח. שני השדות לעולם
 * אינם מלאים יחד — `normalizeCommissionSide` דואג לזה — כי ניסוח
 * שנשאר תלוי לצד אחוז הוא בדיוק המקום שבו שני המסכים יראו שני
 * דברים שונים.
 */
export interface CommissionSideTerms {
  split: number | null;
  note: string | null;
}

/** שני הצדדים יחד — מה שנשמר על הפרסום ומה שמוצג עליו. */
export type CommissionTerms = Readonly<Record<CommissionSide, CommissionSideTerms>>;

/**
 * אורך הניסוח החופשי.
 *
 * המקסימום זהה ל-`VarChar(200)` בסכימה: ניסוח שנחתך בשמירה הוא
 * תנאי שהצד השני יקרא חצי ממנו.
 */
export const OTHER_SPLIT_MIN_NOTE = 3;
export const OTHER_SPLIT_MAX_NOTE = 200;

/** חלוקה באחוז — הצורה הרגילה. */
export function splitTerms(share: number): CommissionSideTerms {
  return { split: share, note: null };
}

/** חלוקה מנוסחת במילים — „אחר”. */
export function otherTerms(note: string): CommissionSideTerms {
  return { split: null, note };
}

/** שני הצדדים באותו אחוז — ברירת המחדל, וגם המשמעות של פרסום ישן. */
export function uniformTerms(share: number): CommissionTerms {
  return { buyer: splitTerms(share), seller: splitTerms(share) };
}

/** ברירת המחדל בטופס: 50/50 בשני הצדדים. */
export function defaultCommissionTerms(): CommissionTerms {
  return uniformTerms(DEFAULT_COMMISSION_SPLIT);
}

/**
 * ניקוי לפני שמירה — חותך רווחים ומוחק את מה שאינו שייך.
 *
 * הניסוח נמחק כשיש אחוז ולהפך: מי שהקליד „אחר”, כתב משפט, ואז חזר
 * לאחוז — היה משאיר בשורה ניסוח שאיש אינו רואה, עד שמסך כלשהו
 * יעדיף אותו על האחוז ויציג תנאי שבוטל.
 */
export function normalizeCommissionSide(
  terms: CommissionSideTerms,
): CommissionSideTerms {
  if (terms.split === null) {
    return { split: null, note: (terms.note ?? "").trim() };
  }
  return { split: terms.split, note: null };
}

/** אותו ניקוי לשני הצדדים. */
export function normalizeCommissionTerms(terms: CommissionTerms): CommissionTerms {
  return {
    buyer: normalizeCommissionSide(terms.buyer),
    seller: normalizeCommissionSide(terms.seller),
  };
}

/**
 * תקינות צד אחד — הודעה בעברית או `null`.
 *
 * ההודעה נושאת את שם הלשונית: „תיאור החלוקה קצר מדי” על מסך עם שתי
 * לשוניות אינו אומר באיזו מהן לתקן.
 */
export function commissionSideRejectionReason(
  side: CommissionSide,
  terms: CommissionSideTerms,
): string | null {
  const clean = normalizeCommissionSide(terms);
  const label = COMMISSION_SIDE_LABEL[side];
  if (clean.split === null) {
    const note = clean.note ?? "";
    if (note.length < OTHER_SPLIT_MIN_NOTE) {
      return `${label}: בחרתם „אחר” — כתבו איך תתחלק העמלה`;
    }
    if (note.length > OTHER_SPLIT_MAX_NOTE) {
      return `${label}: תיאור החלוקה ארוך מדי — עד ${OTHER_SPLIT_MAX_NOTE} תווים`;
    }
    return null;
  }
  const rejection = commissionSplitRejectionReason(clean.split);
  return rejection === null ? null : `${label}: ${rejection}`;
}

/** תקינות שני הצדדים; ההודעה הראשונה שנמצאה, או `null`. */
export function commissionTermsRejectionReason(
  terms: CommissionTerms,
): string | null {
  for (const side of COMMISSION_SIDES) {
    const rejection = commissionSideRejectionReason(side, terms[side]);
    if (rejection !== null) return rejection;
  }
  return null;
}

/**
 * הניסוח שמוצג לצד אחד: „‎50% / 50%” או המשפט שנכתב.
 *
 * צד פגום (`אחר` בלי ניסוח) אינו אמור להגיע לכאן — הוא נחסם
 * בשמירה — אבל שורה ישנה או נתון שנפגם עדיין חייבים תשובה כנה,
 * ו„לא צוין” היא התשובה הכנה. מספר מומצא כאן היה תנאי שאיש לא סיכם.
 */
export function describeCommissionSide(terms: CommissionSideTerms): string {
  if (terms.split !== null) return describeCommissionSplit(terms.split);
  const note = (terms.note ?? "").trim();
  return note === "" ? "לא צוין" : note;
}

/**
 * שורה אחת לשני הצדדים, כשאין מקום ללשוניות (צ'יפ בכרטיס).
 *
 * חלוקה זהה בשני הצדדים מוצגת פעם אחת: „‎50% / 50% · 50% / 50%”
 * אינו מוסיף מידע, והוא מייצר רעש בדיוק במקרה הנפוץ ביותר.
 */
export function describeCommissionTerms(terms: CommissionTerms): string {
  const buyer = describeCommissionSide(terms.buyer);
  const seller = describeCommissionSide(terms.seller);
  if (buyer === seller) return buyer;
  return `קונה ${buyer} · מוכר ${seller}`;
}

/** צורת השורה בבסיס הנתונים — פרסום קונה או פרסום נכס, אותם שדות. */
export interface CommissionTermsRow {
  /** הכותרת הישנה; המשמעות של פרסום שקדם לשני הצדדים. */
  commissionSplit: number;
  buyerSplit?: number | null;
  buyerSplitNote?: string | null;
  sellerSplit?: number | null;
  sellerSplitNote?: string | null;
}

function sideFromRow(
  split: number | null | undefined,
  note: string | null | undefined,
  legacy: number,
): CommissionSideTerms {
  if (typeof split === "number") return splitTerms(split);
  const text = (note ?? "").trim();
  if (text !== "") return otherTerms(text);
  return splitTerms(legacy);
}

/**
 * התנאים כפי שיש להציג אותם, מתוך שורה בבסיס הנתונים.
 *
 * פרסום שקדם לעמודות החדשות נופל ל-`commissionSplit` בשני הצדדים —
 * וזו אינה השלמה אלא בדיוק מה שהוא אמר: קופה אחת, חלוקה אחת. ההפרדה
 * לצדדים לא שינתה למפרע תנאים שסוכמו.
 */
export function commissionTermsFromRow(row: CommissionTermsRow): CommissionTerms {
  return {
    buyer: sideFromRow(row.buyerSplit, row.buyerSplitNote, row.commissionSplit),
    seller: sideFromRow(row.sellerSplit, row.sellerSplitNote, row.commissionSplit),
  };
}

/**
 * הכותרת שנשמרת ב-`commissionSplit` — האחוז של הצד שהמשרד המפרסם
 * מחזיק.
 *
 * משרד שמשתף **קונה** מחזיק את צד הקונה; משרד שמפרסם **נכס** מחזיק
 * את צד המוכר. זה בדיוק מה ש-`commissionSplit` תמיד תיאר („האחוז
 * שהמשרד המשתף לוקח”), ולכן הגזירה אינה משנה את משמעותו.
 *
 * כשהצד הזה נוסח במילים אין ממנו מספר, והכותרת נופלת לברירת המחדל.
 * הנפילה הזו משרתת **רק** את ברירת המחדל בבורר של ההצעה הנגדית;
 * שום מסך אינו מציג אותה כתנאי הפרסום, כי היא אינה כזו.
 */
export function headlineCommissionSplit(
  terms: CommissionTerms,
  publisherSide: CommissionSide,
): number {
  return terms[publisherSide].split ?? DEFAULT_COMMISSION_SPLIT;
}

/** הצד שהמשרד המפרסם מחזיק, לפי מה שהוא פרסם. */
export function publisherSideOf(kind: "buyer" | "property"): CommissionSide {
  return kind === "buyer" ? "buyer" : "seller";
}

/** השדות כפי שהם נכתבים לשורה — `null` בצד שנשאר באחוז. */
export function commissionTermsColumns(terms: CommissionTerms): {
  buyerSplit: number | null;
  buyerSplitNote: string | null;
  sellerSplit: number | null;
  sellerSplitNote: string | null;
} {
  const clean = normalizeCommissionTerms(terms);
  return {
    buyerSplit: clean.buyer.split,
    buyerSplitNote: clean.buyer.split === null ? clean.buyer.note : null,
    sellerSplit: clean.seller.split,
    sellerSplitNote: clean.seller.split === null ? clean.seller.note : null,
  };
}
