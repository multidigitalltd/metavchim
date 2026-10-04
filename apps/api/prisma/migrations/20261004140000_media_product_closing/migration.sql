-- רכש מדיה: מועד סגירה לכל מוצר בנפרד — גובר על מועד המדיה כשהוא קיים
ALTER TABLE media_products ADD COLUMN next_closing_at TIMESTAMP(3);

-- מניעת כפילות בתזכורת סגירה נשענת מעכשיו על ההזמנה בלבד (closing_reminder_at
-- שווה למועד): סימון על המדיה השתיק הזמנות שנפתחו אחרי הסבב הראשון בחלון
ALTER TABLE media_outlets DROP COLUMN reminded_for_closing_at;
