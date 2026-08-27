-- תיבת הדואר הפנימית — תשובות של לקוחות למיילים שהמערכת שלחה.
--
-- המערכת אינה משתלטת על הדואר של המשרד (רשומת MX הייתה מנתבת אליה
-- את *כל* הדואר, כולל התיבות הקיימות): כל מייל יוצא ללקוח נושא
-- Reply-To ייחודי — local+<token>@inbound — והתשובה חוזרת אלינו
-- כ-Webhook מספק האימייל. הטוקן מזהה את המשרד ואת הלקוח.

-- ההודעות עצמן — נכנסות ויוצאות, לתיבה ולציר הלקוח.
CREATE TABLE "email_messages" (
  "id"          CHAR(26) PRIMARY KEY,
  "tenant_id"   CHAR(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id"  CHAR(26) NOT NULL,
  -- in = מהלקוח אלינו; out = תשובת הסוכן מתוך המערכת
  "direction"   VARCHAR(3) NOT NULL,
  "subject"     VARCHAR(200) NOT NULL,
  -- גוף ההודעה: לנכנסת — התשובה החשופה (בלי הציטוט), חתוכה ל-5000
  "body"        VARCHAR(5100) NOT NULL,
  -- כתובת השולח כפי שהגיעה — לזיהוי "ענה מכתובת אחרת" במסך
  "from_email"  VARCHAR(320),
  -- MessageID של הספק — דה-דופליקציה מול Webhook שנשלח פעמיים
  "provider_message_id" VARCHAR(200),
  "read_at"     TIMESTAMPTZ,
  "read_by"     CHAR(26),
  "created_by"  CHAR(26),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- התיבה נקראת "מה חדש" ואז "השיחה עם הלקוח" — שני האינדקסים בהתאמה
CREATE INDEX "email_messages_inbox_idx" ON "email_messages" ("tenant_id", "read_at", "created_at" DESC);
CREATE INDEX "email_messages_contact_idx" ON "email_messages" ("tenant_id", "contact_id", "created_at" DESC);
-- אותו Webhook פעמיים (הספק שולח שוב על 5xx) — הודעה אחת
CREATE UNIQUE INDEX "email_messages_provider_message_id_key"
  ON "email_messages" ("tenant_id", "provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;

ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_messages"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

/*
 * טוקן ה-Reply-To — `local+<token>@inbound` על כל מייל יוצא ללקוח.
 *
 * בלי RLS **בכוונה**, כמו lead_webhooks: ה-Webhook הנכנס מקבל את
 * הטוקן ועוד לא יודע מיהו הדייר — הפוליסה הייתה חוסמת בדיוק את
 * השאילתה שמגלה אותו. אין כאן PII: טוקן אקראי, מזהה משרד ומזהה
 * כרטיס — שמות וטלפונים חיים בטבלת contacts המוצפנת, מאחורי RLS.
 */
CREATE TABLE "email_reply_tokens" (
  -- ULID אקראי — הוא עצמו הטוקן שבכתובת; 26 תווים, בגבול ה-64 של החלק המקומי
  "id"         CHAR(26) PRIMARY KEY,
  "tenant_id"  CHAR(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" CHAR(26) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- טוקן אחד ללקוח: שליחה חוזרת מוצאת את הקיים במקום להנפיק חדש
CREATE UNIQUE INDEX "email_reply_tokens_tenant_contact_key"
  ON "email_reply_tokens" ("tenant_id", "contact_id");
