-- ‏טוקן ההסרה מדיוור ברמת **הכרטיס**.
--
-- ‏ההסרה הקיימת נשענת על טוקן של הצעה (offer → match → buyer →
-- ‏contact). שליחה ידנית של נכס אינה יוצרת `Offer` — `matchId`
-- ‏שלה ייחודי, כלומר הצעה מחייבת התאמה שמנוע ההתאמות קבע — ולכן
-- ‏לא היה לה שום קישור הסרה. דיוור שיווקי בלי דרך פשוטה להסיר
-- ‏את עצמך אינו חוקי (חוק התקשורת §30א).
--
-- ‎**טבלה ולא עמודה על `contacts`.** עמודה הייתה מחייבת פוליסת
-- ‏קריאה־לפי־טוקן על טבלת הכרטיסים עצמה — הטבלה שכל ה-PII המוצפן
-- ‏יושב בה. כאן אין דבר מלבד הקישור בין טוקן לכרטיס, וזה בדיוק
-- ‏הדפוס של `activation_nudge_optouts`.
CREATE TABLE "contact_optout_tokens" (
  "id"         CHAR(26) NOT NULL,
  "tenant_id"  CHAR(26) NOT NULL,
  "contact_id" CHAR(26) NOT NULL,
  /* ‏מה שבקישור — 256 ביט אקראיים ב-base64url, בלתי ניתן לניחוש */
  "token"      CHAR(43) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_optout_tokens_pkey" PRIMARY KEY ("id")
);

-- ‏הטוקן **הוא** הזיהוי בנתיב הציבורי, ולכן ייחודי גלובלית.
CREATE UNIQUE INDEX "contact_optout_tokens_token_key"
  ON "contact_optout_tokens" ("token");

-- ‏טוקן אחד לכרטיס, לתמיד: קישור הסרה שנשלח אתמול חייב להמשיך
-- ‏לעבוד גם אחרי עשר שליחות נוספות. הייחודיות היא מה שהופך את
-- ‏„צור אם אין” לאטומי מול שתי שליחות במקביל.
CREATE UNIQUE INDEX "contact_optout_tokens_contact_key"
  ON "contact_optout_tokens" ("tenant_id", "contact_id");

ALTER TABLE "contact_optout_tokens"
  ADD CONSTRAINT "contact_optout_tokens_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;

ALTER TABLE "contact_optout_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_optout_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "contact_optout_tokens"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ‏ההסרה מהקישור שבמייל: השורה היחידה שהטוקן שלה הוצג, בלי הקשר
-- ‏דייר ובלי גישה לשום שורה אחרת. אותו דפוס כמו `app.nudge_token`.
--
-- ‏קריאה בלבד — הטבלה הזו רק מזהה את הכרטיס; ההסרה עצמה נכתבת
-- ‏על `contacts.opted_out_at` אחרי שהוצב הקשר הדייר מתוך השורה,
-- ‏בדיוק כמו במסלול ההצעה.
CREATE POLICY contact_optout_public_read ON "contact_optout_tokens" FOR SELECT
  USING (token = current_setting('app.contact_optout_token', true));
