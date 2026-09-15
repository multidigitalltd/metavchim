-- ‏הסוכן השני על עסקה שנסגרה בשיתוף שני סוכנים מאותו משרד.
--
-- ‎`NULL` הוא האמת על כל השורות הקיימות ועל רוב השורות העתידיות,
-- ‏ולכן אין ברירת מחדל: היא הייתה קובעת עובדה שאיש לא בדק.
--
-- ‎**אין `FOREIGN KEY` ל-users, ובמכוון.** אותה הכרעה כמו
-- ‏`agent_user_id` שלצידו: משתמש שיוצא מהמשרד אינו אמור להפיל
-- ‏מחיקה או להשאיר נכס יתום, והשם נפתר בקריאה.
ALTER TABLE "properties" ADD COLUMN "partner_user_id" CHAR(26);

-- ‎**אינדקס חלקי.** רוב מוחלט של השורות ריק בעמודה הזו, ואינדקס
-- ‏מלא היה כמעט כולו ערכי `NULL` — נפח בלי תועלת. השאילתה היחידה
-- ‏שקוראת אותו היא „השת״פים של המשרד בתקופה”, והיא ממילא מסננת
-- ‏על מה שאינו ריק.
CREATE INDEX "properties_partner_idx"
  ON "properties" ("tenant_id", "partner_user_id")
  WHERE "partner_user_id" IS NOT NULL;

-- ‎**ושת״פ עם עצמו נחסם במסד ולא רק בקוד.** „X עם X” אינו שת״פ,
-- ‏והוא היה מציג שורה שקרית בסיכום המשרד. הכלל נאכף גם ב-`logic/
-- ‏office-partner.ts` (המסך והשרת קוראים משם), וכאן הוא חוסם גם
-- ‏כתיבה שתעקוף אותם.
ALTER TABLE "properties" ADD CONSTRAINT "properties_partner_not_self"
  CHECK ("partner_user_id" IS NULL OR "partner_user_id" <> "agent_user_id");
