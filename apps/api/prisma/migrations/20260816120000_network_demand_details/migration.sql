-- ============================================================
-- ביקוש ברשת — כל מה שאינו מזהה אדם.
--
-- הטבלה שמרה ארבעה פרטים: ערים, חדרים, תקציב ומאפייני חובה. משרד
-- שראה "קונה מחפש 4 חדרים בפתח תקווה עד 2.4 מיליון" לא ידע אם
-- מדובר בדירה או בבית פרטי, אם הקונה צריך להיכנס מחר או בעוד שנה,
-- ואם יש לו אישור עקרוני. כלומר: הוא לא ידע אם שווה להשקיע נכס
-- ולחכות לתשובה, וההצעות משני הצדדים נשלחו באוויר.
--
-- הגבול לא זז: שם, טלפון, אימייל וכתובת מדויקת אינם נשמרים כאן
-- מלכתחילה, והתקציב נשאר מעוגל ל-100 אלף ₪. מה שנוסף הוא בדיוק
-- מה שכבר היה מותר לשתף ופשוט לא נשמר.
-- ============================================================

ALTER TABLE shared_demands
  ADD COLUMN IF NOT EXISTS property_types    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS area_sqm_min      INTEGER,
  ADD COLUMN IF NOT EXISTS budget_min_agorot BIGINT,
  ADD COLUMN IF NOT EXISTS entry_type        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS entry_by          DATE,
  ADD COLUMN IF NOT EXISTS financing         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS maturity          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nice_features     TEXT[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------
-- מילוי אחורה מהקונה שממנו נגזר הביקוש.
--
-- בלי זה כל ביקוש שכבר משותף היה מוצג כחסר לנצח: השדות החדשים
-- נכתבים רק בשיתוף, ומשרד לא משתף מחדש קונה שכבר שיתף. שורות
-- שמקורן חיצוני (Kanko) אינן קשורות לקונה ונשארות כפי שהן — ושם
-- זה נכון, כי המידע הזה מעולם לא הגיע.
--
-- העיגול זהה לזה שבשירות ומכוון לשני כיוונים: המקסימום כלפי מעלה
-- והמינימום כלפי מטה, כדי שהעיגול תמיד ירחיב את הטווח. עיגול
-- שמצמצם היה פוסל הצעה בגלל אנונימיזציה — עסקה שאבדה מסיבה
-- טכנית.
-- ------------------------------------------------------------
UPDATE shared_demands d
   SET property_types = COALESCE(
         (SELECT array_agg(value #>> '{}')
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(b.requirements -> 'propertyTypes') = 'array'
                   THEN b.requirements -> 'propertyTypes'
                   ELSE '[]'::jsonb END)),
         '{}'),
       area_sqm_min = CASE
         WHEN jsonb_typeof(b.requirements -> 'areaSqmMin') = 'number'
         THEN (b.requirements ->> 'areaSqmMin')::INTEGER
         ELSE NULL END,
       budget_min_agorot = CASE
         WHEN b.budget_min_agorot IS NULL THEN NULL
         ELSE FLOOR(b.budget_min_agorot::NUMERIC / 10000000) * 10000000 END,
       entry_type = CASE
         WHEN jsonb_typeof(b.requirements -> 'entryType') = 'string'
         THEN b.requirements ->> 'entryType'
         ELSE NULL END,
       entry_by = CASE
         WHEN jsonb_typeof(b.requirements -> 'entryBy') = 'string'
         THEN NULLIF(LEFT(b.requirements ->> 'entryBy', 10), '')::DATE
         ELSE NULL END,
       financing = b.financing,
       maturity = b.maturity,
       nice_features = COALESCE(
         (SELECT array_agg(key)
            FROM jsonb_each_text(
              CASE WHEN jsonb_typeof(b.requirements -> 'features') = 'object'
                   THEN b.requirements -> 'features'
                   ELSE '{}'::jsonb END)
           WHERE value = 'nice'),
         '{}')
  FROM buyers b
 WHERE b.id = d.origin_buyer_id
   AND b.deleted_at IS NULL;
