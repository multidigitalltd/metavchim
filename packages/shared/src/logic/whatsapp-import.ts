import type { Capability } from "../rbac.js";

/**
 * ‎**ייבוא קובץ מהוואטסאפ — מה נקלט, ומה במפורש לא.**
 *
 * ## ‏מה זה פותר
 *
 * ‏מתווך מקבל קובץ אקסל מלקוח, ממשרד שותף, או כייצוא מהמערכת
 * ‏הקודמת שלו — בוואטסאפ. עד כה הדרך היחידה פנימה הייתה לשמור
 * ‏אותו, לפתוח מחשב, להיכנס למסך הייבוא ולהעלות. שלושה מהצעדים
 * ‏האלה אינם קשורים לעבודה, ולכן הקובץ פשוט נשאר בצ'אט.
 *
 * ## ‏שלושה סוגים, ו**נכסים אינם אחד מהם**
 *
 * ‎`buyers`, `leads`, `recruitment` — שלושתם קבצים של אנשים או
 * ‏מודעות, שבהם עמודה שלא זוהתה היא פרט חסר בשורה.
 *
 * ‏ייבוא **נכסים** נשאר במסך, וזו החלטה ולא פער: קובץ נכסים נכנס
 * ‏למאגר שממנו יוצאות הצעות לקונים ושיתופי פעולה ברשת, והמסך נותן
 * ‏לו מיפוי עמודות ידני ותצוגה מקדימה של כל שורה. אישור „כן” על
 * ‏טלפון קטן אינו תחליף לזה — ומאה נכסים עם מחיר בעמודה הלא נכונה
 * ‏הם מאה הצעות שגויות שיוצאות ללקוחות.
 *
 * ## ‏והיכולת היא **אותה** יכולת
 *
 * ‏הסוכן אינו עובר בבקרים, ולכן `@RequireCapability` על נתיב
 * ‏הייבוא אינו מגן עליו. הטבלה כאן היא המקור שממנו מסלול הוואטסאפ
 * ‏בודק — אותו ערך שהבקר דורש, במקום אחד, כדי ששניהם לא ייפרדו.
 */

