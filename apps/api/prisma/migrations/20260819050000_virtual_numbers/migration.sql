-- מספרים וירטואליים, והמספר שאליו הלקוח התקשר.
--
-- ## מה חסר היום
--
-- שיחה נכנסת אומרת מי התקשר. היא אינה אומרת מה גרם לו להתקשר —
-- ובלי זה משרד שמפרסם בארבעה ערוצים אינו יודע איזה מהם עובד,
-- ומשלם על כולם. המרכזייה שולחת לנו את שני הצדדים, ואנחנו זרקנו
-- את שלנו.

-- הצד שלנו בשיחה. **בלי הצפנה, בכוונה**: זה מספר המשרד ולא של
-- הלקוח, אין בו פרט מזהה של אדם, והוא חייב להישאר קריא כדי
-- שאפשר יהיה לקבץ לפיו. הצפנה הייתה הופכת את דוח הקמפיינים
-- לבלתי אפשרי.
ALTER TABLE "calls" ADD COLUMN "dialed_number" VARCHAR(20);

-- "כמה שיחות מכל מספר" — השאילתה של דוח הקמפיינים
CREATE INDEX "calls_dialed_number_idx" ON "calls" ("tenant_id", "dialed_number");

-- שלושה שימושים ומנגנון אחד: מדידת קמפיין, ניתוב לסוכן, וזיהוי
-- הנכס שהמספר מפרסם. שלושתם "מספר, ומה לעשות כשמתקשרים אליו",
-- ולכן טבלה אחת ולא שלוש.
CREATE TABLE "virtual_numbers" (
  "id"                  CHAR(26) PRIMARY KEY,
  "tenant_id"           CHAR(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- מנורמל בכתיבה (‎+9723…‎) כדי שההשוואה מול המרכזייה תמיד תתפוס
  "phone"               VARCHAR(20) NOT NULL,
  "label"               VARCHAR(60) NOT NULL,
  "lead_source"         VARCHAR(20) NOT NULL DEFAULT '',
  -- SET NULL ולא CASCADE: סוכן שעזב או נכס שנמחק לא מוחקים את
  -- המספר עצמו. המספר ממשיך לקלוט ולמדוד, רק בלי הניתוב.
  "assigned_to_user_id" CHAR(26) REFERENCES "users"("id") ON DELETE SET NULL,
  "property_id"         CHAR(26) REFERENCES "properties"("id") ON DELETE SET NULL,
  -- כיבוי ולא מחיקה: קמפיין שהסתיים מפסיק לנתב, וההיסטוריה
  -- שלפיה מודדים אותו בדיעבד נשארת
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "created_by"          CHAR(26),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- אותו מספר פעמיים באותו משרד הוא ניתוב דו-משמעי: שתי הגדרות
-- סותרות על אותה שיחה, והבחירה ביניהן שרירותית
CREATE UNIQUE INDEX "virtual_numbers_tenant_phone_key"
  ON "virtual_numbers" ("tenant_id", "phone");

/*
 * RLS כמו בכל טבלת דייר. ההגדרות כאן חושפות שמות קמפיינים,
 * שיוך סוכנים וקישור לנכסים — כל אחד מהם מידע עסקי של המשרד.
 */
ALTER TABLE "virtual_numbers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "virtual_numbers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "virtual_numbers"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
