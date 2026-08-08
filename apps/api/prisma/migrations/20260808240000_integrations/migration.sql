-- אינטגרציות של המשרד עם שירותים חיצוניים.
--
-- טבלה אחת ולא טבלה לכל סוג: מרכזייה היום, ובעתיד גם מערכות אחרות.
-- מה שמשתנה בין סוגים הוא רק תוכן ה-config וה-secrets, לא המבנה —
-- ולכן חיבור סוג חדש לא דורש מיגרציה.
CREATE TABLE integrations (
  id           CHAR(26)     PRIMARY KEY,
  tenant_id    CHAR(26)     NOT NULL,
  -- מה השירות עושה (telephony וכו')
  kind         VARCHAR(30)  NOT NULL,
  -- מי הספק בתוך אותו סוג
  provider     VARCHAR(30)  NOT NULL,
  -- active | disabled. חיבור מושבת שומר את ההגדרות ולא מקבל אירועים.
  status       VARCHAR(20)  NOT NULL DEFAULT 'active',
  -- הגדרות שאינן סוד (שלוחה, מזהה חשבון) — מוצגות במסך
  config       JSONB        NOT NULL DEFAULT '{}',
  -- אישורי הספק, מוצפנים באותו מנגנון של שאר ה-PII (AES-GCM).
  -- לעולם לא מוחזרים ללקוח, גם לא למנהל המשרד.
  secrets_encrypted TEXT,
  -- המפתח שמזהה את המשרד בכתובת ה-Webhook הציבורית.
  -- אותה תבנית של lead_webhook_key שכבר עובדת לקליטת לידים מהאתר:
  -- המשרד נגזר מהמפתח, לעולם לא מגוף הבקשה.
  webhook_key  VARCHAR(64)  NOT NULL,
  last_event_at TIMESTAMP(3),
  created_by   CHAR(26),
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- חיבור אחד לכל סוג בכל משרד. שני חיבורי מרכזייה במקביל היו מייצרים
-- שתי שורות שיחה לכל שיחה.
CREATE UNIQUE INDEX integrations_tenant_kind_key ON integrations (tenant_id, kind);
CREATE UNIQUE INDEX integrations_webhook_key ON integrations (webhook_key);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integrations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- מזהה השיחה אצל הספק — מפתח האידמפוטנטיות.
--
-- ספקי מרכזייה שולחים את אותו אירוע שוב כשהם לא מקבלים 200, ולפעמים
-- גם בלי סיבה. בלי המפתח הזה כל ניסיון חוזר היה יוצר שורת שיחה
-- נוספת על כרטיס הלקוח.
ALTER TABLE calls ADD COLUMN provider_call_id VARCHAR(80);
CREATE UNIQUE INDEX calls_provider_call_id_key
  ON calls (tenant_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;
