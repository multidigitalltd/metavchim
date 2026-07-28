-- CreateTable
CREATE TABLE "messages" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "contact_id" CHAR(26),
    "offer_id" CHAR(26),
    "direction" VARCHAR(5) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "provider_message_id" VARCHAR(120),
    "status" VARCHAR(20) NOT NULL DEFAULT 'sent',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_tenant_id_contact_id_created_at_idx" ON "messages"("tenant_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_offer_id_idx" ON "messages"("tenant_id", "offer_id");

-- RLS לטבלה החדשה — בתוך המיגרציה שיוצרת אותה
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
