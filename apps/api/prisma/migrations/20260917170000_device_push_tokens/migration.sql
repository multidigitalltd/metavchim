-- התראות פוש לאפליקציה לנייד (Expo Push).
--
-- טבלה נפרדת מ-push_subscriptions ולא עמודה נוספת בה: מנוי דפדפן
-- הוא כתובת https ושני מפתחות הצפנה, וטוקן של Expo הוא מחרוזת אחת
-- שנשלחת לשירות של Expo. שני ערוצים עם שני מחזורי חיים — ושורה
-- שחצי מהעמודות שלה ריקות תמיד היא טבלה שמסתירה שתיים.
--
-- הטוקן ייחודי גלובלית מאותה סיבה כמו ה-endpoint בדפדפן: מכשיר
-- שעבר בין שני חשבונות צריך *להעביר* את הרישום, לא להישלח פעמיים.
CREATE TABLE device_push_tokens (
  id              CHAR(26)     PRIMARY KEY,
  tenant_id       CHAR(26)     NOT NULL,
  user_id         CHAR(26)     NOT NULL,
  token           VARCHAR(200) NOT NULL,
  -- ios | android — לצורך "המכשירים שלי" ולניפוי תקלות מול Expo
  platform        VARCHAR(10)  NOT NULL,
  device_name     VARCHAR(120),
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TIMESTAMP(3),
  -- כישלונות רצופים; מתאפס בהצלחה. טוקן שחוצה את התקרה נמחק.
  failure_count   INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX device_push_tokens_token_key ON device_push_tokens (token);
CREATE INDEX device_push_tokens_tenant_user_idx ON device_push_tokens (tenant_id, user_id);

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_push_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_push_tokens
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
