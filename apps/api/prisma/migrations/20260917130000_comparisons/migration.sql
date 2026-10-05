-- דף השוואה לקונה (docs/03 — comparisons).
--
-- ‏שניים או שלושה נכסים זה לצד זה, כתמונת מצב (`presentation`, בלי
-- ‏PII) שנשלחת לקונה כקישור. הדף הציבורי נפתח בטוקן בלבד — אותו
-- ‏דפוס כמו `app.offer_token`: פוליסה שחושפת את השורה היחידה שהטוקן
-- ‏שלה הוצג. `responses` — הנכסים שהקונה סימן „מעוניין”.

CREATE TABLE "comparisons" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "buyer_id" CHAR(26) NOT NULL,
    "public_token" CHAR(43) NOT NULL,
    "token_expires" TIMESTAMP(3) NOT NULL,
    "presentation" JSONB NOT NULL DEFAULT '{}',
    "responses" JSONB NOT NULL DEFAULT '[]',
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "first_opened_at" TIMESTAMP(3),
    "created_by_user_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comparisons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comparisons_public_token_key" ON "comparisons"("public_token");
CREATE INDEX "comparisons_tenant_id_buyer_id_created_at_idx"
  ON "comparisons"("tenant_id", "buyer_id", "created_at");

ALTER TABLE comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE comparisons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON comparisons
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY comparison_public_read ON comparisons FOR SELECT
  USING (public_token = current_setting('app.comparison_token', true));
CREATE POLICY comparison_public_update ON comparisons FOR UPDATE
  USING (public_token = current_setting('app.comparison_token', true))
  WITH CHECK (public_token = current_setting('app.comparison_token', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "comparisons" TO metavchim_app;
