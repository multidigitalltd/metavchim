-- רכש מדיה — ארכיון מדיות, המוצרים שבהן, וההזמנות של המשרדים.
--
-- שלוש טבלאות ושני עולמות:
--
-- ‎`media_outlets` ו-`media_products` הם **קטלוג של הפלטפורמה** —
-- בלי tenant_id ובלי RLS, כמו plans ו-platform_settings. כל המשרדים
-- קוראים אותו, ורק בעל הפלטפורמה כותב (PlatformAdminGuard). פרטי
-- הקשר על המדיה הם של נציג המדיה, מי שמקבל את ההזמנות.
--
-- ‎`media_orders` היא של המשרד, אבל **מחוץ ל-RLS, כמו payments
-- ומאותה סיבה**: הזמנה בתשלום מופעלת מהוובהוק של קארדקום — נתיב
-- ציבורי בלי הקשר דייר — ובעל הפלטפורמה רואה את כל ההזמנות במסך
-- אחד. אין כאן לקוח קצה: פרטי הקשר הם של מי שהזמין במשרד. הסינון
-- לפי דייר נאכף בשכבת האפליקציה, בכל שאילתה.
--
-- המחיר, הכמות והעמלה מצולמים על ההזמנה ברגע היצירה: שינוי מחיר
-- במסך הפלטפורמה חל על הזמנות חדשות בלבד.

CREATE TABLE media_outlets (
  id                 CHAR(26)     PRIMARY KEY,
  slug               VARCHAR(60)  NOT NULL,
  name               VARCHAR(120) NOT NULL,
  -- magazine | newspaper | digital | billboard | radio | other
  kind               VARCHAR(20)  NOT NULL DEFAULT 'magazine',
  tagline            VARCHAR(200) NOT NULL DEFAULT '',
  description        TEXT         NOT NULL DEFAULT '',
  audience           TEXT         NOT NULL DEFAULT '',
  reach_text         VARCHAR(200) NOT NULL DEFAULT '',
  frequency          VARCHAR(120) NOT NULL DEFAULT '',
  highlights         TEXT[]       NOT NULL DEFAULT '{}',
  contact_name       VARCHAR(120) NOT NULL DEFAULT '',
  contact_email      VARCHAR(254) NOT NULL DEFAULT '',
  contact_phone      VARCHAR(20)  NOT NULL DEFAULT '',
  -- עמלת התיווך של הפלטפורמה על הזמנה בתשלום, באחוזים
  commission_percent INTEGER      NOT NULL DEFAULT 10,
  active             BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order         INTEGER      NOT NULL DEFAULT 0,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by         CHAR(26)
);

CREATE UNIQUE INDEX media_outlets_slug_key ON media_outlets (slug);
CREATE INDEX media_outlets_active_sort_order_idx ON media_outlets (active, sort_order);

