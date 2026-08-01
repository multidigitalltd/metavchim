-- הגדרות פלטפורמה (מפתחות ספקים: Postmark, WhatsApp) — נשלטות ממסך
-- /platform במקום משתני סביבה + SSH. הערכים מוצפנים (CryptoService),
-- ולכן גיבוי או גישת קריאה ל-DB אינם חושפים אותם.
--
-- הערת RLS: זו טבלה ברמת הפלטפורמה, לא ברמת דייר — כמו users/sessions
-- היא מחוץ לפוליסת הבידוד. הגישה אליה נאכפת בשכבת האפליקציה בלבד
-- (PLATFORM_ADMIN_EMAILS), והיא לעולם לא נקראת בהקשר דייר.
CREATE TABLE platform_settings (
  key             VARCHAR(60) PRIMARY KEY,
  value_encrypted TEXT        NOT NULL,
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by      CHAR(26)
);
