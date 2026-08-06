-- יומן שיחות ידני: המתווך מתעד שיחה שקיים — עם מי, מתי, מה סוכם.
--
-- למה ידני ולא אוטומטי: הקלטת שיחות ותמלולן דורשות חיבור לספק
-- טלפוניה שאינו קיים. הטבלה בנויה כך שכשייכנס ספק, שיחות אוטומטיות
-- יישמרו באותה טבלה עם source='provider' — בלי מיגרציה נוספת.
CREATE TABLE calls (
  id           CHAR(26)     PRIMARY KEY,
  tenant_id    CHAR(26)     NOT NULL,
  -- inbound | outbound
  direction    VARCHAR(10)  NOT NULL,
  -- manual | provider (עתידי)
  source       VARCHAR(20)  NOT NULL DEFAULT 'manual',
  contact_id   CHAR(26),
  lead_id      CHAR(26),
  -- הטלפון מוצפן כמו כל PII אחר (docs/04 §4); phone_hash לחיפוש
  phone_encrypted TEXT,
  phone_hash   CHAR(64),
  occurred_at  TIMESTAMP(3) NOT NULL,
  duration_minutes INTEGER,
  -- answered | missed | no_answer | voicemail
  outcome      VARCHAR(20)  NOT NULL DEFAULT 'answered',
  summary      VARCHAR(4000),
  created_by   CHAR(26),
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX calls_tenant_time_idx ON calls (tenant_id, occurred_at DESC);
CREATE INDEX calls_tenant_contact_idx ON calls (tenant_id, contact_id);
CREATE INDEX calls_tenant_lead_idx ON calls (tenant_id, lead_id);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calls
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
