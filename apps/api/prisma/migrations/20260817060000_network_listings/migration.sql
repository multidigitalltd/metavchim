-- ============================================================
-- הכיוון השני של הרשת: נכס שמתפרסם, וקונה שמביע בו עניין.
--
-- עד כה הרשת הייתה חד-כיוונית. משרד יכול היה לומר "יש לי קונה, למי
-- יש נכס", ולא "יש לי נכס, למי יש קונה" — ולכן משרד עם נכס תקוע
-- ומשרד עם קונה מתאים לא ידעו זה על זה אלא אם הראשון במקרה גלל את
-- הפיד.
--
-- מדיניות ה-RLS זהה לזו של הצד הקיים, ובכוונה: `shared_listings`
-- מתנהג כמו `shared_demands` (בעלות מלאה למשרד + קריאת רשת לפעילים
-- בלבד), ו-`coop_interests` כמו `coop_offers` (דו-צדדי, יצירה רק
-- בידי הצד היוזם). שני דגמים שונים לאותה בעיה היו הפרש שמישהו
-- ישכח לתחזק.
-- ============================================================

CREATE TABLE shared_listings (
  id                 CHAR(26) PRIMARY KEY,
  tenant_id          CHAR(26) NOT NULL,
  origin_property_id CHAR(26) NOT NULL,
  city               VARCHAR(80),
  neighborhood       VARCHAR(80),
  property_type      VARCHAR(30),
  deal_type          VARCHAR(10),
  rooms              NUMERIC(4, 1),
  area_sqm           INTEGER,
  floor              INTEGER,
  total_floors       INTEGER,
  condition          VARCHAR(20),
  price_agorot       BIGINT,
  entry_type         VARCHAR(20),
  entry_date         DATE,
  features           TEXT[] NOT NULL DEFAULT '{}',
  title              VARCHAR(160),
  notes              VARCHAR(300),
  latitude           DOUBLE PRECISION,
  longitude          DOUBLE PRECISION,
  status             VARCHAR(20) NOT NULL DEFAULT 'active',
  commission_split   SMALLINT NOT NULL DEFAULT 50,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP(3) NOT NULL
);

-- אותו טווח כמו בביקוש: לפחות שליש לכל צד. חלוקה שאינה סבירה אינה
-- שיתוף פעולה אלא לכידה, והיא נחסמת במסד ולא רק במסך.
ALTER TABLE shared_listings
  ADD CONSTRAINT shared_listings_commission_split_range
  CHECK (commission_split BETWEEN 33 AND 67);

CREATE INDEX shared_listings_feed ON shared_listings (status, deal_type, price_agorot);
CREATE INDEX shared_listings_tenant ON shared_listings (tenant_id, status);

-- נכס מתפרסם פעם אחת. בלי זה לחיצה כפולה הייתה מייצרת שתי שורות
-- לאותו נכס, והפיד היה מציג אותו פעמיים.
CREATE UNIQUE INDEX shared_listings_one_active
  ON shared_listings (origin_property_id)
  WHERE status = 'active';

ALTER TABLE shared_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_listings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_listings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY network_read ON shared_listings FOR SELECT
  USING (status = 'active' AND current_setting('app.network_read', true) = 'on');

-- ------------------------------------------------------------

CREATE TABLE coop_interests (
  id               CHAR(26) PRIMARY KEY,
  listing_id       CHAR(26) NOT NULL,
  from_tenant_id   CHAR(26) NOT NULL,
  to_tenant_id     CHAR(26) NOT NULL,
  buyer_id         CHAR(26) NOT NULL,
  presentation     JSONB NOT NULL DEFAULT '{}',
  status           VARCHAR(20) NOT NULL DEFAULT 'sent',
  credits_cost     INTEGER NOT NULL DEFAULT 0,
  commission_split SMALLINT NOT NULL DEFAULT 50,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- אותו קונה על אותו נכס פעם אחת: בלי זה לחיצה חוזרת הייתה מציפה את
-- הצד השני באותה הצעה שוב ושוב.
CREATE UNIQUE INDEX coop_interests_unique ON coop_interests (listing_id, buyer_id);
CREATE INDEX coop_interests_inbox ON coop_interests (to_tenant_id, status, created_at);
CREATE INDEX coop_interests_outbox ON coop_interests (from_tenant_id, created_at);

ALTER TABLE coop_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE coop_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY coop_two_sided ON coop_interests
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (from_tenant_id = current_setting('app.tenant_id', true));
