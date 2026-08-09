-- הגדרות המסלולים — מה כלול בכל מסלול.
--
-- עד כה "מסלול" היה מחרוזת על המשרד, ומה שהוא מזכה בו היה כתוב בקוד
-- (@RequirePlan על מסך הדוחות). כלומר פתיחת פיצ'ר למסלול נמוך יותר,
-- או הוספת מסלול, דרשה שינוי קוד ועליית גרסה.
--
-- הערת RLS: זו טבלה ברמת הפלטפורמה ולא ברמת דייר, כמו platform_settings.
-- היא נקראת גם בהקשר דייר (כדי לדעת מה מותר למשרד) ולכן אין עליה
-- פוליסת בידוד — אין בה נתוני לקוחות, והכתיבה אליה נאכפת בשכבת
-- האפליקציה (PLATFORM_ADMIN_EMAILS).
CREATE TABLE plans (
  code                 VARCHAR(20)  PRIMARY KEY,
  name                 VARCHAR(60)  NOT NULL,
  description          VARCHAR(500) NOT NULL DEFAULT '',
  monthly_price_agorot INTEGER      NOT NULL DEFAULT 0,
  -- NULL = נמכר חודשי בלבד
  yearly_price_agorot  INTEGER,
  -- NULL = ללא הגבלה. זה ערך תקין ומכוון, לא "לא הוגדר".
  max_users            INTEGER,
  max_properties       INTEGER,
  -- קודי הפיצ'רים מתוך הקטלוג שבקוד (packages/shared — plans.ts).
  -- קוד שאינו בקטלוג נזרק בשמירה: פיצ'ר קיים רק אם יש קוד שאוכף אותו.
  features             TEXT[]       NOT NULL DEFAULT '{}',
  trial_days           INTEGER      NOT NULL DEFAULT 14,
  -- האם מוצג בדף ההרשמה הציבורי. מסלול רשת נסגר בשיחה, לא בכרטיס.
  is_public            BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order           INTEGER      NOT NULL DEFAULT 0,
  updated_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by           CHAR(26)
);

CREATE INDEX plans_sort_order_idx ON plans (sort_order);
