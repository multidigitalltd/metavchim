-- DropIndex
DROP INDEX "notifications_tenant_id_read_at_created_at_idx";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "user_id" CHAR(26);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_created_at_idx" ON "notifications"("tenant_id", "user_id", "read_at", "created_at");
