-- קודי קופון להצטרפות: הנחה על התשלום הראשון או תקופת ניסיון ארוכה יותר.
--
-- מחוץ ל-RLS, כמו plans ו-platform_settings: הקופון שייך לפלטפורמה
-- ולא למשרד, והוא נקרא בנתיב ההרשמה **הציבורי** — לפני שקיים בכלל
-- דייר שאפשר לסנן לפיו. טבלה תחת FORCE RLS הייתה מחזירה שם אפס
-- שורות בשקט, וכל קוד היה נראה כלא קיים.
CREATE TABLE coupons (
  code             VARCHAR(40) PRIMARY KEY,
  description      VARCHAR(200) NOT NULL DEFAULT '',
  -- percent | free_days
  kind             VARCHAR(20) NOT NULL,
  percent_off      INTEGER,
  free_days        INTEGER,
  -- NULL = חל על כל המסלולים
  plan_code        VARCHAR(20),
  -- NULL = בלי הגבלת כמות
  max_redemptions  INTEGER,
  redemptions      INTEGER NOT NULL DEFAULT 0,
  expires_at       TIMESTAMP(3),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       CHAR(26)
);

CREATE INDEX coupons_is_active_idx ON coupons (is_active);

-- הקופון שהמשרד מימש, והתנאים **כפי שהיו ברגע המימוש**.
--
-- ההעתקה הזו אינה כפילות מיותרת: הנחת האחוז נצרכת בתשלום הראשון,
-- שקורה ימים אחרי ההרשמה. קריאה חוזרת מהקופון בזמן התשלום הייתה
-- אומרת שקופון שנערך או כובה בינתיים משנה למפרע את מה שכבר הובטח
-- למי שנרשם.
ALTER TABLE tenants ADD COLUMN coupon_code VARCHAR(40);
ALTER TABLE tenants ADD COLUMN coupon_percent_off INTEGER;

-- המסלול שהקופון הוגבל אליו, כפי שהיה ברגע המימוש. בלעדיו מי שנרשם
-- למסלול הזול עם קופון מוגבל היה רוכש מיד את היקר באותה הנחה.
ALTER TABLE tenants ADD COLUMN coupon_plan_code VARCHAR(20);
