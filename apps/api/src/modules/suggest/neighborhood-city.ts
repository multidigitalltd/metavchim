import { Prisma } from "@prisma/client";
import { neighborhoodKey } from "@metavchim/shared";
import type { TenantTx } from "../../core/prisma.service";
import { foldedNeighborhood } from "./neighborhood-vocabulary";

/**
 * ‎**„באיזו עיר נמצאת השכונה הזו” — נגזר מהנתונים של המשרד עצמו.**
 *
 * ## ‏למה זה נחוץ
 *
 * ‏`city` הוא `optional` בסכמה, והטפסים דורשים אותו — אבל שלושה
 * ‏מסלולי כתיבה אינם עוברים בטופס: ייבוא אקסל, הסוכן בוואטסאפ,
 * ‏וחילוץ מצילום מודעה או מהקלטה. שם מגיעה שורה עם „פרדס כץ”
 * ‏ובלי „בני ברק”.
 *
 * ‎**ונכס בלי עיר אינו נכנס להתאמות כלל.** הסינון הגס נשען על שם
 * ‏העיר, ו-`recomputeForProperty` יוצא מוקדם בלעדיה; במנוע עצמו
 * ‏קריטריון המיקום אינו נבחן, והוא ב-`MANDATORY_MATCH_CRITERIA`.
 * ‏כלומר השורה נשמרת, נראית תקינה במסך, ואינה מתאימה לאיש — בלי
 * ‏שום סימן.
 *
 * ## ‏למה מהנתונים ולא מטבלת שכונות
 *
 * ‏אין מרשם של שכונות בישראל, ורשימה שנכתוב תתיישן ותהיה שגויה
 * ‏במשרד שעובד באזור שלא חשבנו עליו. מה שהמשרד **כבר** הקליד הוא
 * ‏המקור המדויק ביותר לשאלה הזו אצלו: „פרדס כץ” של משרד בבני ברק
 * ‏היא בני ברק, ושל משרד אחר עשויה להיות עיר אחרת.
 *
 * ## ‏למה רק מנכסים, ולא גם מקונים
 *
 * ‏על הנכס יש **עיר אחת ודאית** לצד השכונה, ולכן השיוך חד-משמעי.
 * ‏אצל הקונה שתי הרשימות שטוחות ובלתי תלויות — מי שמחפש בבני ברק
 * ‏וגם בחיפה עם „פרדס כץ” ו„נווה שאנן” אינו אומר איזו שייכת לאיזו.
 * ‏זו בדיוק הסיבה שהאוצר מצמצם שם לקונה בעל עיר יחידה, וכאן, כשאנו
 * ‏**כותבים** ערך ולא מציעים אותו, ניחוש שגוי יקר יותר.
 *
 * ‎`null` = אין תשובה, והשדה נשאר ריק. השלמה בניחוש גרועה מחוסר:
 * ‏עיר שגויה מוציאה את הנכס מהתאמות אמיתיות ומכניסה אותו לאחרות.
 */
export async function cityForNeighborhood(
  tx: TenantTx,
  neighborhood: string,
): Promise<string | null> {
  const key = neighborhoodKey(neighborhood);
  /* ‏שם שאין בו אות אינו שאלה — ראו `hasNeighborhoodName`. */
  if (key === "") return null;

  /*
   * ‎**הקיפול הוא `foldedNeighborhood` ולא ניסוח שני.** אותו ביטוי
   * ‏בדיוק שמשרת את אוצר השכונות, ולכן „שכונת פרדס-כץ” בשורה
   * ‏קיימת עונה על „פרדס כץ” שהגיע מהייבוא. ניסוח נפרד היה סוטה
   * ‏ביום שמישהו יתקן את אחד מהם.
   */
  const rows = await tx.$queryRaw<{ city: string; count: bigint }[]>`
    SELECT p.city AS city, COUNT(*)::bigint AS count
      FROM properties p
     WHERE p.deleted_at IS NULL
       AND p.city IS NOT NULL
       AND p.neighborhood IS NOT NULL
       AND ${foldedNeighborhood(Prisma.raw("p.neighborhood"))} = ${key}
     GROUP BY p.city
     /*
      * ‏הנפוצה מנצחת; שוויון נשבר אלפביתית כדי שאותם נתונים
      * ‏יחזירו תמיד אותה תשובה — השלמה שמשתנה בין ריצות היא
      * ‏נתון שאי אפשר להסביר למתווך.
      */
     ORDER BY count DESC, p.city ASC
     LIMIT 2
  `;

  if (rows.length === 0) return null;
  /*
   * ‎**תיקו אמיתי אינו תשובה.** „שיכון ג'” קיימת בכמה ערים, ואם
   * ‏שתיהן מופיעות אותו מספר פעמים אצל המשרד אין כאן ידיעה אלא
   * ‏הטלת מטבע. עדיף שדה ריק, שהמתווך רואה ומשלים.
   */
  if (rows.length > 1 && rows[0]!.count === rows[1]!.count) return null;
  return rows[0]!.city;
}
