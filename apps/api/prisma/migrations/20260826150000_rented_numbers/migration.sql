-- השכרת מספרים וירטואליים מחשבון 015 של הפלטפורמה.
--
-- הטבלה **מחוץ ל-RLS**, כמו payments ומאותה סיבה: ההפעלה מגיעה
-- מהוובהוק של קארדקום (נתיב ציבורי בלי הקשר דייר), וסורק החידושים
-- החודשי עובר על כל המשרדים יחד. אין כאן מידע על לקוחות קצה — רק
-- מזהה דייר, מספר טלפון שהפלטפורמה שוכרת, וסכומים. הסינון לפי דייר
-- נאכף בשכבת האפליקציה, מפורשות בכל שאילתה.

CREATE TABLE rented_numbers (
  id                    CHAR(26)     PRIMARY KEY,
  tenant_id             CHAR(26)     NOT NULL,
  -- הספרות כפי ש-015 מכיר אותן — זה המפתח מול הספק
  number                VARCHAR(20)  NOT NULL,
  -- המחיר החודשי שסוכם ברגע ההשכרה. צילום, לא הפניה להגדרה
  monthly_agorot        INTEGER      NOT NULL,
  -- pending | active | past_due | cancelled | released
  status                VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- יום החיוב בחודש — אותו עוגן ומאותה סיבה כמו במנוי
  billing_anchor_day    SMALLINT,
  -- עד מתי שולם. חלק מחודש מחויב כחודש מלא — אין חישוב יחסי
  current_period_end    TIMESTAMP(3),
  cancelled_at          TIMESTAMP(3),
  -- מתי המספר נתפס בפועל אצל 015. ריק אחרי תשלום = נכשל, טיפול ידני
  provider_purchased_at TIMESTAMP(3),
  provider_released_at  TIMESTAMP(3),
  -- השגיאה האחרונה מול הספק — לתמיכה, לא למשתמש
  provider_error        VARCHAR(300),
  created_by            CHAR(26),
  created_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX rented_numbers_tenant_id_idx ON rented_numbers (tenant_id);
-- סורק החידושים והשחרורים עובר על הצירוף הזה
CREATE INDEX rented_numbers_status_current_period_end_idx
  ON rented_numbers (status, current_period_end);

-- ההשכרה שהתשלום משלם. ריק בתשלום שאינו השכרת מספר; מלא, הוא מה
-- שמפעיל בהצלחה את תפיסת המספר אצל 015 ואת תקופת ההשכרה.
ALTER TABLE payments ADD COLUMN rental_id CHAR(26);
