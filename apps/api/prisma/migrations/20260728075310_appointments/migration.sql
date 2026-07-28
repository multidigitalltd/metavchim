-- CreateTable
CREATE TABLE "appointments" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200),
    "lead_id" CHAR(26),
    "property_id" CHAR(26),
    "buyer_id" CHAR(26),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "outcome" VARCHAR(20),
    "notes" VARCHAR(2000),
    "google_event_id" VARCHAR(120),
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_status_starts_at_idx" ON "appointments"("tenant_id", "status", "starts_at");

-- RLS לטבלה החדשה — בתוך המיגרציה שיוצרת אותה (הכלל מ-PR #1)
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
