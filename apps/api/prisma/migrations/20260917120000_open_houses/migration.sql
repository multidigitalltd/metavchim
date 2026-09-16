-- בית פתוח (docs/03 — open_houses).
--
-- ‏אירוע על נכס, מחולק למשבצות זמן. המבקרים אינם טבלה משלהם: כל
-- ‏מבקר הוא פגישה ביומן מסוג `viewing` שמצביעה על האירוע
-- ‏(`appointments.open_house_id`), עם ליד שנוצר בהרשמה — ולכן הוא
-- ‏מקבל תזכורת, משוב לסיור ומקום בדוח למוכר כמו כל סיור אחר, ושום
-- ‏פרט אישי אינו נכתב כאן.

CREATE TABLE "open_houses" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "slot_minutes" SMALLINT NOT NULL,
    -- מקומות למשבצת; NULL = בלי הגבלה
    "slot_capacity" SMALLINT,
    -- planned | done | cancelled
    "status" VARCHAR(12) NOT NULL DEFAULT 'planned',
    "created_by_user_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "open_houses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "open_houses_tenant_id_property_id_starts_at_idx"
  ON "open_houses"("tenant_id", "property_id", "starts_at");

ALTER TABLE open_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_houses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON open_houses
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "open_houses" TO metavchim_app;

ALTER TABLE "appointments" ADD COLUMN "open_house_id" CHAR(26);
CREATE INDEX "appointments_tenant_id_open_house_id_idx"
  ON "appointments"("tenant_id", "open_house_id");
