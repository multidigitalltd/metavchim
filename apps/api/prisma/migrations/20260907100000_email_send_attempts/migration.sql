-- ‎**זיכרון של שליחה — כי כישלון מסירה אינו בהכרח „לא נשלח”.**
--
-- ‏‎4xx פירושו שהספק בדק ופסל, ולכן ההודעה בוודאות לא יצאה. פסק זמן,
-- ‏נפילת רשת או ‎5xx פירושם ש**איננו יודעים**: ייתכן שהספק קיבל את
-- ‏ההודעה ושלח אותה, ורק התשובה אבדה בדרך חזרה. בלי זיכרון, כל ניסיון
-- ‏חוזר הוא הימור בין מייל כפול ללקוח לבין מייל שלא הגיע כלל.
--
-- ‏השורה נכתבת לפני הקריאה לספק ומסומנת אחריה, והמפתח נשלח גם
-- ‏כ-Metadata על ההודעה — ולכן „עמום” ניתן להכרעה בדיעבד מול חיפוש
-- ‏ההודעות היוצאות של הספק, במקום לנחש.
--
-- ‎**בלי נמען, נושא או תוכן:** להכרעה די במפתח, וכל מה שאינו נחוץ הוא
-- ‏PII שנשמר בלי סיבה.
--
-- ‏מחוץ ל-RLS במודע (כמו support_threads): אותה טבלה משרתת גם שליחות
-- ‏שאין להן דייר כלל — הרשמה, התחברות, התראות פלטפורמה, תמיכה —
-- ‏ופוליסה הייתה חוסמת דווקא אותן. tenant_id נשמר כשהוא ידוע, כדי
-- ‏שמחיקת משרד תמחק גם אותו.
CREATE TABLE "email_send_attempts" (
  "key"                 VARCHAR(80)  PRIMARY KEY,
  "tenant_id"           CHAR(26),
  "purpose"             VARCHAR(40)  NOT NULL,
  "status"              VARCHAR(10)  NOT NULL,
  "provider_message_id" VARCHAR(120),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_send_attempts_status_check"
    CHECK ("status" IN ('sending', 'sent', 'unknown', 'rejected'))
);

-- ‏שמירה קצרה: הזיכרון נחוץ לניסיון החוזר, לא לנצח
CREATE INDEX "email_send_attempts_created_at_idx" ON "email_send_attempts" ("created_at");
CREATE INDEX "email_send_attempts_tenant_id_idx" ON "email_send_attempts" ("tenant_id");
