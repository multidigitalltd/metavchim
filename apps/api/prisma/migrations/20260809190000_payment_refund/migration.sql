-- זיכוי תשלום.
--
-- הנתונים היו כאן, המסך לא: תשלום שנגבה בטעות או מנוי שבוטל באמצע
-- חודש דרשו כניסה לממשק של קארדקום. הזיכוי נרשם על אותה שורת תשלום
-- ולא כשורה חדשה — הוא אינו עסקה נוספת מבחינת המשרד אלא ביטול של
-- זו שהייתה, וכך הדוח מציג סכום אחד ולא שניים שמתקזזים.
--
-- refunded_agorot ולא דגל: זיכוי חלקי הוא המקרה הנפוץ (החזר יחסי על
-- חודש שלא נוצל), ו"זוכה כן/לא" לא היה יודע לתאר אותו.
ALTER TABLE payments ADD COLUMN refunded_agorot INTEGER;
ALTER TABLE payments ADD COLUMN refunded_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN refund_transaction_id VARCHAR(40);
ALTER TABLE payments ADD COLUMN refund_reason VARCHAR(300);
