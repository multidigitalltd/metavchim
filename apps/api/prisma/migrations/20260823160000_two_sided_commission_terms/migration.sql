-- חלוקת עמלה בשני צדדים — צד הקונה וצד המוכר בנפרד.
--
-- בעסקת תיווך יש שני תשלומים ולא אחד: הקונה משלם דמי תיווך והמוכר
-- משלם דמי תיווך. `commission_split` היחיד תיאר "כמה אני לוקח
-- מהעסקה" כאילו מדובר בקופה אחת, ולכן לא ידע לבטא את ההסדר הנפוץ
-- ביותר בשוק — כל צד גובה מהלקוח שלו.
--
-- ארבע עמודות לכל טבלה: אחוז לכל צד, או ניסוח חופשי ("אחר") כשאין
-- אחוז. שתיהן NULL בשורה שקדמה להפרדה, ואז `commission_split` הוא
-- החלוקה בשני הצדדים — לא השלמה אלא בדיוק מה שהיא אמרה. לכן אין
-- כאן UPDATE שממלא את השורות הקיימות: מילוי כזה היה הופך הנחה
-- לנתון, ומסתיר לאיזה פרסום התנאים אכן נקבעו בשני צדדים.
--
-- `commission_split` נשאר ואינו יורד מהטבלה: הוא הכותרת שהצעה,
-- הצעה נגדית וחדר עסקה נושאים, והוא נגזר מהצד שהמשרד המפרסם
-- מחזיק — צד הקונה בביקוש, צד המוכר בפרסום נכס.
--
-- העמודות חדשות ו-NULL, ולכן ההגירה אינה נועלת ואינה כותבת מחדש
-- את הטבלאות.

ALTER TABLE shared_demands
  ADD COLUMN buyer_split       SMALLINT,
  ADD COLUMN buyer_split_note  VARCHAR(200),
  ADD COLUMN seller_split      SMALLINT,
  ADD COLUMN seller_split_note VARCHAR(200);

ALTER TABLE shared_listings
  ADD COLUMN buyer_split       SMALLINT,
  ADD COLUMN buyer_split_note  VARCHAR(200),
  ADD COLUMN seller_split      SMALLINT,
  ADD COLUMN seller_split_note VARCHAR(200);
