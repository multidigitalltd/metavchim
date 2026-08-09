-- מחיר ליד לפי מקור.
--
-- מחוץ ל-RLS, כמו plans: זו הגדרה ברמת הפלטפורמה ולא נתון של דייר.
--
-- טבלה ולא קבוע בקוד, כי המחיר שמשלמים לספק שונה בין ספק לספק
-- ומשתנה בזמן. מחיר אחד לכל המקורות היה מחייב שינוי קוד ופריסה בכל
-- משא ומתן מסחרי.
CREATE TABLE lead_source_prices (
  source       VARCHAR(20)  PRIMARY KEY,
  label        VARCHAR(60)  NOT NULL,
  credits_cost INTEGER      NOT NULL DEFAULT 1,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   CHAR(26)
);

-- נקודת הפתיחה. `network` באפס אינו "טרם תומחר" אלא הצהרה: שיתוף
-- פעולה בין משרדים חינם, ואינו תלוי במסלול.
INSERT INTO lead_source_prices (source, label, credits_cost) VALUES
  ('network', 'משרד תיווך ברשת', 0),
  ('kanko',   'Kanko',            1)
ON CONFLICT (source) DO NOTHING;
