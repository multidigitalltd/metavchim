import { Prisma } from "@prisma/client";
import { neighborhoodKey, normalizeLocationName } from "@metavchim/shared";
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
  /*
   * ‎**ה-SQL סופר, וההכרעה נעשית בקוד** — ובכוונה.
   *
   * ‏קיבוץ על המחרוזת הגולמית מפצל את הקולות בין כתיבים שכל שאר
   * ‏המערכת מתייחסת אליהם כאותו מקום: „תל אביב” ו„תל אביב-יפו” הן
   * ‏אותה עיר ב-`normalizeLocationName`, וכאן היו שתי מועמדות —
   * ‏מה שהופך שכונה חד-משמעית ל„תיקו” ומחזיר ריק (ביקורת Codex).
   *
   * ‏הנרמול הזה חי ב-JavaScript ולא ב-SQL, ותרגום שלו לשאילתה היה
   * ‏הכלל השני שהקובץ הזה קיים כדי למנוע. לכן המסד מחזיר את
   * ‏הספירה הגולמית והאיחוד נעשה כאן, באותה פונקציה שההתאמות
   * ‏משתמשות בה.
   */
  const rows = await tx.$queryRaw<{ city: string; count: bigint }[]>`
    SELECT p.city AS city, COUNT(*)::bigint AS count
      FROM properties p
     WHERE p.deleted_at IS NULL
       AND p.city IS NOT NULL
       AND p.neighborhood IS NOT NULL
       AND ${foldedNeighborhood(Prisma.raw("p.neighborhood"))} = ${key}
     GROUP BY p.city
  `;

  /*
   * ‎**עיר של רווחים אינה עיר.** הסכמה היא `z.string().min(1)`,
   * ‏שמקבלת `" "` — ו-`withCompletedCity` מתייחס אליה כחסרה. בלי
   * ‏הסינון כאן היא הייתה מועמדת לגיטימית, נכתבת על נכס חדש,
   * ‏ומרחיקה אותו מקוני העיר בשקט: הגיאוקודינג גוזר אותה, וההתאמות
   * ‏רואות עיר לא-ריקה שכל הכתיבים שלה ריקים (ביקורת Codex).
   */
  const byCanonical = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const row of rows) {
    const canonical = normalizeLocationName(row.city);
    if (canonical === "") continue;
    const entry = byCanonical.get(canonical) ?? { count: 0, forms: new Map() };
    entry.count += Number(row.count);
    entry.forms.set(row.city, (entry.forms.get(row.city) ?? 0) + Number(row.count));
    byCanonical.set(canonical, entry);
  }
  if (byCanonical.size === 0) return null;

  /* ‏הנפוצה מנצחת; שוויון נשבר אלפביתית כדי שהתשובה לא תשתנה בין ריצות. */
  const ranked = [...byCanonical.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "he"),
  );
  /*
   * ‎**תיקו אמיתי אינו תשובה.** „שיכון ג'” קיימת בכמה ערים, ואם
   * ‏שתיהן מופיעות אותו מספר פעמים אצל המשרד אין כאן ידיעה אלא
   * ‏הטלת מטבע. עדיף שדה ריק, שהמתווך רואה ומשלים.
   */
  if (ranked.length > 1 && ranked[0]![1].count === ranked[1]![1].count) return null;

  /*
   * ‏הצורה שנכתבת היא **הכתיב הנפוץ במשרד** ולא הצורה הקנונית:
   * ‏משרד שכותב „תל אביב” לא אמור לגלות „תל אביב יפו” בכרטיס.
   */
  const [best] = [...ranked[0]![1].forms.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"),
  );
  return best![0];
}
