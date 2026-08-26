-- הדומיין שהמשרד חיבר לשליחת אימייל מהכתובת שלו.
--
-- המערכת שולחת ללקוחות של המשרד (הסכם לחתימה, ובעתיד הצעות במייל)
-- מכתובת הפלטפורמה. משרד שמחבר דומיין שולח מהכתובת שלו —
-- info@office.co.il — והלקוח רואה את המשרד ולא את הפלטפורמה.
--
-- הרשומות (DKIM + Return-Path) מונפקות אצל ספק האימייל (Postmark),
-- נשמרות כאן ומוצגות במסך; המשרד מוסיף אותן אצל ספק הדומיין שלו
-- ולוחץ "בדקו אימות". השליחה עוברת לכתובת המשרד רק כששתי הרשומות
-- אומתו — חצי אימות יוצא לא חתום ונוחת בספאם.
CREATE TABLE "email_domains" (
  "id"                   CHAR(26) PRIMARY KEY,
  -- דומיין אחד למשרד: המסך מציג חיבור יחיד, לא רשימה.
  "tenant_id"            CHAR(26) NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "domain"               VARCHAR(253) NOT NULL,
  "provider"             VARCHAR(30) NOT NULL DEFAULT 'postmark',
  "provider_domain_id"   VARCHAR(60) NOT NULL,
  "dkim_host"            VARCHAR(253) NOT NULL,
  -- מפתח RSA ציבורי ב-Base64 — ארוך. 1000 עם מרווח, כמו last_event_keys.
  "dkim_value"           VARCHAR(1000) NOT NULL,
  "return_path_host"     VARCHAR(253) NOT NULL,
  "return_path_value"    VARCHAR(253) NOT NULL,
  "dkim_verified"        BOOLEAN NOT NULL DEFAULT false,
  "return_path_verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at"          TIMESTAMPTZ,
  "from_email"           VARCHAR(254) NOT NULL,
  "from_name"            VARCHAR(80) NOT NULL,
  "last_checked_at"      TIMESTAMPTZ,
  "created_by"           CHAR(26),
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ייחודיות גלובלית של הדומיין — מעבר לגבול הדייר, ולכן אינדקס ולא
-- פוליסה: משרד אינו יכול לתפוס דומיין שמשרד אחר כבר חיבר ולשלוח
-- בשמו. ההתנגשות מוחזרת למסך כשגיאה ידידותית, בלי לגלות מי מחזיק.
CREATE UNIQUE INDEX "email_domains_domain_key" ON "email_domains" ("domain");

/*
 * RLS כמו בכל טבלת דייר. שליחת מייל מתוזמנת (חידושים, תזכורות) רצה
 * בלי הקשר בקשה ולכן קוראת דרך withExplicitTenant — עדיין תחת
 * הפוליסה, עם מזהה שמגיע מהשורה שבגינה נשלח המייל, לעולם לא מקלט.
 */
ALTER TABLE "email_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_domains"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