export const WHATSAPP_IMPORT_KINDS = ["buyers", "leads", "recruitment"] as const;
export type WhatsappImportKind = (typeof WHATSAPP_IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<WhatsappImportKind, string> = {
  buyers: "קונים",
  leads: "לידים",
  recruitment: "נכסים לגיוס",
};

/**
 * ‏היכולת שכל סוג דורש — **אותה אחת שהבקר דורש**.
 *
 * ‎`buyers.edit`, `leads.edit`, `properties.create`: ראו
 * ‎`import.controller.ts`. בדיקה מבנית אוכפת שהשתיים לא ייפרדו.
 */
export const IMPORT_KIND_CAPABILITY: Record<WhatsappImportKind, Capability> = {
  buyers: "buyers.edit",
  leads: "leads.edit",
  recruitment: "properties.create",
};

/**
 * ‎**מה המתווך אמר שיש בקובץ.**
 *
 * ‏הכיתוב של הקובץ, או התשובה לשאלה „מה יש בקובץ?”. `null` = לא
 * ‏נאמר, והסוכן שואל — ולא מנחש. ניחוש שגוי כאן פותח מאה כרטיסי
 * ‏קונה מקובץ של לידים, וזו טעות שמנקים ביד.
 */
export function importKindFromText(raw: string): WhatsappImportKind | null {
  const text = raw.trim();
  if (text === "") return null;
  /*
   * ‏„גיוס” לפני „נכס”: „נכסים לגיוס” מכיל את שניהם, והבדיקה
   * ‏הרחבה יותר הייתה בולעת אותו. סדר, ולא רשימה.
   */
  if (/גיוס|מודע/u.test(text)) return "recruitment";
  /*
   * ‎**בלי `\b`.** ב-JavaScript `\w` הוא ASCII בלבד, ולכן כל אות
   * ‏עברית היא „לא-מילה” ו-`\b` לעולם אינו מתקיים בין שתיים מהן:
   * ‎`/ליד\b/u` אינו מוצא „לידים”. גדר שנראית נכונה ואינה עושה
   * ‏דבר גרועה מאין גדר — היא משכנעת שהבדיקה נעשתה.
   */
  if (/לידים|ליד\s|^ליד$|פניות|פניה|פנייה/u.test(text)) return "leads";
  if (/קונ|רוכש|לקוחות|קליינט/u.test(text)) return "buyers";
  return null;
}

/** ‏מה הקובץ, לפי מה ש-Meta אמרה ולפי הסיומת. */
export type SheetFormat = "xlsx" | "csv" | "unsupported";

/**
 * ‎`mimeType` **וגם** שם הקובץ.
 *
 * ‏וואטסאפ שולח לעיתים `application/octet-stream` על קובץ תקין
 * ‏לגמרי — ההעברה בין אפליקציות מאבדת את הסוג. הסתמכות על אחד
 * ‏מהם בלבד הייתה דוחה קבצים אמיתיים בלי שום דרך למשתמש להבין
 * ‏למה.
 */
export function sheetFormat(mimeType: string, filename: string): SheetFormat {
  const name = filename.trim().toLowerCase();
  const mime = mimeType.trim().toLowerCase();
  if (name.endsWith(".xlsx") || mime.includes("spreadsheetml")) return "xlsx";
  if (name.endsWith(".csv") || mime === "text/csv") return "csv";
  /*
   * ‎`.xls` הישן אינו ZIP אלא פורמט בינארי אחר לגמרי, ו-`xlsxToCsv`
   * ‏לא יקרא אותו. „לא נתמך” עם הסבר עדיף על „לא הצלחתי לקרוא”
   * ‏שנשמע כמו תקלה זמנית שכדאי לנסות שוב.
   */
  return "unsupported";
}

export const UNSUPPORTED_SHEET_TEXT =
  "אני קוראת קבצי ‎.xlsx‎ ו-‎.csv‎ בלבד. אם זה קובץ ‎.xls‎ ישן — פתחו אותו באקסל ושמרו בשם כ-‎.xlsx‎, ושלחו שוב.";

/** ‏מה שנשאל כשהכיתוב לא אמר מה יש בקובץ. */
export const IMPORT_KIND_QUESTION = "מה יש בקובץ?";

export interface ImportPreview {
  kind: WhatsappImportKind;
  /** ‏שורות שיש בהן מה לכתוב */
  rows: number;
  /** ‏כותרות שלא זוהו — הפרטים שיֵרדו אם ימשיכו */
  unmapped: string[];
  filename: string;
}

/**
 * ‎**מה יקרה אם יאשרו — לפני שמשהו נכתב.**
 *
 * ‏העמודות שלא זוהו הן העיקר כאן: במסך הן מוצגות עם מיפוי ידני,
 * ‏ובטלפון אין מסך כזה. מי שרואה „‎3 עמודות לא זוהו: תקציב, אזור,
 * ‏הערות” יודע שהוא יכול לאשר ולהשלים אחר כך, או לעצור ולייבא
 * ‏מהמחשב — ומי שלא רואה אותן מגלה זאת חודש אחר כך.
 */
export function importPreviewText(preview: ImportPreview): string {
  const label = IMPORT_KIND_LABELS[preview.kind];
  const lines = [`קראתי ${preview.rows} שורות מ„${preview.filename}” לייבוא כ${label}.`];
  if (preview.unmapped.length > 0) {
    const shown = preview.unmapped.slice(0, 8);
    const rest = preview.unmapped.length - shown.length;
    lines.push(
      "",
      `${preview.unmapped.length} עמודות לא זוהו ולא ייכנסו: ${shown.join(", ")}${
        rest > 0 ? ` ועוד ${rest}` : ""
      }.`,
      "למיפוי ידני שלהן יש את מסך הייבוא במערכת.",
    );
  }
  lines.push("", "לייבא?");
  return lines.join("\n");
}

/** ‏שורה שלא נכנסה, כפי שמסלול הייבוא מדווח אותה. */
export interface ImportOutcome {
  created: number;
  failed: { row: number; error: string }[];
  warnings: { row: number; warning: string }[];
}

/** ‏כמה שורות נכשלו נאמרות בשמן — עד כאן, והשאר במספר. */
const FAILED_SHOWN = 5;

/**
 * ‎**התוצאה כפי שהיא, כולל מה שלא נכנס.**
 *
 * ‏„הייבוא הושלם” על קובץ שמחציתו נפלה הוא בדיוק סוג הדיווח
 * ‏שמתגלה כשמחפשים לקוח ולא מוצאים אותו.
 */
export function importDoneText(kind: WhatsappImportKind, result: ImportOutcome): string {
  const label = IMPORT_KIND_LABELS[kind];
  if (result.created === 0 && result.failed.length === 0) {
    return `לא נכנסה אף שורה — הקובץ נקרא, אבל לא היו בו שורות עם מספיק פרטים.`;
  }
  const lines = [`נכנסו ${result.created} ${label}.`];
  if (result.failed.length > 0) {
    lines.push("", `${result.failed.length} שורות לא נכנסו:`);
    for (const row of result.failed.slice(0, FAILED_SHOWN)) {
      lines.push(`• שורה ${row.row}: ${row.error}`);
    }
    const rest = result.failed.length - FAILED_SHOWN;
    if (rest > 0) lines.push(`• ועוד ${rest}`);
  }
  if (result.warnings.length > 0) {
    lines.push("", `${result.warnings.length} שורות נכנסו עם הערה — ראו אותן במסך.`);
  }
  return lines.join("\n");
}
