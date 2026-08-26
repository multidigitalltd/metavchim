/**
 * ‎**מסמכים שנחתמו מחוץ למערכת.**
 *
 * ‎`Agreement` הוא מסמך שהמערכת ניסחה, שלחה, והלקוח חתם עליו במסך
 * שלה: יש לה את הנוסח המדויק שהוצג (`renderedBody`), גיבוב שמוכיח
 * שהוא לא שונה אחרי החתימה (`bodyHash`), ותיעוד של רגע החתימה.
 *
 * מסמך שנחתם על נייר אינו כזה, ולכן אינו שורה באותה טבלה. אין לנו
 * את הנוסח, אין מה לגבב, ואין קישור חתימה. גיבוב שהיינו מחשבים על
 * הסריקה היה מוכיח שהתמונה לא הוחלפה — לא שהטקסט שהלקוח חתם עליו
 * הוא מה שכתוב בה. שתי טענות שונות לגמרי, ואחת מהן לא תיטען כאן.
 *
 * ## מה כן זהה
 *
 * ‎**התוצאה המשפטית.** חוק המתווכים מתנה את הזכות לדמי תיווך בהזמנה
 * בכתב חתומה — לא בהזמנה שנחתמה דווקא במסך שלנו. מתווך שמחזיק דף
 * חתום מחזיק בדיוק את מה שהחוק דורש, ולכן `documentUnlocksOffers`
 * קיימת: מסמך שהמתווך הצהיר עליו כהזמנה בכתב על נכס מסוים פותח את
 * שער ההצעות, כמו חתימה במערכת.
 *
 * ההצהרה היא של המתווך ולא של המערכת, והמסך אומר זאת. זו אותה רמת
 * אמון שכבר קיימת ב-`PropertyExclusivity.agreementId = NULL` —
 * „בלעדיות שנחתמה על נייר”.
 */

import type { AgreementKind } from "./agreement-template.js";

/**
 * סוג המסמך שהועלה.
 *
 * שני הראשונים חופפים ל-`AgreementKind` **במכוון ובאותם שמות**: הם
 * אותה טענה משפטית, ולכן `hasSigned` יכולה לחפש את שניהם באותו
 * ערך. `other` הוא כל השאר — נספח, תעודת זהות, אישור זכויות — ואינו
 * טוען דבר.
 */
export const DOCUMENT_KINDS = ["brokerage", "exclusivity", "other"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  brokerage: "הזמנה בכתב שנחתמה על נייר",
  exclusivity: "הסכם בלעדיות שנחתם על נייר",
  other: "מסמך אחר",
};

/**
 * שני הסוגים שנושאים הצהרה משפטית.
 *
 * ‎**מערך ולא רק פונקציה**, כי חלק מהצרכנים הם שאילתות: מחיקת לקוח
 * שואלת „אילו שורות נשמרות” ב-`kind: { in: … }`, ופונקציה אינה
 * נכנסת לשם. שני ניסוחים של אותה רשימה בשני מקומות הם בדיוק הפער
 * שנפער כאן פעם אחת — התנאי לשמירה היה „יש תאריך חתימה” בלי הסוג,
 * ולכן תעודת זהות שהועלתה עם תאריך שרדה מחיקת לקוח לנצח (ביקורת
 * Codex).
 */
export const OFFER_DOCUMENT_KINDS = ["brokerage", "exclusivity"] as const;

/**
 * האם המסמך הזה הוא הצהרה על הסכם חתום — ולכן פותח את שער ההצעות,
 * מחייב את פרטי החתימה, ונשמר במחיקת לקוח.
 *
 * ‎**מנוסחת כ-type predicate** כדי שהקורא לא יצטרך המרה: מה שעובר
 * כאן הוא `AgreementKind` תקף, ומה שלא — אינו. בלי זה כל אתר קריאה
 * היה עושה `as AgreementKind` על ערך שהגיע מהרשת, וזו בדיוק ההמרה
 * שמסתירה ערך לא צפוי במקום לעצור אותו.
 */
