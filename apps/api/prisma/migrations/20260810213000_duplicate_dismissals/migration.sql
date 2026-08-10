-- דחיית הצעת מיזוג כרטיסים: עד עכשיו ההצעות חושבו מחדש בכל טעינת
-- דשבורד, וקבוצה שהמתווך יודע שהיא *לא* כפילות (שני אנשים שונים עם
-- אותו שם) חזרה לנצח. הדחייה נשמרת לפי חתימת השם של הקבוצה, יחד עם
-- גודל הקבוצה בזמן הדחייה — כרטיס נוסף שנוצר אחר-כך עם אותו שם
-- מגדיל את הקבוצה ומחזיר את ההצעה, כי זו כבר שאלה חדשה.

-- CreateTable
CREATE TABLE "duplicate_dismissals" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "name_hash" CHAR(64) NOT NULL,
    "contact_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_dismissals_tenant_id_name_hash_key"
  ON "duplicate_dismissals"("tenant_id", "name_hash");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON duplicate_dismissals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
