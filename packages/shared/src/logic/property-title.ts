import { PROPERTY_TYPE_LABELS_HE } from "./csv-export.js";

/**
 * ‎**איך הנכס נקרא ללקוח.**
 *
 * ‏כל נכס אמור לקבל כותרת שיווקית, אבל רובם נפתחים מטופס מהיר
 * ‏ובלעדיה — ואז צריך שם. היו לזה שני כללים: הצעת נכס ודף השוואה
 * ‏גזרו „דירת N חדרים בעיר”, ושליחת הצעת נכס לקונים נפלה ל-
 * ‏`propertyType` הגולמי, כלומר הלקוח קיבל מייל שנושאו
 * ‏„apartment — שם המשרד” (נמצא בבדיקת QA מול המערכת החיה).
 *
 * ‏כאן הכלל אחד, והוא משתמש בתוויות העברית של קטלוג סוגי הנכס —
 * ‏ולכן פנטהאוז אינו מוצג עוד כ„דירה”. הכותרת השיווקית תמיד
 * ‏מנצחת; מה שנגזר הוא רק גיבוי.
 *
 * ‏כתובת לא נכנסת לכאן בכוונה: זה השם שיוצא ללקוח ולרשת, ושם
 * ‏הרחוב אינו נחשף לפני שהמשרד בחר לחשוף אותו.
 */
export interface ClientTitleFields {
  marketingTitle?: string | null;
  propertyType?: string | null;
  rooms?: number | null;
  city?: string | null;
}

/** ‏הכותרת השיווקית כפי שהיא, או `null` כשאין כזו — כלל אחד לשתי השאלות. */
function marketingTitleOf(property: ClientTitleFields): string | null {
  const marketing = property.marketingTitle?.trim();
  return marketing === undefined || marketing === "" ? null : marketing;
}

/**
 * ‎**האם השם נגזר מהשדות** — ולכן כבר אומר את מספר החדרים ואת העיר.
 *
 * ‏מי שמרכיב שורת פרטים אחרי השם צריך לדעת זאת, אחרת הוא חוזר
 * ‏עליהם. השאלה נענית כאן ולא אצלו, כי כאן יודעים מה נכנס לשם.
 */
export function clientTitleIsDerived(property: ClientTitleFields): boolean {
  return marketingTitleOf(property) === null;
}

export function clientPropertyTitle(property: ClientTitleFields): string {
  const marketing = marketingTitleOf(property);
  if (marketing !== null) return marketing;

  /*
   * ‎**`Object.hasOwn` ולא אינדוקס ישיר** (ביקורת Codex).
   *
   * ‏`property_type` הוא מחרוזת חופשית במסד — ייבוא, חילוץ משיחה,
   * ‏שורה ישנה — ולכן ערך כמו `constructor` מחזיר את פונקציית
   * ‏האב-טיפוס במקום `undefined`. ה-`??` אינו תופס אותו, והכותרת
   * ‏הייתה מפסיקה להיות מחרוזת: הצעה נופלת על סכימת הטיפוסים,
   * ‏ושורת הפיצ׳ זורקת על `.includes` — ובמקרה הגרוע קוד הפונקציה
   * ‏היה יוצא ללקוח.
   */
  const type = property.propertyType ?? "";
  const kind = Object.hasOwn(PROPERTY_TYPE_LABELS_HE, type)
    ? PROPERTY_TYPE_LABELS_HE[type as keyof typeof PROPERTY_TYPE_LABELS_HE]
    : "נכס";
  const rooms = property.rooms ?? null;
  /* ‏„דירה” לפני מניין חדרים נוטה ל„דירת”; שאר הסוגים אינם נוטים */
  const head =
    rooms === null || rooms <= 0
      ? kind
      : `${kind === "דירה" ? "דירת" : kind} ${rooms} חדרים`;
  const city = property.city?.trim();
  return city === undefined || city === "" ? head : `${head} ב${city}`;
}
