-- AlterTable
ALTER TABLE "interactions" ADD COLUMN     "buyer_id" CHAR(26),
ALTER COLUMN "lead_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "interactions_tenant_id_buyer_id_created_at_idx" ON "interactions"("tenant_id", "buyer_id", "created_at");

-- בדיוק ישות-אם אחת לכל אינטראקציה — ליד או קונה, לא שניהם ולא אף אחד.
ALTER TABLE interactions ADD CONSTRAINT interaction_exactly_one_parent
  CHECK ((lead_id IS NULL) <> (buyer_id IS NULL));
