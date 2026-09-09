/**
 * ‎**„המר ללקוח” — הכללים והניסוח שהמסך והבוט חולקים.**
 *
 * ‏המסך כבר מציע את ההמרה על כל שיחה. מתווך שקיבל התראה על שיחה
 * ‏שלא נענתה נמצא **בטלפון**, ושליחתו לפתוח את המערכת כדי ללחוץ
 * ‏על כפתור שההתראה עצמה יכלה לשאת היא בדיוק החיכוך שבגללו לקוח
 * ‏נשאר לא מטופל (בקשת המשתמש).
 *
 * ‎**אותם ארבעה סוגים, ובאותו מיפוי בדיוק** — כי שני ניסוחים של
 * ‏„מה זה מוכר” היו נפרדים בשקט, ואז אותה מילה פותחת כרטיס אחר
 * ‏בכל ערוץ. מאותה סיבה גם „איזו שיחה אפשר להמיר” יושב כאן ולא
 * ‏פעמיים. „ליד” אינו כאן: מי שכבר לחץ „המר ללקוח” אמר שהוא
 * ‏יודע מה זה, והשיחה כבר יצרה ליד ממילא.
 */

import type { z } from "zod";
import { IdSchema } from "../schemas/common.js";
import type { DealTypeSchema } from "../schemas/property.js";

export const CALL_CONVERT_KINDS = ["buyer", "renter", "seller", "landlord"] as const;
export type CallConvertKind = (typeof CALL_CONVERT_KINDS)[number];

export interface CallConvertInfo {
  kind: CallConvertKind;
  label: string;
  /** ‏קונה או נכס — הצורה שנפתחת */
  target: "buyer" | "property";
  /** ‏מהסכמה ולא מרשימה שנייה — „מכירה/השכרה” מוגדר במקום אחד */
  dealType: z.infer<typeof DealTypeSchema>;
}

/**
 * ‏הסדר אינו שרירותי: קונה ושוכר קודם, כי שיחה נכנסת שלא נענתה
 * ‏היא ברוב המקרים מישהו שמחפש. וואטסאפ מציגה שלושה כפתורים
 * ‏לכל היותר, ולכן הרשימה נאמרת בטקסט והתשובה מוקלדת.
 */
export const CALL_CONVERT_INFO: readonly CallConvertInfo[] = [
  { kind: "buyer", label: "קונה", target: "buyer", dealType: "sale" },
  { kind: "renter", label: "שוכר", target: "buyer", dealType: "rent" },
  { kind: "seller", label: "מוכר", target: "property", dealType: "sale" },
  { kind: "landlord", label: "משכיר", target: "property", dealType: "rent" },
];

export function callConvertInfo(kind: CallConvertKind): CallConvertInfo {
  return CALL_CONVERT_INFO.find((info) => info.kind === kind)!;
}

/**
 * ‎**רק הסוגים שהמתווך הזה באמת יכול להשלים** (ביקורת Codex, P2).
 *
 * ‏קונה ושוכר פותחים כרטיס קונה (`buyers.edit`), מוכר ומשכיר פותחים
 * ‏נכס (`properties.create`). מי שיש לו `leads.edit` בלבד ראה את
 * ‏כל הארבעה, ובחירה באחד שאינו מותר לו הייתה **פותחת ליד** ואז
 * ‏נדחית בשער של הפעולה — כלומר תפריט שמפרסם מה שאינו יכול לבצע,
 * ‏ומשאיר אחריו ליד שנפתח לחינם.
 *
 * ‏מסך השיחות כבר מסנן כך (`mayBuyer`/`mayProperty`), וזו אותה
 * ‏הכרעה — ולכן היא כאן ולא בשני עותקים.
 *
 * ‏רשימה ריקה = אין מה להציע, והקורא אומר זאת במקום לשאול.
 */
export function callConvertKindsFor(
  can: (capability: "buyers.edit" | "properties.create") => boolean,
): readonly CallConvertInfo[] {
  return CALL_CONVERT_INFO.filter((info) =>
    info.target === "buyer" ? can("buyers.edit") : can("properties.create"),
  );
}

/** ‏מה שנאמר כשאין אף סוג שמותר לפתוח — הרשאה, לא היעדר שיחה. */
export const CALL_CONVERT_NO_KINDS =
  "אין לך הרשאה לפתוח כרטיס קונה או נכס. אפשר לבקש ממנהל המשרד, והשיחה נשארת ברשימה.";

