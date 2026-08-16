-- ============================================================
-- התאמה גיאוגרפית: אזורי חיפוש לקונה, ומיקום שנשמר בקליטת הנכס.
--
-- אזורי החיפוש עצמם יושבים ב-`buyers.requirements` (JSONB) יחד עם
-- שאר הדרישות — הם חלק מהן, ולא ישות נפרדת. מה שנוסף כאן הוא
-- **דגל אחד** שמאפשר לסינון הגס ב-SQL לדעת מי מהקונים סימן מפה,
-- בלי לפתוח את ה-JSON בכל שורה.
-- ============================================================

-- קונה שסימן אזורים חייב להיכנס לסינון הגס גם כשהעיר אינה תואמת:
-- הרדיוס שלו עשוי לכלול נכס בעיר שכנה, וזו כל מטרת השינוי.
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS has_search_areas BOOLEAN NOT NULL DEFAULT false;

-- backfill לשורות קיימות. `requirements->'searchAreas'` אינו קיים
-- ברובן, ולכן jsonb_array_length מוגן בבדיקת טיפוס.
UPDATE buyers
   SET has_search_areas = true
 WHERE jsonb_typeof(requirements -> 'searchAreas') = 'array'
   AND jsonb_array_length(requirements -> 'searchAreas') > 0;

-- הסינון הגס שואל "מי מהקונים של המשרד סימן מפה" — אינדקס חלקי,
-- כי המענה החיובי הוא המיעוט ואין טעם לאנדקס את השאר.
CREATE INDEX IF NOT EXISTS buyers_tenant_search_areas
  ON buyers (tenant_id)
  WHERE has_search_areas;

-- סינון גס לפי תיבה תוחמת סביב אזורי החיפוש. בלי האינדקס הזה כל
-- שאילתת התאמה של קונה ממופה הייתה סורקת את כל נכסי המשרד.
CREATE INDEX IF NOT EXISTS properties_tenant_location
  ON properties (tenant_id, latitude, longitude)
  WHERE latitude IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------
-- למה התאמה נדחתה.
--
-- עד כה הדחייה הייתה `status = 'dismissed'` וזהו: סוכן שדוחה שמונה
-- התאמות ביום אומר לנו שמונה פעמים שמשהו לא בסדר, ואנחנו לא שומעים
-- אף אחת מהן. משקלי ההתאמה ניתנים לעריכה — אבל בלי נתונים, הכיול
-- הוא ניחוש.
-- ------------------------------------------------------------
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS dismiss_reason VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dismiss_note VARCHAR(200),
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS dismissed_by CHAR(26);

-- הדוח שואל "אילו סיבות, בטווח תאריכים" — אינדקס חלקי על הדחיות
-- בלבד, שהן מיעוט מהשורות.
CREATE INDEX IF NOT EXISTS matches_tenant_dismissed
  ON matches (tenant_id, dismissed_at DESC)
  WHERE dismiss_reason IS NOT NULL;
