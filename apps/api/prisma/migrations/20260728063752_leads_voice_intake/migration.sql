-- CreateTable
CREATE TABLE "interactions" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "lead_id" CHAR(26) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "direction" VARCHAR(10),
    "content" TEXT NOT NULL,
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_intakes" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "transcript" TEXT NOT NULL,
    "extracted_fields" JSONB NOT NULL DEFAULT '{}',
    "missing_fields" TEXT[],
    "property_id" CHAR(26),
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interactions_tenant_id_lead_id_created_at_idx" ON "interactions"("tenant_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_intakes_tenant_id_created_at_idx" ON "voice_intakes"("tenant_id", "created_at");
