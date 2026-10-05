-- ‎**הסיכום החודשי של המנטור — מה עבד ומה לא (docs/14 §3).**
--
-- טבלה משלו ולא עוד שורה ב-`mentor_reviews`: השבועי הוא מבנה עם
-- בקשה, שאלה, מחויבות ותוכנית, וכל קורא שלו (הרצף, הדפוסים, הכפתורים
-- בוואטסאפ) מניח שכל שורה היא שבוע. שורה חודשית באותה טבלה הייתה
-- נכנסת לרצף כ„שבוע” ולדפוסים כ„סיכום” — בדיוק הדליפה שהפרדה
-- מבנית מונעת (כמו נכסים לגיוס מול נכסים).
--
-- של המשתמש, כמו השבועי: `tenant_id` ל-RLS, `user_id` בכל שאילתה.
-- ייחודיות על (משרד, משתמש, תחילת חודש) — הסבב אידמפוטנטי.
CREATE TABLE "mentor_monthly_reviews" (
  "id"          CHAR(26)      PRIMARY KEY,
  "tenant_id"   CHAR(26)      NOT NULL,
  "user_id"     CHAR(26)      NOT NULL,
  -- ה-1 בחודש 00:00 שעון ישראל, כ-UTC — אותו גבול של `mentorPeriodRange("month")`
  "month_start" TIMESTAMP(3)  NOT NULL,
  "headline"    VARCHAR(200)  NOT NULL,
  -- הפסקאות, המיקוד והמספרים — `MentorMonthlyBody` ב-shared
  "body"        JSONB         NOT NULL,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mentor_monthly_reviews_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mentor_monthly_reviews_tenant_id_user_id_month_start_key"
  ON "mentor_monthly_reviews"("tenant_id", "user_id", "month_start");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE mentor_monthly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_monthly_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_monthly_reviews
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_monthly_reviews TO metavchim_app;
