-- שוק הלידים בשת"פ: ליד למכירה בקרדיטים (docs/04 §7 — אותו דגם RLS
-- כמו shared_demands).

-- CreateTable
CREATE TABLE "shared_leads" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "origin_lead_id" CHAR(26) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "intent" VARCHAR(20) NOT NULL,
    "city" VARCHAR(120),
    "note" VARCHAR(300),
    "contact_name_encrypted" TEXT NOT NULL,
    "contact_phone_encrypted" TEXT NOT NULL,
    "contact_phone_hash" CHAR(64) NOT NULL,
    "price_credits" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "buyer_tenant_id" CHAR(26),
    "sold_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_leads_status_created_at_idx" ON "shared_leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "shared_leads_tenant_id_status_idx" ON "shared_leads"("tenant_id", "status");

-- ליד משותף פעיל אחד לכל ליד מקור — אכיפה במסד ולא רק בקוד:
-- שתי לחיצות שיתוף במקביל לא יפרסמו את אותו ליד פעמיים.
CREATE UNIQUE INDEX "shared_leads_active_origin_key"
  ON "shared_leads"("tenant_id", "origin_lead_id") WHERE status = 'active';

-- RLS: בעלות מלאה למשרד המוכר + קריאת רשת מפורשת (app.network_read)
-- ללידים פעילים. פרטי הקשר המוצפנים בשורה לעולם אינם מוחזרים בפיד —
-- השירות בוחר עמודות; ההצפנה עצמה במפתח האפליקציה, כך שגם קריאת
-- רשת גולמית אינה חושפת טלפון או שם.
ALTER TABLE shared_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_leads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared_leads
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY network_read ON shared_leads FOR SELECT
  USING (status = 'active' AND current_setting('app.network_read', true) = 'on');
