-- AlterTable
ALTER TABLE "buyers" ADD COLUMN     "owner_user_id" CHAR(26);

-- CreateIndex
CREATE INDEX "buyers_tenant_id_owner_user_id_idx" ON "buyers"("tenant_id", "owner_user_id");