/**
 * ‎**איזו שיחה אפשר להמיר — כלל אחד לשני הערוצים.**
 *
 * ‏שני תנאים, ושניהם על **צורת הרשומה** ולא על ההרשאות: ליד שכבר
 * ‏הומר אין מה להמיר שוב, וליד שקיים אך אינו מוחזר עם סטטוס שייך
 * ‏לסוכן אחר — השרת מחזיר סטטוס רק לליד שמותר לגעת בו, ולכן
 * ‏נוכחות השדה היא הרשות (ביקורת Codex על מסך השיחות).
 *
 * ‏שיחה **בלי** ליד היא דווקא המקרה שבשבילו זה נבנה: מתקשר לא
 * ‏מוכר, שהליד שלו נפתח בלחיצה עצמה.
 *
 * ‏ההרשאות נשארות אצל הקורא, כי הן שונות בין הערוצים: המסך מסתיר
 * ‏כפתור, והבוט עובר בשער של `execute` לפי הפעולה שנבחרה.
 */
export function callIsConvertible(call: {
  leadId?: string | undefined;
  leadStatus?: string | undefined;
}): boolean {
  if (call.leadStatus === "converted") return false;
  return !(call.leadId !== undefined && call.leadStatus === undefined);
}

/**
 * ‎**מי בשיחה — בלי טלפון.**
 *
 * ‏השאלה נשמרת בזיכרון השיחה, וזיכרון השיחה נוסע לפרומפט של מודל
 * ‏חיצוני. טלפון אינו מגיע לשם לעולם (אותו כלל שבגללו `link` הוא
 * ‏שדה נפרד מ-`message`), ולכן כשאין שם מזוהה השיחה **לפי מתי היא
 * ‏הייתה** — מספיק כדי לדעת על מה מדובר, ובלי פרט מזהה.
 */
export function callConvertSubject(call: {
  name?: string | undefined;
  when: string;
}): string {
  return call.name === undefined || call.name.trim() === ""
    ? `השיחה מ-${call.when}`
    : `השיחה עם ${call.name.trim()}`;
}

/**
 * ‎**השאלה — ועל מי היא נשאלת.**
 *
 * ‏הזיהוי בשאלה אינו קישוט: כשההמרה מתחילה מהקלדה („המר ללקוח”)
 * ‏הפעולה בוחרת את השיחה האחרונה שאפשר להמיר, והמתווך חייב לדעת
 * ‏על מי מדובר **לפני** שהוא עונה. שאלה בלי נושא היא בקשה לנחש.
 */
export function callConvertQuestion(
  subject: string,
  offered: readonly CallConvertInfo[] = CALL_CONVERT_INFO,
): string {
  const kinds = offered.map((info) => info.label).join(" / ");
  return [
    `${subject} — מה הצד השני?`,
    "",
    kinds,
    "",
    /*
     * ‏„ביטול” נצרך על ידי `isCancelMessage` המשותף, שרץ לפני כל
     * ‏מצב ממתין — ולא על ידי רשימת מילים משלנו. שתי רשימות ביטול
     * ‏היו נפרדות בשקט, ומילה שעובדת בכל שאר הבוט הייתה מפסיקה
     * ‏לעבוד כאן בלבד.
     *
     * ‎**והשורה נכונה בשני הערוצים.** הפעולה נמצאת בקטלוג, כלומר
     * ‏גם מסך הסוכן מגיע אליה — ושם אין מצב ממתין: התשובה נבחרת
     * ‏בכפתורים שתחת השיחה, לשם גם מוביל `href`. „ענו במילה אחת”
     * ‏לבדו היה מבקש שם משהו שאי אפשר לעשות.
     */
    "במילה אחת, או „ביטול”. במסך — הכפתורים שתחת השיחה.",
  ].join("\n");
}

