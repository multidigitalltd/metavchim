-- רכש מדיה: עמוד ההזמנה לנציג (אישור קבלה וסימון „פורסם” מהקישור), ותקבול על הפניות
ALTER TABLE media_orders
  ADD COLUMN published_by VARCHAR(20) NOT NULL DEFAULT '',
  ADD COLUMN outlet_token VARCHAR(64),
  ADD COLUMN outlet_confirmed_at TIMESTAMP(3);

-- הקישור הקבוע של הנציג להזמנה — אקראי ויחיד; חיפוש לפיו הוא הנתיב הציבורי
CREATE UNIQUE INDEX media_orders_outlet_token_key ON media_orders(outlet_token);

-- מה שכבר סומן „פורסם” — סומן ממסך הפלטפורמה, כי זו הייתה הדרך היחידה
UPDATE media_orders SET published_by = 'platform' WHERE published_at IS NOT NULL;

-- רישומי ההתחשבנות: עד עכשיו רק העברות למדיה
ALTER TABLE media_settlements ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'payout';
