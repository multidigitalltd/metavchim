-- התראות פוש בדפדפן.
--
-- מנוי הוא צמד (משתמש, דפדפן): אותו סוכן במחשב במשרד ובנייד מייצר
-- שתי שורות, וזה מכוון — הוא רוצה לקבל את ההתראה בשניהם.
--
-- endpoint הוא המפתח היציב שהדפדפן מנפיק, ולכן הוא ייחודי גלובלית:
-- משתמש שמתחבר לאותו דפדפן בחשבון אחר צריך *להעביר* את המנוי אליו,
-- לא ליצור שני מנויים שיישלחו אליו פעמיים.
CREATE TABLE push_subscriptions (
  id            CHAR(26)     PRIMARY KEY,
  tenant_id     CHAR(26)     NOT NULL,
  user_id       CHAR(26)     NOT NULL,
  endpoint      TEXT         NOT NULL,
  -- מפתחות ההצפנה של הדפדפן; בלעדיהם אי אפשר לשלוח מטען
  p256dh        TEXT         NOT NULL,
  auth          TEXT         NOT NULL,
  -- לזיהוי המכשיר במסך "המכשירים שלי"
  user_agent    VARCHAR(300),
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TIMESTAMP(3),
  -- כישלונות רצופים; מתאפס בהצלחה. מנוי שחוצה את התקרה נמחק.
  failure_count INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_tenant_user_idx ON push_subscriptions (tenant_id, user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- מתי ההתראה נדחפה. NULL = טרם נשלחה.
--
-- למה עמודה ולצידה סורק, ולא קריאה לשליחה בכל מקום שיוצר התראה:
-- שורות notifications נכתבות היום מ-12 מקומות שונים (העובד, ה-API),
-- וכל מקום חדש היה צריך לזכור לדחוף. עמודה + סורק מכסים את כולם,
-- כולל את מי שייכתב בעתיד, והם אידמפוטנטיים מטבעם — סריקה שנפלה
-- באמצע פשוט תרים את מה שנשאר בפעם הבאה.
ALTER TABLE notifications ADD COLUMN pushed_at TIMESTAMP(3);

-- אינדקס חלקי: הסורק שואל רק על מה שטרם נדחף, ולכן האינדקס מכיל
-- שורות בודדות ולא את כל היסטוריית ההתראות של המשרד.
CREATE INDEX notifications_pending_push_idx
  ON notifications (tenant_id, created_at)
  WHERE pushed_at IS NULL;