CREATE TABLE media_products (
  id              CHAR(26)      PRIMARY KEY,
  outlet_id       CHAR(26)      NOT NULL REFERENCES media_outlets (id) ON DELETE CASCADE,
  name            VARCHAR(120)  NOT NULL,
  description     VARCHAR(1000) NOT NULL DEFAULT '',
  specs           VARCHAR(200)  NOT NULL DEFAULT '',
  -- paid | lead
  kind            VARCHAR(10)   NOT NULL DEFAULT 'paid',
  -- מחיר ליחידה נטו באגורות; ריק במוצר הפניה
  price_agorot    INTEGER,
  -- מה הנציג משלם לפלטפורמה על הפניה — לרישום, לא לחיוב אוטומטי
  lead_fee_agorot INTEGER,
  active          BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order      INTEGER       NOT NULL DEFAULT 0,
  created_at      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX media_products_outlet_id_active_sort_order_idx
  ON media_products (outlet_id, active, sort_order);

CREATE TABLE media_orders (
  id                 CHAR(26)      PRIMARY KEY,
  tenant_id          CHAR(26)      NOT NULL,
  outlet_id          CHAR(26)      NOT NULL,
  product_id         CHAR(26)      NOT NULL,
  -- paid | lead — צילום מהמוצר
  kind               VARCHAR(10)   NOT NULL,
  -- pending_payment | paid | referred | failed | cancelled
  status             VARCHAR(20)   NOT NULL DEFAULT 'pending_payment',
  outlet_name        VARCHAR(120)  NOT NULL,
  product_name       VARCHAR(120)  NOT NULL,
  quantity           INTEGER       NOT NULL DEFAULT 1,
  unit_price_agorot  INTEGER       NOT NULL DEFAULT 0,
  amount_agorot      INTEGER       NOT NULL DEFAULT 0,
  commission_percent INTEGER       NOT NULL DEFAULT 0,
  commission_agorot  INTEGER       NOT NULL DEFAULT 0,
  -- בהפניה: התמורה שהנציג חייב על ההפניה, מצולמת מהמוצר; ריק בתשלום
  lead_fee_agorot    INTEGER,
  brief              VARCHAR(2000) NOT NULL DEFAULT '',
  contact_name       VARCHAR(120)  NOT NULL,
  contact_phone      VARCHAR(20)   NOT NULL,
  contact_email      VARCHAR(254)  NOT NULL,
  office_name        VARCHAR(120)  NOT NULL,
  customer_no        INTEGER,
  -- מתי נשלחה בפועל לאיש הקשר של המדיה
  notified_at        TIMESTAMP(3),
  paid_at            TIMESTAMP(3),
  created_by         CHAR(26),
  created_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX media_orders_tenant_id_created_at_idx ON media_orders (tenant_id, created_at);
CREATE INDEX media_orders_status_created_at_idx ON media_orders (status, created_at);
CREATE INDEX media_orders_outlet_id_created_at_idx ON media_orders (outlet_id, created_at);

-- ההזמנה שהתשלום משלם. ריק בכל תשלום אחר; מלא, הוא מה שמפעיל
-- בהצלחה את שליחת ההזמנה לנציג המדיה.
ALTER TABLE payments ADD COLUMN media_order_id CHAR(26);

-- המדיה הראשונה בארכיון: מגזין טאבו. המחירים והמוצרים הם נקודת
-- פתיחה שבעל הפלטפורמה עורך במסך — לא מחירון מחייב.
INSERT INTO media_outlets
  (id, slug, name, kind, tagline, description, audience, reach_text, frequency, highlights, commission_percent, sort_order)
VALUES (
  '01K5R4MED1A0TAB000000000A0',
  'tabu-magazine',
  'מגזין טאבו',
  'magazine',
  'המגזין הנפוץ ביותר בתחום הנדל"ן בציבור החרדי',
  'מגזין נדל"ן מודפס שמופץ בריכוזים החרדיים ברחבי הארץ. מודעות נכסים, פרויקטים חדשים, וכתבות על שוק הנדל"ן. פרסום במגזין מגיע לקהל שקורא עיתונות מודפסת ומחפש דירה — קונים, שוכרים ומשפחות בתחילת הדרך.',
  'משפחות בציבור החרדי בירושלים, בני ברק, בית שמש, מודיעין עילית, ביתר עילית, אלעד, אשדוד ועוד. קוראים שמחפשים דירה לקנייה או לשכירות, ומשקיעים שעוקבים אחרי פרויקטים חדשים.',
  'הפצה שבועית ארצית בריכוזים החרדיים',
  'שבועי',
  ARRAY[
    'עיצוב המודעה כלול במחיר — שולחים טקסט ותמונות, המגזין מעצב',
    'הפצה בכל הריכוזים החרדיים ברחבי הארץ',
    'הזמנה שנקלטת עד יום שני נכנסת לגיליון של אותו שבוע'
  ],
  10,
  0
);

INSERT INTO media_products (id, outlet_id, name, description, specs, kind, price_agorot, sort_order) VALUES
  ('01K5R4MED1A0TAB0PR0D0CT001', '01K5R4MED1A0TAB000000000A0', 'מודעה רבע עמוד',
   'מודעת נכס אחד או שניים, עם תמונה, מחיר ופרטי קשר.', 'רבע עמוד, צבע מלא', 'paid', 90000, 0),
  ('01K5R4MED1A0TAB0PR0D0CT002', '01K5R4MED1A0TAB000000000A0', 'מודעה חצי עמוד',
   'עד ארבעה נכסים, או נכס אחד בהבלטה עם מספר תמונות.', 'חצי עמוד, צבע מלא', 'paid', 160000, 1),
  ('01K5R4MED1A0TAB0PR0D0CT003', '01K5R4MED1A0TAB000000000A0', 'עמוד שלם',
   'עמוד מלא למשרד: נכסים נבחרים, לוגו ופרטי המשרד.', 'עמוד שלם, צבע מלא', 'paid', 290000, 2);

INSERT INTO media_products (id, outlet_id, name, description, specs, kind, price_agorot, lead_fee_agorot, sort_order) VALUES
  ('01K5R4MED1A0TAB0PR0D0CT004', '01K5R4MED1A0TAB000000000A0', 'עמוד שער / פרויקט',
   'שער, כריכה אחורית או כתבת פרויקט — מחיר לפי תיאום עם המגזין. הפנייה נשלחת לנציג והוא חוזר אליכם.',
   'לפי תיאום', 'lead', NULL, 5000, 3);

-- תפקיד האפליקציה קורא את הקטלוג וכותב הזמנות; הקטלוג עצמו נכתב
-- ממסך הפלטפורמה, שרץ באותו תפקיד
GRANT SELECT, INSERT, UPDATE, DELETE ON media_outlets TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_products TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_orders TO metavchim_app;
