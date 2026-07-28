-- CreateTable
CREATE TABLE "shared_demands" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "origin_buyer_id" CHAR(26),
    "source" VARCHAR(20) NOT NULL DEFAULT 'network',
    "external_id" VARCHAR(120),
    "cities" TEXT[],
    "deal_type" VARCHAR(10) NOT NULL,
    "budget_max_agorot" BIGINT NOT NULL,
    "rooms_min" DECIMAL(4,1),
    "rooms_max" DECIMAL(4,1),
    "must_features" TEXT[],
    "notes" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_offers" (
    "id" CHAR(26) NOT NULL,
    "demand_id" CHAR(26) NOT NULL,
    "from_tenant_id" CHAR(26) NOT NULL,
    "to_tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    "presentation" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
    "credits_cost" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coop_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "amount" INTEGER NOT NULL,
    "ref_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_demands_external_id_key" ON "shared_demands"("external_id");

-- CreateIndex
CREATE INDEX "shared_demands_status_deal_type_budget_max_agorot_idx" ON "shared_demands"("status", "deal_type", "budget_max_agorot");

-- CreateIndex
CREATE INDEX "shared_demands_tenant_id_status_idx" ON "shared_demands"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "coop_offers_to_tenant_id_status_created_at_idx" ON "coop_offers"("to_tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "coop_offers_from_tenant_id_created_at_idx" ON "coop_offers"("from_tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "coop_offers_demand_id_property_id_key" ON "coop_offers"("demand_id", "property_id");

-- CreateIndex
CREATE INDEX "credit_ledger_tenant_id_created_at_idx" ON "credit_ledger"("tenant_id", "created_at");

-- ============================================================
-- RLS לטבלאות שיתוף הפעולה (docs/04 §7)
-- ============================================================

-- shared_demands: בעלות מלאה לסוכנות המקור + קריאת רשת מפורשת
-- (app.network_read) לביקושים פעילים. אין PII בטבלה בתכנון.
ALTER TABLE shared_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_demands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_demands
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY network_read ON shared_demands FOR SELECT
  USING (status = 'active' AND current_setting('app.network_read', true) = 'on');

-- coop_offers: גלוי לשתי הסוכנויות בלבד; יצירה רק ע"י הסוכנות המציעה.
ALTER TABLE coop_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE coop_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY coop_two_sided ON coop_offers
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (from_tenant_id = current_setting('app.tenant_id', true));

-- credit_ledger: בידוד דייר רגיל + Append-Only (אין UPDATE/DELETE לאפליקציה).
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_ledger
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON credit_ledger FROM metavchim_app';
  END IF;
END $$;

-- דייר מערכתי לביקושי Kanko — ללא משתמשים; קיים רק כעוגן לשורות demand.
INSERT INTO tenants (id, name, plan, status, settings, created_at, updated_at)
VALUES ('0000000000000000000000KNK0', 'Kanko Network', 'enterprise', 'active', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;
