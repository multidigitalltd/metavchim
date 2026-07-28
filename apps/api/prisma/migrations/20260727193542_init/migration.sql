-- CreateTable
CREATE TABLE "tenants" (
    "id" CHAR(26) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'basic',
    "status" VARCHAR(20) NOT NULL DEFAULT 'trial',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255),
    "phone" VARCHAR(20),
    "role" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" VARCHAR(255),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "name_encrypted" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "email_encrypted" TEXT,
    "phone_hash" CHAR(64) NOT NULL,
    "opted_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "city" VARCHAR(80),
    "neighborhood" VARCHAR(80),
    "street" VARCHAR(120),
    "house_number" VARCHAR(10),
    "property_type" VARCHAR(30),
    "deal_type" VARCHAR(10),
    "rooms" DECIMAL(4,1),
    "area_sqm" INTEGER,
    "floor" INTEGER,
    "total_floors" INTEGER,
    "has_elevator" BOOLEAN,
    "has_parking" BOOLEAN,
    "has_balcony" BOOLEAN,
    "has_safe_room" BOOLEAN,
    "has_storage" BOOLEAN,
    "condition" VARCHAR(20),
    "price_agorot" BIGINT,
    "price_flexible" BOOLEAN,
    "entry_date" DATE,
    "exclusive" BOOLEAN,
    "exclusive_until" DATE,
    "owner_contact_id" CHAR(26),
    "marketing_title" VARCHAR(160),
    "marketing_description" TEXT,
    "internal_notes" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "readiness_score" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "s3_key" VARCHAR(512) NOT NULL,
    "alt_text" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "contact_id" CHAR(26) NOT NULL,
    "cities" TEXT[],
    "deal_type" VARCHAR(10) NOT NULL,
    "budget_min_agorot" BIGINT,
    "budget_max_agorot" BIGINT NOT NULL,
    "rooms_min" DECIMAL(4,1),
    "rooms_max" DECIMAL(4,1),
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "financing" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "maturity" VARCHAR(20) NOT NULL DEFAULT 'interested',
    "maturity_overridden" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(60) NOT NULL,
    "ai_notes" TEXT,
    "agent_notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "contact_id" CHAR(26) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "intent" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "assigned_to_user_id" CHAR(26),
    "requires_human" BOOLEAN NOT NULL DEFAULT false,
    "requires_human_reason" VARCHAR(500),
    "property_id" CHAR(26),
    "summary" TEXT,
    "first_response_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    "buyer_id" CHAR(26) NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "explanation" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'suggested',
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "match_id" CHAR(26) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "sent_text" VARCHAR(2000),
    "public_token" CHAR(43) NOT NULL,
    "token_expires" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "first_opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26),
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" CHAR(26),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_is_active_idx" ON "users"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_phone_hash_key" ON "contacts"("tenant_id", "phone_hash");

-- CreateIndex
CREATE INDEX "properties_tenant_id_status_updated_at_idx" ON "properties"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "properties_tenant_id_city_status_idx" ON "properties"("tenant_id", "city", "status");

-- CreateIndex
CREATE INDEX "property_media_tenant_id_property_id_sort_order_idx" ON "property_media"("tenant_id", "property_id", "sort_order");

-- CreateIndex
CREATE INDEX "buyers_tenant_id_maturity_updated_at_idx" ON "buyers"("tenant_id", "maturity", "updated_at");

-- CreateIndex
CREATE INDEX "buyers_tenant_id_deal_type_budget_max_agorot_idx" ON "buyers"("tenant_id", "deal_type", "budget_max_agorot");

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_to_user_id_status_created_at_idx" ON "leads"("tenant_id", "assigned_to_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_requires_human_idx" ON "leads"("tenant_id", "status", "requires_human");

-- CreateIndex
CREATE INDEX "matches_tenant_id_property_id_score_idx" ON "matches"("tenant_id", "property_id", "score" DESC);

-- CreateIndex
CREATE INDEX "matches_tenant_id_buyer_id_score_idx" ON "matches"("tenant_id", "buyer_id", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "matches_tenant_id_property_id_buyer_id_key" ON "matches"("tenant_id", "property_id", "buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_public_token_key" ON "offers"("public_token");

-- CreateIndex
CREATE INDEX "offers_tenant_id_status_created_at_idx" ON "offers"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_created_at_idx" ON "audit_log"("tenant_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_user_id_created_at_idx" ON "audit_log"("tenant_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
