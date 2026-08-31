-- ‎**„אל תשלחו לי עוד” — וזה חייב לעבוד בלי להתחבר.**
--
-- תזכורות ההפעלה הן דיוור אוטומטי, וחוק התקשורת §30א דורש דרך פשוטה
-- וסבירה להודיע על סירוב. „היכנסו למערכת והסירו” אינה כזו — במיוחד
-- כשההודעה נשלחת דווקא למי שהחשבון שלו ננעל.
--
-- ‎**למה טבלה נפרדת ולא עמודה על `users`.**
--
-- כדי שקישור ההסרה יעבוד בלי הקשר דייר צריך פוליסת RLS שחושפת שורה
-- לפי הטוקן שבקישור. פוליסה כזו על `users` הייתה פותחת את **כל
-- העמודות** של אותה שורה לטרנזקציה הציבורית — כולל `password_hash`.
-- RLS אינו יודע להגביל עמודות, ולכן הגבול הנכון הוא טבלה שאין בה
-- דבר מלבד הטוקן וההסרה עצמה. אותו שיקול כמו ב-`email_reply_tokens`.
--
-- ‎`opted_out_at` בשדה נפרד ולא כמחיקת שורה: הטוקן חייב להמשיך
-- לזהות את מי שכבר הסיר את עצמו, אחרת לחיצה שנייה על אותו קישור
-- מחזירה „הקישור אינו תקין” למי שעשה בדיוק מה שביקשנו ממנו.
CREATE TABLE "activation_nudge_optouts" (
  "id"           CHAR(26)    PRIMARY KEY,
  -- הדייר על השורה ולא נגזר מהמשתמש: RLS אינו יכול להצטרף לטבלה אחרת
  "tenant_id"    CHAR(26)    NOT NULL,
  "user_id"      CHAR(26)    NOT NULL,
  -- מה שבקישור. אקראי ובלתי ניתן לניחוש — הוא ההוכחה שהמחזיק בו
  -- קיבל את ההודעה, בדיוק כמו הטוקן של דף ההצעה.
  "token"        VARCHAR(64) NOT NULL,
  -- NULL = עדיין מקבל. חותמת = ביקש להפסיק, ולתמיד.
  "opted_out_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activation_nudge_optouts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "activation_nudge_optouts_user_id_key"
  ON "activation_nudge_optouts"("user_id");
CREATE UNIQUE INDEX "activation_nudge_optouts_token_key"
  ON "activation_nudge_optouts"("token");

ALTER TABLE activation_nudge_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_nudge_optouts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON activation_nudge_optouts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ההסרה מהקישור שבמייל: השורה היחידה שהטוקן שלה הוצג, בלי הקשר
-- דייר ובלי גישה לשום שורה אחרת. אותו דפוס כמו `app.offer_token`.
CREATE POLICY nudge_public_read ON activation_nudge_optouts FOR SELECT
  USING (token = current_setting('app.nudge_token', true));

CREATE POLICY nudge_public_update ON activation_nudge_optouts FOR UPDATE
  USING (token = current_setting('app.nudge_token', true))
  WITH CHECK (token = current_setting('app.nudge_token', true));
