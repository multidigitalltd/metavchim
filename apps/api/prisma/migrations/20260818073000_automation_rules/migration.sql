-- אוטומציות שהמשרד בונה בעצמו.
--
-- ## היחס לאוטומציות המובנות
--
-- שמונה האוטומציות המובנות הן קוד ייעודי, וההגדרה שלהן יושבת
-- ב-`tenants.settings->'automations'` — מתג וסף לכל אחת. הטבלה הזו
-- אינה מחליפה אותן אלא עונה על השאלה השנייה: מה **המשרד הזה**
-- צריך, שאף אחד לא כתב עבורו קוד.
--
-- טבלה ולא JSON נוסף ב-settings: לכלל יש מחזור חיים משלו (נוצר,
-- כובה, נמחק), הוא נספר, ובעתיד יידרש גם „מתי רץ לאחרונה”. שדה JSON
-- שמחזיק רשימה גדלה הוא בדיוק המקום שבו שמירה מקבילה דורסת שורות.
--
-- ## התנאים והפעולה כ-JSON
--
-- דווקא כאן JSON הוא הנכון: המבנה שלהם משתנה לפי הטריגר ולפי סוג
-- הפעולה, ועמודות נפרדות היו מייצרות טבלה שרובה NULL. האימות
-- נעשה ב-Zod בשרת לפני הכתיבה (`ruleRejectionReason`), ולכן
-- הסכימה נאכפת — פשוט לא על ידי Postgres.
CREATE TABLE "automation_rules" (
  "id"          CHAR(26) PRIMARY KEY,
  "tenant_id"   CHAR(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"        VARCHAR(120) NOT NULL,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  -- שם האירוע ב-outbox. לא FK — האירועים חיים בקוד ולא בטבלה.
  "trigger"     VARCHAR(60) NOT NULL,
  "conditions"  JSONB NOT NULL DEFAULT '[]',
  "action"      JSONB NOT NULL,
  "created_by"  CHAR(26),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- השאילתה היחידה שרצה בנתיב החם: „מה מופעל למשרד הזה על האירוע
-- הזה”. היא רצה על כל אירוע שמופץ, ולכן האינדקס כולל את שלושת
-- העמודות ומסנן על enabled — כלל כבוי אינו נסרק בכלל.
CREATE INDEX "automation_rules_dispatch_idx"
  ON "automation_rules" ("tenant_id", "trigger")
  WHERE "enabled";

/*
 * RLS כמו בכל טבלת דייר. הכללים הם הגדרה של המשרד, ומשרד אחד
 * שרואה את האוטומציות של אחר רואה גם את שמות הסוכנים שבהן.
 */
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_rules"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
