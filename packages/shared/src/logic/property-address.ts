/**
 * ‎**כתובת נכס — כלל אחד, ולא נוסחה מקומית בכל מסך.**
 *
 * ## ‏מה היה כאן
 *
 * ‎`houseNumber` נאסף בכל דרך שבה נכס נכנס למערכת — הטופס החדש,
 * ‏טופס המוכר, ייבוא אקסל, וחילוץ מטקסט של שיחה — ואז **לא הוצג
 * ‏ולא היה ניתן לעריכה בשום מקום**. טופס עריכת הנכס לא כלל אותו
 * ‏כלל, וכל מסך שהרכיב כתובת עשה זאת בעצמו מ-`street` ומ-`city`
 * ‏בלבד (דיווח המשתמש).
 *
 * ‏התוצאה אינה „חסר שדה”: מתווך שראה „ירושלים, בני ברק” לא יכול
 * ‏לדעת אם זו כתובת שגויה או כתובת חלקית, ואם היה מתקן — לא הייתה
 * ‏לו דרך להקליד את המספר.
 *
 * ## ‏למה כאן ולא ב-web
 *
 * ‏אותה כתובת נבנית גם בשרת: בדוח לבעל הנכס, בהודעות לוואטסאפ
 * ‏ובכרטיס גיוס. שתי נוסחאות היו נותנות לבעל הנכס כתובת אחת
 * ‏ולמתווך אחרת על אותו נכס.
 */

/**
 * ‎**מספר בית — שלם, בלי שארית אפס.**
 *
 * ## הבעיה
 *
 * ‏בניין מספר 5 הוצג „5.0” — בשדה, בכרטיס, בפירורי הלחם ובכל
 * ‏כתובת שנבנתה ממנו (דיווח מהשטח). ‎`houseNumber` הוא **מחרוזת**
 * ‏בסכימה, ולכן זו אינה בעיית תצוגה: „5.0” הוא מה שבאמת נשמר.
 *
 * ‏המקור הוא הייבוא. גיליון שמחזיק את העמודה כמספר מייצא אותה עם
 * ‏שארית עשרונית, והערך נכנס כלשונו — איש לא הקליד אותו.
 *
 * ## הכלל
 *
 * ‎**רק שארית אפס יורדת.** „5.0” ו„12.00” הם 5 ו-12; „5.5” נשאר
 * ‏כמות שהוא, כי אם מישהו כתב אותו הוא התכוון למשהו. וכל מה
 * ‏שאינו מספר — „5א”, „12/2”, „7-9”, „ב׳” — אינו נגוע כלל:
 * ‏מספרי בית בישראל אינם מספרים, והם בדיוק מה שנרמול גס הורס.
 *
 * ## למה כאן
 *
 * ‏הכלל נאכף בסכימה (`PropertyFieldsSchema`), ולכן כל מסלול
 * ‏כתיבה — טופס, ייבוא, חילוץ מקול, והסוכן בוואטסאפ — עובר בו
 * ‏פעם אחת. הגדרה שנייה בצד התצוגה הייתה מסתירה נתון פגום במקום
 * ‏לתקן אותו, ומשאירה אותו בכתובת שנשלחת ללקוח.
 */
export function normalizeHouseNumber(raw: string): string {
  const trimmed = raw.trim();
  const match = /^(\d+)\.0+$/u.exec(trimmed);
  return match === null ? trimmed : match[1]!;
}

export interface PropertyAddressParts {
  street?: string | null;
  houseNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}

/**
 * ‏הכתובת כפי שאדם כותב אותה: „אחוזה 5, נווה זמר, רעננה”.
 *
 * ‎**המספר נצמד לרחוב ברווח ולא בפסיק** — „אחוזה, 5” אינו כתובת.
 * ‏ומספר בלי רחוב מושמט: „5, רעננה” גרוע מ„רעננה”, כי הוא נראה
 * ‏כאילו הוא אומר משהו.
 */
export function formatPropertyAddress(parts: PropertyAddressParts): string {
  const street = clean(parts.street);
  const houseNumber = clean(parts.houseNumber);
  const streetLine =
    street === undefined
      ? undefined
      : houseNumber === undefined
        ? street
        : `${street} ${houseNumber}`;
  return [streetLine, clean(parts.neighborhood), clean(parts.city)]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

/**
 * ‏הכתובת, או טקסט חלופי כשאין ממה להרכיב אותה.
 *
 * ‏קיים כדי שהמסכים לא יחזרו על ‎`|| "ללא כתובת"` איש איש בנוסח
 * ‏שלו — נכס טיוטה בלי כתובת הוא מצב רגיל, לא תקלה.
 */
export function propertyAddressOr(parts: PropertyAddressParts, fallback: string): string {
  const address = formatPropertyAddress(parts);
  return address === "" ? fallback : address;
}

function clean(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
