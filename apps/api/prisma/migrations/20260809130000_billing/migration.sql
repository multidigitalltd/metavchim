-- מנוי בתשלום וסליקת קארדקום.
--
-- שתי הטבלאות **מחוץ ל-RLS**, כמו plans ו-platform_settings. זו לא
-- נוחות: הוובהוק של קארדקום מגיע לנתיב ציבורי בלי הקשר דייר, וטבלה
-- תחת FORCE ROW LEVEL SECURITY הייתה מחזירה לו אפס שורות **בשקט** —
-- התשלום היה מסומן כ"לא נמצא" והמנוי לא היה מופעל. אין כאן מידע על
-- לקוחות הקצה של המשרד; הבידוד נאכף בשכבת האפליקציה.

CREATE TABLE subscriptions (
  id                   CHAR(26)     PRIMARY KEY,
  -- דייר אחד, מנוי אחד
  tenant_id            CHAR(26)     NOT NULL UNIQUE,
  plan_code            VARCHAR(20)  NOT NULL,
  -- monthly | yearly
  billing_cycle        VARCHAR(10)  NOT NULL DEFAULT 'monthly',
  -- trial | active | past_due | cancelled
  status               VARCHAR(20)  NOT NULL DEFAULT 'trial',
  -- עד מתי שולם. NULL בניסיון — שם התפוגה היא tenants.trial_ends_at
  current_period_end   TIMESTAMP(3),
  -- טוקן קארדקום לחיוב חוזר, מוצפן. NULL = אין כרטיס שמור
  card_token_encrypted TEXT,
  card_last4           VARCHAR(4),
  card_expiry          VARCHAR(5),
  cancelled_at         TIMESTAMP(3),
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- הסורק שמחפש מנויים שתקופתם נגמרה עובר על כל הדיירים
CREATE INDEX subscriptions_status_period_idx ON subscriptions (status, current_period_end);

CREATE TABLE payments (
  id             CHAR(26)     PRIMARY KEY,
  tenant_id      CHAR(26)     NOT NULL,
  plan_code      VARCHAR(20)  NOT NULL,
  billing_cycle  VARCHAR(10)  NOT NULL,
  amount_agorot  INTEGER      NOT NULL,
  -- pending | paid | failed
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- מזהה דף התשלום אצל קארדקום. הייחודיות כאן היא מה שהופך את הוובהוק
  -- לאידמפוטנטי: קארדקום שולח הודעה יותר מפעם אחת, ובלי המפתח הזה
  -- אותו תשלום היה מאריך את התקופה פעמיים.
  low_profile_id VARCHAR(64)  NOT NULL UNIQUE,
  transaction_id VARCHAR(40),
  failure_reason VARCHAR(300),
  paid_at        TIMESTAMP(3),
  created_by     CHAR(26),
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX payments_tenant_created_idx ON payments (tenant_id, created_at);

-- מנוי לכל דייר קיים, במצב שהוא נמצא בו כרגע. בלי השורה הזו משרד
-- ותיק היה נראה כמי שאין לו מנוי כלל במסך החיוב.
INSERT INTO subscriptions (id, tenant_id, plan_code, status, created_at, updated_at)
SELECT
  -- מזהה יציב מתוך מזהה הדייר: המיגרציה חייבת להיות ניתנת להרצה
  -- חוזרת אחרי שחזור מגיבוי בלי לייצר כפילויות
  'S' || SUBSTRING(REPLACE(t.id, '-', '') FROM 1 FOR 25),
  t.id,
  t.plan,
  CASE WHEN t.status = 'active' THEN 'active' ELSE 'trial' END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- שער ההרשאה: עד מתי שולם, על שורת הדייר עצמה.
--
-- לא רק ב-subscriptions בכוונה. `tenantCanOperate` נבדק בכל אימות
-- Session וקורא את שורת הדייר; תפוגה שנשענת על סורק שירוץ אי-פעם
-- הייתה נותנת גישה חינם לכל מי ששילם פעם אחת — בדיוק התקלה שכבר
-- הייתה עם תקופת הניסיון. NULL = אין תפוגה (משרד שהוקם ידנית).
ALTER TABLE tenants ADD COLUMN paid_until TIMESTAMP(3);
CREATE INDEX tenants_paid_until_idx ON tenants (paid_until);

-- יום החיוב בחודש, כפי שנקבע בתשלום הראשון.
--
-- בלעדיו מנוי שנפתח ב-31 בינואר נגמר ב-28 בפברואר וממשיך ב-28
-- לתמיד: הקיצור החד-פעמי של חודש קצר הופך לקבוע, שלושה ימים בכל
-- חודש. העוגן נשמר ואינו נגזר מהתאריך המקוצר.
ALTER TABLE subscriptions ADD COLUMN billing_anchor_day SMALLINT;
