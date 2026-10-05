-- הצעות מחיר ומו״מ על נכס (docs/03 — property_bids).
--
-- ‏המו״מ חי היום בהודעות ובראש של המתווך: כמה הציע, מה המוכר ענה,
-- ‏מי עלה. שורה לכל צעד — הצעת קונה או הצעת נגד של המוכר — עם מצב
-- ‏שנגזר מהצעד הבא (נענתה / הוחלפה) או מהכרעה (התקבלה / נדחתה /
-- ‏נמשכה). „על השולחן” הוא הצעד האחרון בשרשור של כל קונה.
--
-- ‏הקונה הוא קונה רשום (`buyer_id`) — הפרטים שלו מוצפנים בכרטיס
-- ‏שלו, ואין כאן שם חופשי. טבלת דייר רגילה: RLS, אינדקסים שפותחים
-- ‏ב-`tenant_id`, בלי מפתחות זרים — כמו שאר לווייני הנכס.

CREATE TABLE "property_bids" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    "buyer_id" CHAR(26) NOT NULL,
    -- buyer | seller
    "side" VARCHAR(8) NOT NULL,
    "amount_agorot" BIGINT NOT NULL,
    -- open | countered | superseded | accepted | rejected | withdrawn
    "status" VARCHAR(12) NOT NULL DEFAULT 'open',
    "note" VARCHAR(500),
    "created_by_user_id" CHAR(26),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "property_bids_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "property_bids_tenant_id_property_id_created_at_idx"
  ON "property_bids"("tenant_id", "property_id", "created_at");
CREATE INDEX "property_bids_tenant_id_buyer_id_idx"
  ON "property_bids"("tenant_id", "buyer_id");

ALTER TABLE property_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_bids FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_bids
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "property_bids" TO metavchim_app;
