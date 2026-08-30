-- מקום נוסף לסוכן הוואטסאפ — מנוי חודשי, ולא רכישה לצמיתות.
--
-- ‎**שורה למקום, ולא מונה.** ביטול של מקום בודד, תאריך סיום שונה
-- לכל אחד, וחשבונית לכל חיוב — כולם דורשים שורה. מונה על המשרד לא
-- היה יודע לבטא אף אחד מהם, ובעיקר לא את השאלה „מה בדיוק בוטל”.
--
-- הטבלה **מחוץ ל-RLS**, כמו payments ומאותה סיבה: ההפעלה מגיעה
-- מהוובהוק של קארדקום (נתיב ציבורי בלי הקשר דייר), וסורק החידושים
-- החודשי עובר על כל המשרדים יחד. אין כאן מידע על לקוחות קצה — רק
-- מזהה דייר וסכומים. הסינון לפי דייר נאכף בשכבת האפליקציה.

CREATE TABLE whatsapp_seats (
  id                 CHAR(26)     PRIMARY KEY,
  tenant_id          CHAR(26)     NOT NULL,
  -- המחיר החודשי שסוכם ברגע הרכישה. צילום, ולא הפניה למסלול:
  -- שינוי מחיר חל על רכישות חדשות בלבד
  monthly_agorot     INTEGER      NOT NULL,
  -- pending | active | past_due | cancelled | released
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- יום החיוב בחודש — אותו עוגן ומאותה סיבה כמו במנוי
  billing_anchor_day SMALLINT,
  -- עד מתי שולם. חלק מחודש מחויב כחודש מלא — אין חישוב יחסי
  current_period_end TIMESTAMP(3),
  cancelled_at       TIMESTAMP(3),
  -- מתי המכסה ירדה בפועל. `cancelled_at` היא הבקשה, וזה הביצוע
  released_at        TIMESTAMP(3),
  created_by         CHAR(26),
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX whatsapp_seats_tenant_id_status_idx ON whatsapp_seats (tenant_id, status);
-- סורק החידושים והשחרורים עובר על הצירוף הזה
CREATE INDEX whatsapp_seats_status_current_period_end_idx
  ON whatsapp_seats (status, current_period_end);

-- המקום שהתשלום משלם. ריק בכל תשלום אחר; מלא, הוא מה שמפעיל
-- בהצלחה את תקופת המקום ומעלה את המכסה.
ALTER TABLE payments ADD COLUMN seat_id CHAR(26);
