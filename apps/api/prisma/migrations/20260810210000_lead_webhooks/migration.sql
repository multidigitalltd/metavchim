-- ריבוי מפתחות קליטת לידים: במקום מפתח יחיד ב-settings של המשרד,
-- טבלה עם מפתח לכל ערוץ ושם מקור משלו ("אתר", "פייסבוק"...) — השם
-- נכנס כ-source של הליד, כך שרואים מאיפה כל פנייה הגיעה.
--
-- בלי RLS בכוונה: הנתיב הציבורי ‎/public/leads/:key מזהה את המשרד
-- *לפי* המפתח, לפני שקיים הקשר דייר — אותו דגם כמו subscriptions
-- מול ה-webhook של קארדקום. אין בשורות שום PII: מפתח אקראי ותווית.

-- CreateTable
CREATE TABLE "lead_webhooks" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "source_label" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_webhooks_key_key" ON "lead_webhooks"("key");

-- CreateIndex
CREATE INDEX "lead_webhooks_tenant_id_idx" ON "lead_webhooks"("tenant_id");

-- הגירת המפתח הקיים: משרד שכבר הפעיל קליטה מהאתר ממשיך לעבוד
-- באותה כתובת בדיוק, תחת המקור "אתר". המזהה נגזר דטרמיניסטית
-- מהמשרד (hex של md5, 26 תווים) — אין ULID בתוך SQL, וייחודיות
-- מובטחת כי יש לכל היותר מפתח ישן אחד לכל משרד.
INSERT INTO "lead_webhooks" ("id", "tenant_id", "key", "source_label")
SELECT
    upper(substr(md5(t."id" || ':lead-webhook'), 1, 26)),
    t."id",
    t."settings"->>'leadWebhookKey',
    'אתר'
FROM "tenants" t
WHERE t."settings"->>'leadWebhookKey' IS NOT NULL
  AND length(t."settings"->>'leadWebhookKey') BETWEEN 20 AND 64;

-- המפתח הישן יוצא מה-settings — מקור אמת אחד בלבד
UPDATE "tenants"
SET "settings" = "settings" - 'leadWebhookKey'
WHERE "settings" ? 'leadWebhookKey';
