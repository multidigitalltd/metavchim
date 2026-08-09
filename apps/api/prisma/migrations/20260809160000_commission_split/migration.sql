-- חלוקת עמלה בשיתוף פעולה.
--
-- הלקוח משלם עמלה אחת, והיא מתחלקת בין שני המשרדים. החלוקה נקבעת
-- ברגע השיתוף ולא בסופו: מו"מ על אחוזים אחרי שהקונה כבר התעניין הוא
-- בדיוק המקום שבו שיתופי פעולה נשברים.
--
-- הערך הוא האחוז שהצד ה**יוזם** לוקח; לשני נשאר המשלים. המינימום
-- לכל צד הוא 33% — מתחת לזה הצד השני עובד כמעט בחינם, וזה כבר לא
-- שיתוף פעולה. האכיפה בשכבת האפליקציה
-- (packages/shared — collaboration-cost.ts), וה-CHECK כאן הוא הרשת
-- האחרונה מפני כתיבה שעוקפת אותה.
ALTER TABLE shared_demands
  ADD COLUMN commission_split SMALLINT NOT NULL DEFAULT 50;
ALTER TABLE shared_demands
  ADD CONSTRAINT shared_demands_commission_split_range
  CHECK (commission_split BETWEEN 33 AND 67);

ALTER TABLE coop_offers
  ADD COLUMN commission_split SMALLINT NOT NULL DEFAULT 50;
ALTER TABLE coop_offers
  ADD CONSTRAINT coop_offers_commission_split_range
  CHECK (commission_split BETWEEN 33 AND 67);