export function documentUnlocksOffers(kind: string): kind is AgreementKind {
  return (OFFER_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/**
 * ‎`YYYY-MM-DD` ⟵ תאריך, או `null` כשאין כזה תאריך בלוח השנה.
 *
 * ‎**הצורה אינה קיום.** ‎`new Date("2026-02-31")` אינו נכשל — הוא
 * גולש בשקט ל-3 במרץ, ואז נשמר כתאריך החתימה של מסמך משפטי. ‎
 * `new Date("2026-13-01")` גרוע יותר: הוא `Invalid Date`, וכל
 * השוואה עליו היא `false` — כולל „האם התאריך עתידי”. כלומר ערך
 * בלתי קריא **עבר** את השער שנועד לעצור אותו, והגיע למסד (ביקורת
 * Codex).
 *
 * הבדיקה היא הלוך-ושוב: מה שנבנה חייב להחזיר בדיוק את שלושת
 * המספרים שנמסרו. יום שגלש לחודש הבא אינו מחזיר אותם.
 */
export function parseSignedOnDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const built = new Date(Date.UTC(year, month - 1, day));
  if (
    built.getUTCFullYear() !== year ||
    built.getUTCMonth() !== month - 1 ||
    built.getUTCDate() !== day
  ) {
    return null;
  }
  return built;
}

/* ---------- זיהוי סוג הקובץ ---------- */

/**
 * הסוגים שמתקבלים: מה שיוצא מסורק ומה שיוצא מטלפון.
 *
 * ‎`Content-Type` מהדפדפן אינו גבול אמון — הוא נקבע לפי סיומת הקובץ
 * ואפשר לשנות אותו בבקשה. הזיהוי כאן הוא לפי הבתים עצמם, ומה שלא
 * זוהה נדחה. אותו כלל בדיוק שכבר חל על תמונות נכס.
 */
export interface DocumentType {
  ext: string;
  mime: string;
}

/**
 * ‎HEIC נכלל **כי כך נראה צילום מאייפון.**
 *
 * מתווך שמצלם דף חתום בטלפון מקבל HEIC בלי לדעת זאת. בלי הסוג הזה
 * הפעולה הטבעית ביותר בפיצ'ר — לצלם את הדף — הייתה נענית ב„פורמט
 * לא נתמך”, בלי שום רמז מה לעשות אחרת. הדפדפן אינו מציג HEIC בתוך
 * העמוד, ולכן הוא יורד כקובץ; זה בסדר, כי המסמך נשמר להורדה ולא
 * לצפייה מהירה.
 */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

export function sniffDocumentType(buf: Uint8Array): DocumentType | null {
  const at = (i: number): number => buf[i] ?? -1;

  // %PDF-
  if (
    buf.length >= 5 &&
    at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d
  ) {
    return { ext: "pdf", mime: "application/pdf" };
  }
  if (buf.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  // ISO-BMFF: [4 בתים אורך][ftyp][מותג]
  if (buf.length >= 12 && ascii(buf, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(buf, 8, 12))) {
    return { ext: "heic", mime: "image/heic" };
  }
  return null;
}

function ascii(buf: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i += 1) out += String.fromCharCode(buf[i] ?? 0);
  return out;
}

/* ---------- תצוגה ---------- */

/** ‎20MB — סריקה של כמה עמודים, או צילום מטלפון, נכנסים בנוח. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * גודל הקובץ כפי שהוא מוצג לצד שמו (SPEC-3c §6c).
 *
 * ‎`KB` עד מגה ו-`MB` מעליו, בספרה עשרונית אחת — „‎1.4 MB” אומר
 * למתווך מה שהוא צריך לדעת, ו„‎1,468,006 בתים” לא. אפס בתים אינו
 * מצב אפשרי (השרת דוחה קובץ ריק) ולכן אין לו ניסוח מיוחד.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * שם קובץ בטוח לתצוגה ולכותרת `Content-Disposition`.
 *
 * שם שמגיע מהדפדפן הוא קלט: הוא יכול להכיל נתיב (`../../etc/passwd`),
 * תווי בקרה, או שורה חדשה שמזריקה כותרת HTTP נוספת לתגובה. הפונקציה
 * מותירה את השם קריא בעברית — היא אינה מסננת לפי אלפבית — ומסירה
 * בדיוק את מה שמסוכן: מפרידי נתיב ותווי בקרה.
 */
export function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- תווי בקרה הם בדיוק מה שמוסר כאן
    .replace(/[\u0000-\u001F\u007F/\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return cleaned === "" ? fallback : cleaned;
}
