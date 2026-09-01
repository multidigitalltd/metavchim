import type { Prisma } from "@prisma/client";
import type { NeighborhoodUse } from "@metavchim/shared";

/**
 * ‎**השכונות שכבר נכתבו אצל הדייר — השאילתה עצמה.**
 *
 * ## למה בקובץ נפרד ולא בבקר
 *
 * זו שאילתת SQL גולמית, ולכן היא הדבר היחיד כאן שאינו נבדק על ידי
 * הקומפיילר: שם עמודה שגוי, טיפוס לא תואם, או `jsonb` שאינו מערך
 * מתגלים רק בזמן ריצה. בדיקה שמעתיקה את הטקסט שלה הייתה נבדקת
 * מול עותק ומתיישנת ברגע שמישהו יערוך את המקור — ולכן הפונקציה
 * מיוצאת, ובדיקת האינטגרציה קוראת **לה** מול מסד אמיתי.
 *
 * ## למה שאילתה ולא טבלת אוצר
 *
 * טבלה ייעודית הייתה דורשת סנכרון בכל אתר כתיבה — טופס קונה, טופס
 * נכס, שתי צורות עריכה, ייבוא CSV, הסוכן הקולי, וכל אתר שייכתב
 * מחר. אתר אחד שנשכח מייצר אוצר שמתיישן בשקט: השכונה נשמרה,
 * ההצעה אינה מכירה אותה, והמתווך הבא מקליד גרסה חדשה — כלומר
 * בדיוק הכפילות שהפיצ'ר בא למנוע. שאילתה על הנתונים עצמם אינה
 * יכולה להתיישן.
 */

/**
 * ‎**התקרה היא על מה שנקרא מהמסד, לא על מה שמוצג.**
 *
 * הסינון והאיחוד קורים בקוד המשותף כדי שהקיפול יהיה זהה לזה
 * שהלקוח מכיר, אבל אסור שהם יקבלו קלט בלתי חסום.
 */
export const VOCABULARY_MAX = 400;

/**
 * ‎**חייב לרוץ בתוך `withTenant`.** אין כאן סינון לפי דייר בכוונה:
 * ‎`FORCE ROW LEVEL SECURITY` על `properties` ועל `buyers` עושה את
 * זה, וסינון ידני לצידו היה יוצר רושם שהוא מה שמגן — עד שמישהו
 * יעתיק את השאילתה בלי הטרנזקציה.
 */
export async function neighborhoodVocabulary(
  tx: Prisma.TransactionClient,
  city: string,
): Promise<NeighborhoodUse[]> {
  /*
   * שני מקורות, כי שכונה נכתבת בשני מקומות: על נכס (עמודה), ועל
   * קונה (מערך בתוך `requirements`).
   *
   * ‎**`jsonb_typeof` אינו הגנה תיאורטית.** `jsonb_array_elements_text`
   * על ערך סקלרי זורק `cannot extract elements from a scalar`, ולכן
   * קונה בודד שאצלו `neighborhoods` אינו מערך — ייבוא ישן, תיקון
   * ידני — היה מפיל את ההצעות **לכל המשרד**, לא רק אצלו.
   */
  const rows = await tx.$queryRaw<{ name: string; count: bigint }[]>`
    SELECT name, COUNT(*)::bigint AS count
      FROM (
        SELECT p.neighborhood AS name
          FROM properties p
         WHERE p.neighborhood IS NOT NULL
           AND p.deleted_at IS NULL
           AND (${city}::text = '' OR p.city = ${city})
        UNION ALL
        SELECT n AS name
          FROM buyers b
         CROSS JOIN LATERAL jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(b.requirements -> 'neighborhoods') = 'array'
                   THEN b.requirements -> 'neighborhoods'
                   ELSE '[]'::jsonb
                 END
               ) AS n
         WHERE b.deleted_at IS NULL
           AND (
             ${city}::text = ''
             OR (
/*
                * ‎**עיר יחידה בלבד** (ביקורת Codex).
                *
                * שתי הרשימות — הערים והשכונות — הן מערכים שטוחים
                * ובלתי תלויים: אין בנתונים שום קשר בין שכונה לעיר
                * שלה. קונה שמחפש בבני ברק **וגם** בחיפה, עם
                * „פרדס כץ” ו„נווה שאנן”, היה תורם את *שתיהן*
                * לשאילתה על בני ברק — וטופס הנכס היה מציע „נווה
                * שאנן” בבני ברק. כלומר הפיצ׳ר שנועד למנוע שכונות
                * שגויות היה מלמד להזין אחת.
                *
                * כשלקונה עיר אחת, השיוך חד-משמעי וכל שכונותיו
                * שייכות לה. זה גם הרוב המכריע של הקונים, ולכן
                * המחיר נמוך — ובלי הימור על נתון שאינו קיים.
                *
                * ‎(בלי גרשיים אחוריים כאן: הטקסט יושב בתוך תבנית,
                * וגרש אחורי היה סוגר אותה באמצע השאילתה.)
                */
               jsonb_typeof(b.requirements -> 'cities') = 'array'
               AND jsonb_array_length(b.requirements -> 'cities') = 1
               AND b.requirements -> 'cities' ->> 0 = ${city}
             )
           )
      ) AS used
     WHERE btrim(name) <> ''
     GROUP BY name
     ORDER BY count DESC, name
     LIMIT ${VOCABULARY_MAX}
  `;
  /* `bigint` מ-COUNT — JSON אינו יודע לסדר אותו, והמונה קטן ממילא. */
  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}
