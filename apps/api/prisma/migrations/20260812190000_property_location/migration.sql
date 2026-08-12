-- מיקום גיאוגרפי לנכס.
--
-- WGS84 תמיד, גם כשהמקור (מפ"י) עובד ברשת ישראל — ההמרה נעשית
-- בקליטה. פורמט אחד פירושו שהחלפת ספק פענוח אינה גוררת המרת מסד.
--
-- DOUBLE PRECISION ולא NUMERIC: זה חישוב גיאומטרי ולא כסף, והדיוק
-- של float כפול הוא סנטימטרים — הרבה מעבר לנדרש.
ALTER TABLE "properties" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "properties" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "properties" ADD COLUMN "location_source" VARCHAR(10);

-- הסינון הגס של ההתאמות יסרוק לפי תיבה תוחמת לפני בדיקת המצולע
CREATE INDEX "properties_tenant_location_idx"
  ON "properties" ("tenant_id", "latitude", "longitude")
  WHERE "latitude" IS NOT NULL;
