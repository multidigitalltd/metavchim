-- רכש מדיה — שלוש תוספות: מועד סגירת הגיליון ותזכורת, תמונות ודוגמאות
-- מודעה, ורישום ההתחשבנות מול המדיה.
--
-- ‎**סגירת גיליון.** מועד אחד על המדיה (הגיליון נסגר לכל המוצרים יחד),
-- כלל במילים לצדו, ותזכורת למשרד שיש לו הזמנה שממתינה לתשלום כשהמועד
-- בעוד פחות מיממה. `reminded_for_closing_at` על המדיה ו-
-- `closing_reminder_at` על ההזמנה — שניהם, כדי שהתזכורת תישלח פעם אחת
-- לגיליון, ותישלח שוב כשהמועד מתעדכן לגיליון הבא.
--
-- ‎**תמונות.** הקובץ ב-S3 כמו תמונות הנכסים; השורה היא הסדר והכיתוב.
--
-- ‎**התחשבנות.** רישום של העברה ששולמה למדיה, לא העברה בנקאית: אין
-- כאן אינטגרציה לבנק, ויש אסמכתה ורשימת הזמנות שנכללו. היתרה לתשלום
-- למדיה היא סך חלקה בהזמנות ששולמו ועדיין בלי `settlement_id`.
--
-- כולן קטלוג של הפלטפורמה — בלי דייר ובלי RLS, מאותה סיבה כמו
-- media_outlets. `media_orders` נשארת כפי שהייתה: מחוץ ל-RLS, מסוננת
-- לפי דייר בשכבת האפליקציה.

ALTER TABLE media_outlets
  ADD COLUMN closing_text            VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN next_closing_at         TIMESTAMP(3),
  ADD COLUMN reminded_for_closing_at TIMESTAMP(3);

CREATE TABLE media_outlet_images (
  id           CHAR(26)     PRIMARY KEY,
  outlet_id    CHAR(26)     NOT NULL REFERENCES media_outlets (id) ON DELETE CASCADE,
  -- cover | sample
  kind         VARCHAR(10)  NOT NULL DEFAULT 'sample',
  s3_key       VARCHAR(512) NOT NULL,
  content_type VARCHAR(80)  NOT NULL DEFAULT 'image/jpeg',
  caption      VARCHAR(200) NOT NULL DEFAULT '',
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX media_outlet_images_outlet_id_kind_sort_order_idx
  ON media_outlet_images (outlet_id, kind, sort_order);

CREATE TABLE media_settlements (
  id            CHAR(26)     PRIMARY KEY,
  outlet_id     CHAR(26)     NOT NULL REFERENCES media_outlets (id),
  -- סך חלקה של המדיה בהזמנות שנכללו — הסכום פחות העמלה, נטו באגורות
  amount_agorot INTEGER      NOT NULL,
  order_count   INTEGER      NOT NULL,
  reference     VARCHAR(120) NOT NULL DEFAULT '',
  note          VARCHAR(500) NOT NULL DEFAULT '',
  created_by    CHAR(26),
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX media_settlements_outlet_id_created_at_idx
  ON media_settlements (outlet_id, created_at);

ALTER TABLE media_orders
  ADD COLUMN settlement_id       CHAR(26),
  ADD COLUMN closing_reminder_at TIMESTAMP(3);

CREATE INDEX media_orders_outlet_id_status_settlement_id_idx
  ON media_orders (outlet_id, status, settlement_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON media_outlet_images TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_settlements TO metavchim_app;
