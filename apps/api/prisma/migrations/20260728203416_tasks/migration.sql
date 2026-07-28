-- CreateTable
CREATE TABLE "tasks" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "assigned_to_user_id" CHAR(26) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(2000),
    "due_at" TIMESTAMP(3),
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "entity_type" VARCHAR(20),
    "entity_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assigned_to_user_id_status_due_at_idx" ON "tasks"("tenant_id", "assigned_to_user_id", "status", "due_at");

-- RLS — כל טבלה עסקית חדשה מקבלת בידוד דייר בתוך המיגרציה שיוצרת אותה
-- (docs/04 §2; הכלל שנקבע בביקורת PR #1).
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tasks;
CREATE POLICY tenant_isolation ON tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- תפקיד האפליקציה מקבל גישה (המיגרציות רצות כבעלים)
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO metavchim_app;
