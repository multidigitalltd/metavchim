-- משפטי המוטבציה של המנטור — נכתבים בידי אדם, לא באים עם הקוד.
--
-- ‏עד כאן ישבה בקוד רשימה סגורה של חמישה-עשר משפטים שהמערכת בחרה.
-- ‏משפט מוטבציה עובד כשהוא בקול שהמתווך מזהה — של מנהל המשרד שלו —
-- ‏ולא בקול של תוכנה, ורשימה שאיש לא בחר הופכת אחרי שבוע לרעש
-- ‏שגוללים מעליו. לכן הטבלה הזו, ולכן שני ההיקפים שבה.
--
-- ‎`tenant_id IS NULL` = משפט של הפלטפורמה, מוצג בכל המשרדים.
-- ‎`tenant_id = X`      = משפט של המשרד X, מוצג רק בו.
--
-- ‏העמודה נילית ולא שתי טבלאות נפרדות: המסך מציג את שתי הקבוצות
-- ‏באותו סליידר וממיין ביניהן, ופיצול היה מכריח כל קורא לאחד אותן
-- ‏מחדש — כלומר לחזור על אותה הכרעה בכל מקום.

CREATE TABLE "mentor_quotes" (
    "id" CHAR(26) NOT NULL,
    -- NULL = משפט של הפלטפורמה, גלוי לכל המשרדים
    "tenant_id" CHAR(26),
    -- 240 תווים: אותו גבול כמו QUOTE_MAX_LENGTH בחבילה המשותפת
    "text" VARCHAR(240) NOT NULL,
    -- „מי אמר”. ריק הוא תשובה לגיטימית — מנהל שחיבר משפט לצוות שלו
    -- אינו חייב לייחס אותו לאיש, ו„לא ידוע” מתחתיו הוא המצאה קטנה
    "author" VARCHAR(80) NOT NULL DEFAULT '',
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mentor_quotes_pkey" PRIMARY KEY ("id")
);

-- „המשפטים של המשרד הזה, בסדר שנכתבו” — בדיוק מה שהמסך שואל.
-- שורות הפלטפורמה (tenant_id IS NULL) יושבות בקצה אחד של האינדקס
-- ונקראות באותה שאילתה.
CREATE INDEX "mentor_quotes_tenant_id_created_at_idx"
  ON "mentor_quotes"("tenant_id", "created_at");

ALTER TABLE mentor_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_quotes FORCE ROW LEVEL SECURITY;

-- 1. המשפטים של המשרד — קריאה וכתיבה, כמו כל טבלת דייר אחרת.
CREATE POLICY tenant_isolation ON mentor_quotes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- 2. המשפטים של הפלטפורמה — **קריאה בלבד**, לכל מי שמחובר.
--
-- ‎`FOR SELECT` ולא `FOR ALL`, וזה ההבדל שנושא את כל המשקל: פוליסה
-- מתירה בלי `WITH CHECK` יורשת את `USING` גם לכתיבה, ואז כל משרד
-- היה יכול להוסיף שורה עם tenant_id ריק — כלומר לכתוב משפט שמוצג
-- בכל המשרדים במערכת. הגבלה ל-SELECT סוגרת בדיוק את זה.
CREATE POLICY platform_quotes_read ON mentor_quotes
  FOR SELECT USING (tenant_id IS NULL);

-- 3. שולחן הפלטפורמה — כותב את המשפטים המשותפים, ורק אותם.
--
-- אותו דפוס כמו app.support_desk ו-app.payout_desk: הדגל נדלק
-- במקום אחד בלבד (withPlatformQuotes), וכל קורא שלו חסום מאחורי
-- PlatformAdminGuard. ההבדל מהם הוא שכאן גם ה-USING מוגבל
-- ל-tenant_id IS NULL: לשולחן הזה אין עסק עם שורות של משרדים, וגם
-- מחיקה בטעות אינה יכולה לגעת בהן.
CREATE POLICY platform_quotes_desk ON mentor_quotes
  USING (current_setting('app.platform_quotes', true) = 'on' AND tenant_id IS NULL)
  WITH CHECK (current_setting('app.platform_quotes', true) = 'on' AND tenant_id IS NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON "mentor_quotes" TO metavchim_app;
