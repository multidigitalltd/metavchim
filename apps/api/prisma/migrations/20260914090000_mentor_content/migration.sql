-- ‏איזור התוכן במנטור — סרטונים ופודקאסטים למתווכים.
--
-- ‏המנטור נותן מדידה, משוב ותרגול. מה שחסר לו הוא **חומר**: סרטון
-- ‏הדרכה, פרק פודקאסט, שיחה עם מתווך ותיק. עד כה זה נשלח בוואטסאפ
-- ‏ונעלם בגלילה; כאן הוא יושב במקום שהמתווך חוזר אליו ממילא.
--
-- ‎`tenant_id IS NULL` = תוכן של הפלטפורמה, מוצג בכל המשרדים.
-- ‎`tenant_id = X`      = תוכן של המשרד X, מוצג רק בו.
--
-- ‏אותה עמודה נילית כמו `mentor_quotes`, ומאותו נימוק: המסך מציג
-- ‏את שתי הקבוצות באותה רשימה, ופיצול לשתי טבלאות היה מכריח כל
-- ‏קורא לאחד אותן מחדש.

CREATE TABLE "mentor_content" (
    "id" CHAR(26) NOT NULL,
    -- NULL = תוכן של הפלטפורמה, גלוי לכל המשרדים
    "tenant_id" CHAR(26),
    -- 120 תווים: אותו גבול כמו CONTENT_TITLE_MAX בחבילה המשותפת
    "title" VARCHAR(120) NOT NULL,
    -- „על מה זה”. ריק הוא תשובה לגיטימית לסרטון ששמו מספר הכול
    "notes" VARCHAR(400) NOT NULL DEFAULT '',
    -- youtube | spotify | apple | link — MENTOR_CONTENT_KINDS
    "kind" VARCHAR(20) NOT NULL,
    --
    -- ‎**מה שנשמר הוא מזהה, לא קוד הטמעה.**
    --
    -- ‏„הטמעת סרטון” בניסוח הנאיבי שלה פירושה שמנהל מדביק תגית
    -- ‏`<iframe>` שהאתר מרנדר — כלומר הזרקת HTML למסך של כל מתווך
    -- ‏במערכת. כאן נשמר מה ש-`parseContentUrl` קרא: מזהה סרטון,
    -- ‏או נתיב פרק. הנגן נבנה ממנו ומהמקור הקבוע.
    "ref" VARCHAR(300) NOT NULL,
    -- ‏הכתובת המקורית — לתצוגה בעריכה, ולא למשהו שנטען
    "source_url" VARCHAR(2000) NOT NULL,
    -- ‏סדר התצוגה. מנהל שמוסיף פרק שני רוצה שהוא יבוא אחרי הראשון
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mentor_content_pkey" PRIMARY KEY ("id")
);

-- „התוכן של המשרד הזה, בסדר שנקבע” — בדיוק מה שהמסך שואל.
-- שורות הפלטפורמה (tenant_id IS NULL) יושבות בקצה אחד של האינדקס
-- ונקראות באותה שאילתה.
CREATE INDEX "mentor_content_tenant_id_sort_order_idx"
  ON "mentor_content"("tenant_id", "sort_order", "created_at");

ALTER TABLE mentor_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_content FORCE ROW LEVEL SECURITY;

-- 1. התוכן של המשרד — קריאה וכתיבה, כמו כל טבלת דייר אחרת.
CREATE POLICY tenant_isolation ON mentor_content
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- 2. התוכן של הפלטפורמה — **קריאה בלבד**, לכל מי שמחובר.
--
-- ‎`FOR SELECT` ולא `FOR ALL`, וזה ההבדל שנושא את כל המשקל: פוליסה
-- מתירה בלי `WITH CHECK` יורשת את `USING` גם לכתיבה, ואז כל משרד
-- היה יכול להוסיף שורה עם tenant_id ריק — כלומר לפרסם סרטון בכל
-- המשרדים במערכת. הגבלה ל-SELECT סוגרת בדיוק את זה.
CREATE POLICY platform_content_read ON mentor_content
  FOR SELECT USING (tenant_id IS NULL);

-- 3. שולחן הפלטפורמה — כותב את התוכן המשותף, ורק אותו.
--
-- אותו דפוס כמו app.funnel_admin: הדגל נדלק במקום אחד בלבד
-- (withPlatformContent), וכל קורא שלו חסום מאחורי PlatformAdminGuard.
-- גם ה-USING מוגבל ל-tenant_id IS NULL: לשולחן הזה אין עסק עם
-- שורות של משרדים, וגם מחיקה בטעות אינה יכולה לגעת בהן.
CREATE POLICY platform_content_desk ON mentor_content
  USING (current_setting('app.platform_content', true) = 'on' AND tenant_id IS NULL)
  WITH CHECK (current_setting('app.platform_content', true) = 'on' AND tenant_id IS NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON "mentor_content" TO metavchim_app;
