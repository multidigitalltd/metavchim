-- סנכרון Gmail: אימיילים נכנסים הופכים ללידים או מצטרפים לכרטיס
-- קיים. שני חלקים:
--
-- 1. gmail_links — חיבור אישי (אחד למשתמש), מבנה זהה לחיבור יומן
--    Google: refresh token מוצפן, שגיאת הסבב האחרון מוצגת למשתמש,
--    וסמן התקדמות (internalDate של ההודעה האחרונה שעובדה) כדי שאותה
--    הודעה לא תיקלט פעמיים.
--
-- 2. contacts.email_hash — חתימת HMAC של האימייל (תחילית "email:",
--    כמו "name:" בשם): התאמת שולח נכנס לכרטיס בלי לפענח את כל
--    המאגר. מנוהלת בשכבת האפליקציה (ההצפנה שם), עם השלמה הדרגתית
--    לכרטיסים קיימים — כמו name_hash בשעתו.

-- CreateTable
CREATE TABLE "gmail_links" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "google_email" VARCHAR(254) NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "last_internal_ms" BIGINT NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "last_error" VARCHAR(300),
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gmail_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gmail_links_user_id_key" ON "gmail_links"("user_id");

-- CreateIndex
CREATE INDEX "gmail_links_tenant_id_idx" ON "gmail_links"("tenant_id");

-- RLS — בידוד מלא, כמו google_calendar_links
ALTER TABLE gmail_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gmail_links
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "email_hash" CHAR(64);

-- אינדקס חלקי — רוב הכרטיסים בלי אימייל, ואין טעם לאנדקס NULL-ים
CREATE INDEX "contacts_email_hash_idx" ON "contacts" ("tenant_id", "email_hash")
  WHERE "email_hash" IS NOT NULL;
