-- תקציב הוא נתון שמתברר, לא תנאי קבלה.
--
-- לקוח יכול להיות קונה, מוכר או ליד בלי תקציב ידוע — שיחה נכנסת
-- שנרשמו בה שם וטלפון היא לקוח לכל דבר. העמודה הייתה NOT NULL,
-- ולכן המסכים הבריחו לתוכה 0: "תקציב אפס", שמנוע ההתאמות קורא
-- כ"לא יכול להרשות לעצמו שום נכס". כלומר הנתון לא רק היה חסר —
-- הוא היה שגוי, ובשקט.
ALTER TABLE "buyers" ALTER COLUMN "budget_max_agorot" DROP NOT NULL;
ALTER TABLE "shared_demands" ALTER COLUMN "budget_max_agorot" DROP NOT NULL;

/*
 * האפסים ההיסטוריים הופכים ל-NULL.
 *
 * 0 מעולם לא היה תקציב אמיתי — אין קונה שתקציבו אפס. הוא היה
 * הדרך היחידה לשמור כרטיס בלי תקציב, ולכן המרתו היא תיקון של
 * נתון שגוי ולא איבוד מידע.
 */
UPDATE "buyers" SET "budget_max_agorot" = NULL WHERE "budget_max_agorot" = 0;
UPDATE "shared_demands" SET "budget_max_agorot" = NULL WHERE "budget_max_agorot" = 0;

/*
 * ...ובאותה נשימה גם בתוך ה-JSON.
 *
 * `budget_max_agorot` היא עמודה חמה שנגזרת מ-`requirements`, ולא
 * מחליפה אותו: `toDto` מפענח את ה-JSONB, וההתאמה המפורטת רצה על
 * מה שהוא מחזיר. ניקוי העמודה בלבד היה משאיר את הקונים ההיסטוריים
 * בדיוק במצב שהמיגרציה באה לתקן — מוצגים כ"עד 0 ₪" ונפסלים מכל
 * נכס מתומחר — רק עם עמודה שאומרת אחרת (ביקורת Codex).
 *
 * מחיקת המפתח ולא השמת `null`: הסכמה מגדירה אותו `.optional()`,
 * כלומר „חסר”, ו-`null` מפורש היה נכשל בפענוח.
 */
UPDATE "buyers"
   SET "requirements" = "requirements" - 'budgetMaxAgorot'
 WHERE "requirements" ->> 'budgetMaxAgorot' = '0';

/*
 * אינדקס חלקי לקונים בלי תקציב.
 *
 * סינון המועמדים להתאמה הופך מ-`budget_max >= X` ל-
 * `(budget_max >= X OR budget_max IS NULL)`, וה-OR מונע סריקת טווח
 * נקייה על האינדקס הקיים. האינדקס הזה נותן לתכנן צד זול ל-OR
 * במקום סריקה מלאה.
 */
CREATE INDEX "buyers_no_budget_idx"
  ON "buyers" ("tenant_id", "deal_type")
  WHERE "budget_max_agorot" IS NULL;
