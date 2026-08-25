import { Prisma } from "@prisma/client";
import { waPhoneVariants } from "./assistant-lang";

/**
 * התאמת מספר שולח למספר שבפרופיל — **תנאי אחד, שני קוראים.**
 *
 * ## למה בצד ה-SQL
 *
 * ‎`phone` נשמר כפי שהוקלד ("050-123..."), והמספר שמגיע מוואטסאפ הוא
 * ספרות בלבד בצורה בינלאומית. הנרמול חייב לקרות בשאילתה, אחרת כל
 * השוואה היא בין שתי צורות של אותו מספר.
 *
 * ## למה משותף ולא בכל מקום מחדש
 *
 * שני מקומות שואלים את אותה שאלה על אותו נתון: הזיהוי („מי המספר
 * הזה”) והכתיבה („האם הוא **עדיין** שלו, עכשיו כשאני מחזיק בנעילה”).
 * שני עותקים של אותו תנאי היו נפרדים ביום שבו אחד מהם יתוקן — וזו
 * בדיוק ההשוואה שקובעת למי נפתח המאגר.
 *
 * מוחזר `null` כשאין מה להשוות: מספר ריק אינו „לא נמצא”, הוא שאלה
 * שאין לה משמעות, והקורא חייב לעצור לפניה.
 */
export function phoneDigitsCondition(waId: string): Prisma.Sql | null {
  const variants = waPhoneVariants(waId);
  const first = variants[0];
  if (first === undefined || first === "") return null;
  // שתי השוואות מפורשות ולא IN על מערך — פרמטרים פשוטים ובטוחים
  const second = variants[1] ?? first;
  return Prisma.sql`(regexp_replace(phone, '\\D', '', 'g') = ${first}
        OR regexp_replace(phone, '\\D', '', 'g') = ${second})`;
}