/**
 * ‎**הפקודה שהכפתור נושא — ובתוכה השיחה שההתראה דיברה עליה.**
 *
 * ‏הודעה בוואטסאפ נשארת בצ'אט לנצח והכפתורים שלה נשארים לחיצים.
 * ‏„המר ללקוח” בלי מזהה היה מתייחס תמיד ל**אחרונה**: לחיצה על
 * ‏כפתור של יום שני, אחרי ששיחה חדשה נכנסה ביום שלישי, הייתה
 * ‏פותחת כרטיס על האדם הלא נכון. אותו נימוק בדיוק שבגללו כפתור
 * ‏המשוב של המנטור נושא את מפתח הרעיון שהוצג.
 *
 * ## ‏למה שלושה סוגים של מצביע ולא „מזהה שיחה”
 *
 * ‏ההתראה על שיחה שלא נענתה — **המקרה שבשבילו זה נבנה** — אינה
 * ‏מצביעה על השיחה אלא על מי שהתקשר: ליד אם נפתח, ואחרת הכרטיס.
 * ‏רק התראת התמלול מצביעה על השיחה עצמה. מצביע מסוג אחד היה
 * ‏מכסה את הסיכום ומחמיץ את השיחה שלא נענתה, ולכן הכפתור נושא
 * ‏את מה שההתראה באמת יודעת, והפעולה שולפת ממנו את השיחה.
 *
 * ‏המצביע בסוגריים ולא בשדה של הקטלוג: מה שהכפתור שולח **נכנס
 * ‏למנוע כאילו הוקלד**, ושדה שמוצהר בקטלוג הוא שדה שהמודל ינסה
 * ‏למלא — כלומר ינחש מזהים.
 *
 * ‎**והמשפט עצמו מגיע מהקורא, מהקטלוג.** `examples[0]` הוא הניסוח
 * ‏שהמערכת מבטיחה שהיא מכירה; ניסוח שנכתב כאן ביד היה מתיישן
 * ‏ברגע שהקטלוג משתנה, בשקט — ואז הכפתור מחזיר „לא הבנתי”.
 */
export const CALL_CONVERT_REF_KINDS = ["call", "lead", "contact"] as const;
export type CallConvertRefKind = (typeof CALL_CONVERT_REF_KINDS)[number];
export interface CallConvertRef {
  kind: CallConvertRefKind;
  id: string;
}

export function callConvertCommand(said: string, ref: CallConvertRef): string {
  return `${said} [${ref.kind}:${ref.id}]`;
}

/**
 * ‏המצביע שבסוגריים, אם יש. הקלדה חופשית אינה נושאת אותו — וזה
 * ‏תקין, ואז נבחרת „השיחה האחרונה שאפשר להמיר”.
 *
 * ‏מה תקין כמזהה נשאל את `IdSchema` ולא נכתב כאן כתבנית שנייה:
 * ‏העתק של אותה תבנית הוא בדיוק מה שנפרד בשקט ביום שהצורה
 * ‏משתנה.
 */
export function callConvertRefInCommand(text: string): CallConvertRef | null {
  const inside = /\[([a-z]{1,10}):([^\]]{1,64})\]/u.exec(text);
  if (inside === null) return null;
  const kind = inside[1] as CallConvertRefKind;
  const id = inside[2]!;
  if (!CALL_CONVERT_REF_KINDS.includes(kind)) return null;
  return IdSchema.safeParse(id).success ? { kind, id } : null;
}

/**
 * ‎**איזה סוג נאמר — דטרמיניסטית, בלי מודל.**
 *
 * ‏התשובה מגיעה כשהמצב הממתין פתוח, ולכן היא אינה עוברת בהבנה
 * ‏החכמה כלל: „מוכר” לבדו הוא משפט שמנוע ההבנה היה מחפש בו
 * ‏פעולה ולא מוצא. אותו נימוק בדיוק שבגללו התרגול והרפלקציה הם
 * ‏מסלולים משלהם.
 *
 * ‏ההשוואה על מילה שלמה ולא „מכיל”: „לא מוכר” אינו „מוכר”,
 * ‏ו„הקונה כבר קנה” אינו בחירה.
 */
export function callConvertKindFromText(
  text: string,
  normalize: (v: string) => string,
): CallConvertKind | null {
  const t = normalize(text);
  const exact = CALL_CONVERT_INFO.find((info) => info.label === t);
  if (exact !== undefined) return exact.kind;
  /*
   * ‏צורות שמתווך באמת כותב. „משכירה”/„מוכרת” נכללות כי הצד
   * ‏השני של השיחה הוא לעיתים אישה, וסירוב על זה הוא רעש.
   */
  if (/^(קונה|קונים|לקנות|רוצה\s+לקנות)$/u.test(t)) return "buyer";
  if (/^(שוכר|שוכרת|שכירות|לשכור|רוצה\s+לשכור)$/u.test(t)) return "renter";
  if (/^(מוכר|מוכרת|למכור|רוצה\s+למכור)$/u.test(t)) return "seller";
  if (/^(משכיר|משכירה|להשכיר|רוצה\s+להשכיר)$/u.test(t)) return "landlord";
  return null;
}

/** ‏מה שנאמר כשלא נמצאה שיחה להמיר — עובדה, לא שגיאה. */
export const CALL_CONVERT_NONE =
  "לא מצאתי שיחה אחרונה שאפשר להמיר. שיחה שכבר הפכה ללקוח אינה מומרת שוב.";
