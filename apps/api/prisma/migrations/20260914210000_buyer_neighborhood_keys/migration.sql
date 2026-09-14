-- ‎**השכונות של הקונה כמפתחות מקופלים — העמודה שהופכת „סינון לפי שכונה” לאפשרי.**
--
-- ## למה עמודה ולא שאילתה על ה-JSON
--
-- ‏השכונות יושבות בתוך `requirements` כמערך JSON, ולצדן שמות
-- ‏הנעיצות על המפה כשדה בתוך מערך אובייקטים. סינון עליהם היה חייב
-- ‏לפתוח JSON בכל שורה ולקפל כל ערך מחדש — סריקה מלאה של טבלת
-- ‏הקונים בכל טעינת מסך. זו בדיוק הסיבה ש-`cities`,
-- ‏`has_search_areas` ו-`shared_tabu_stance` כבר יושבות כעמודות
-- ‏נגזרות לצד אותו JSON, וזו הרביעית.
--
-- ## למה מפתחות ולא שמות
--
-- ‏מה שהמתווך הקליד נשמר כמו שהוא, ולכן „שיכון ג'” ו„שיכון ג” הן
-- ‏שתי מחרוזות שונות של אותה שכונה. המפתח הוא מה שמאחד אותן, והוא
-- ‏הדבר היחיד שסינון יכול להישען עליו בלי להמציא כתיב מועדף.
--
-- ## שני מקורות, ושניהם חובה
--
-- ‏קונה אומר איפה הוא מחפש בשתי דרכים שוות ערך: רשימת שכונות
-- ‏מוקלדת, ונעיצה על המפה שהשדה שלה נקרא „שם השכונה או האזור”.
-- ‏מילוי מאחד מהם בלבד היה מחזיר „אין קונים ברמת אהרון” דווקא על
-- ‏הקונים שהסוכן נעץ שם בעצמו.
--
-- ## על הקיפול שכאן
--
-- ‏זהו התאום הקפוא של `foldedNeighborhood` (`neighborhood-vocabulary.ts`),
-- ‏ומחלקות התווים הן אותן מחרוזות בדיוק — `neighborhood-fold-parity.test.ts`
-- ‏בודק זאת תו-תו. מיגרציה היא היסטוריה ואינה רצה שוב, ולכן שינוי
-- ‏עתידי בקיפול אינו „מתקן” את העמודה: הוא הופך אותה למיושנת, וזו
-- ‏בדיוק הסיבה שהשער נשבר ודורש מילוי מחדש במיגרציה חדשה.
--
-- ‏ברירת המחדל קיימת רק לרגע ההוספה ויורדת בסוף — ראו למטה.
ALTER TABLE "buyers"
  ADD COLUMN "neighborhood_keys" TEXT[] NOT NULL DEFAULT '{}';

-- ‏מילוי לשורות שכבר קיימות. בלעדיו הסינון היה מחזיר רשימה ריקה על
-- ‏כל המאגר הקיים, עד שמישהו יערוך כל כרטיס ביד.
--
-- ‏`jsonb_typeof` אינו הגנה תיאורטית: `jsonb_array_elements` על ערך
-- ‏סקלרי זורק, ולכן קונה בודד שאצלו השדה אינו מערך — ייבוא ישן,
-- ‏תיקון ידני — היה מפיל את המיגרציה כולה.
UPDATE "buyers" AS b
   SET "neighborhood_keys" = k.keys
  FROM (
    SELECT id, array_agg(DISTINCT folded ORDER BY folded) AS keys
      FROM (
        SELECT bn.id,
               lower(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                       btrim(regexp_replace(n, '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g')),
                       '^שכונת ', ''),
                       '[\u0022\u0027\u05F3\u05F4\u2018\u2019\u201C\u201D]', '', 'g'),
                       '[\u002D\u05BE\u2010-\u2015]', ' ', 'g'),
                       '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'))) AS folded
          FROM "buyers" bn
         CROSS JOIN LATERAL jsonb_array_elements_text(
                 CASE
                   WHEN jsonb_typeof(bn.requirements -> 'neighborhoods') = 'array'
                   THEN bn.requirements -> 'neighborhoods'
                   ELSE '[]'::jsonb
                 END
               ) AS n
        UNION ALL
        SELECT ba.id,
               lower(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                       btrim(regexp_replace(a ->> 'label', '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g')),
                       '^שכונת ', ''),
                       '[\u0022\u0027\u05F3\u05F4\u2018\u2019\u201C\u201D]', '', 'g'),
                       '[\u002D\u05BE\u2010-\u2015]', ' ', 'g'),
                       '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+', ' ', 'g'))) AS folded
          FROM "buyers" ba
         CROSS JOIN LATERAL jsonb_array_elements(
                 CASE
                   WHEN jsonb_typeof(ba.requirements -> 'searchAreas') = 'array'
                   THEN ba.requirements -> 'searchAreas'
                   ELSE '[]'::jsonb
                 END
               ) AS a
         WHERE jsonb_typeof(a) = 'object'
           AND a ->> 'label' IS NOT NULL
      ) AS named
     WHERE folded <> ''
     GROUP BY id
  ) AS k
 WHERE b.id = k.id;

-- ‏אינדקס GIN — הסינון שואל „מי מכיל את המפתח הזה”, וזו בדיוק
-- ‏השאלה שאינדקס B-tree על מערך אינו יודע לענות.
--
-- ‏**חלקי** (`deleted_at IS NULL`): רשימת הקונים לעולם אינה מציגה
-- ‏מחוקים, ולכן אין טעם לתחזק אותם באינדקס. Prisma אינו יודע לתאר
-- ‏אינדקס חלקי, ולכן הוא מוגדר כאן בלבד — הכרזה בסכימה הייתה
-- ‏מייצרת סחיפה מול המסד.
CREATE INDEX "buyers_neighborhood_keys_idx"
  ON "buyers" USING GIN ("neighborhood_keys")
  WHERE "deleted_at" IS NULL;

-- ‎**וברירת המחדל יורדת עכשיו.**
--
-- ‏היא היתה דרושה רק כדי להוסיף עמודה NOT NULL לטבלה שאינה
-- ‏ריקה. מרגע זה כל כתיבה עוברת דרך `requirementColumns`, שתמיד
-- ‏מוסרת ערך — בדיוק כמו `cities` שלצידה, שאין לה ברירת
-- ‏מחדל במסד. השארתה היתה סחיפה מול הסכימה: Prisma מתאר
-- ‏מערך סקלרים בלי ברירת מחדל, וכל השוואה עתידית היתה מבקשת
-- ‏להוריד אותה שוב.
ALTER TABLE "buyers"
  ALTER COLUMN "neighborhood_keys" DROP DEFAULT;
