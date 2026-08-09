-- הסכמים שנשלחו ללקוח לחתימה דיגיטלית.
--
-- rendered_body הוא צילום של הנוסח *כפי שהלקוח ראה אותו* ברגע
-- השליחה — לא הפניה לתבנית. שינוי מאוחר בנוסח המשרד אינו משנה
-- הסכם שכבר נחתם, וזה תנאי לכך שלמסמך תהיה משמעות ראייתית.
--
-- body_hash הוא SHA-256 של אותו נוסח: הוא מודפס באישור החתימה
-- ומאפשר להוכיח מאוחר יותר שהטקסט לא שונה.
CREATE TABLE agreements (
  id                CHAR(26)     PRIMARY KEY,
  tenant_id         CHAR(26)     NOT NULL,
  -- brokerage | exclusivity
  kind              VARCHAR(20)  NOT NULL,
  contact_id        CHAR(26)     NOT NULL,
  property_id       CHAR(26),
  -- pending | viewed | signed | declined
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  rendered_body     TEXT         NOT NULL,
  body_hash         CHAR(64)     NOT NULL,
  public_token      VARCHAR(64)  NOT NULL,
  token_expires     TIMESTAMP(3) NOT NULL,
  -- ראיות החתימה (מודל comsign): מי, מתי, מהיכן
  signer_name       VARCHAR(120),
  signer_id_number  VARCHAR(20),
  signed_at         TIMESTAMP(3),
  signed_ip         VARCHAR(45),
  signed_user_agent VARCHAR(300),
  viewed_at         TIMESTAMP(3),
  declined_at       TIMESTAMP(3),
  created_by        CHAR(26),
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT agreements_public_token_key UNIQUE (public_token)
);

CREATE INDEX agreements_tenant_contact_idx ON agreements (tenant_id, contact_id, kind);

ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON agreements
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- הלקוח החותם אינו משתמש במערכת ואין לו הקשר דייר. אותה תבנית
-- שמשמשת את דף ההצעה הציבורי: הטוקן שבקישור הוא המפתח, והפוליסה
-- חושפת אך ורק את השורה שלו.
CREATE POLICY public_token_access ON agreements
  USING (public_token = current_setting('app.agreement_token', true))
  WITH CHECK (public_token = current_setting('app.agreement_token', true));
