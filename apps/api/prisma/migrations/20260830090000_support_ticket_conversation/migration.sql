-- ‎**פנייה מהכפתור הופכת לשיחה, ולא ל"התשובה האחרונה".**
--
-- עד כאן `support_tickets.reply` היה עמודה בודדת: תשובה שנייה דרסה
-- את הראשונה, ולא היה שום תיעוד של מה נאמר ומתי. במסך הוצג "נענה:"
-- עם מה שנכתב לאחרונה, וכל מה שקדם לו נעלם.
--
-- זו גם הסיבה שלא היה אפשר לדעת אם התשובה בכלל יצאה: לא הייתה שורה
-- שאפשר לסמן עליה `sent` / `failed`. השליחה נעטפה ב-catch שרשם
-- אזהרה, והמסך הציג "נענה" גם כשהמייל נדחה.
--
-- ‎`reply` ו-`replied_at` **נשארים** ואינם נמחקים: הם מוזנים אחורה
-- להודעה הראשונה, ומי שקורא אותם ממשיך לקבל את מה שהוא ציפה לו.

CREATE TABLE "support_ticket_messages" (
  "id"         CHAR(26)     PRIMARY KEY,
  "ticket_id"  CHAR(26)     NOT NULL,
  -- הדייר נשמר על ההודעה ולא נגזר מהפנייה: RLS אינו יכול להצטרף
  -- לטבלה אחרת, ופוליסה שנשענת על JOIN אינה פוליסה.
  "tenant_id"  CHAR(26)     NOT NULL,
  -- in = מה שהמשרד כתב, out = מה שהתמיכה השיבה
  "direction"  VARCHAR(3)   NOT NULL,
  "body"       VARCHAR(20000) NOT NULL,
  -- pending | sent | failed | unknown — אותו אוצר מילים כמו בשרשורי המייל
  "send_state" VARCHAR(10),
  "created_by" CHAR(26),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE
);

CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx"
  ON "support_ticket_messages"("ticket_id", "created_at");

-- צירופים על תשובת התמיכה. אותה מכניקה של `support_attachments`:
-- השורה נתבעת לפני ההעלאה, ו-`uploaded_at` הוא מה שמעיד שהאובייקט
-- קיים באמת — שורה בלי חותמת אינה מוצגת.
CREATE TABLE "support_ticket_attachments" (
  "id"           CHAR(26)     PRIMARY KEY,
  "message_id"   CHAR(26)     NOT NULL,
  "tenant_id"    CHAR(26)     NOT NULL,
  "ordinal"      INTEGER,
  "kind"         VARCHAR(10)  NOT NULL,
  "name"         VARCHAR(200) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes"   INTEGER      NOT NULL,
  "s3_key"       VARCHAR(300) NOT NULL,
  "uploaded_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "support_ticket_messages"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "support_ticket_attachments_message_id_ordinal_key"
  ON "support_ticket_attachments"("message_id", "ordinal");
CREATE INDEX "support_ticket_attachments_message_id_idx"
  ON "support_ticket_attachments"("message_id");

ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON support_ticket_attachments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY support_desk ON support_ticket_attachments
  USING (current_setting('app.support_desk', true) = 'on')
  WITH CHECK (current_setting('app.support_desk', true) = 'on');

-- ‎**הטלפון של מי שפנה.**
--
-- הפנייה נשאה מייל בלבד, ולכן תמיכה שרצתה לחזור בטלפון — הדרך
-- המהירה ביותר לסגור תקלה חוסמת — נאלצה לחפש את המשתמש בנפרד.
ALTER TABLE "support_tickets" ADD COLUMN "user_phone" VARCHAR(32);

-- מילוי אחורה מהפרופיל. פניות ישנות מקבלות את הטלפון שרשום היום;
-- משתמש שנמחק או שאין לו טלפון נשאר NULL, וזה מדויק — אין מה למלא.
UPDATE "support_tickets" t
   SET "user_phone" = u."phone"
  FROM "users" u
 WHERE u."id" = t."user_id"
   AND u."phone" IS NOT NULL
   AND u."phone" <> '';

-- ההודעה הראשונה של כל פנייה קיימת: מה שהמשרד כתב.
-- בלעדיה השיחה מתחילה מהתשובה, והשאלה נעלמת מהמסך החדש.
INSERT INTO "support_ticket_messages"
  ("id", "ticket_id", "tenant_id", "direction", "body", "send_state", "created_by", "created_at")
SELECT
  -- מזהה דטרמיניסטי באורך 26 מתוך מזהה הפנייה: הרצה חוזרת של
  -- המיגרציה לא תכפיל שורות, ואין תלות בגנרטור חיצוני.
  --
  -- התווים 2–26 ולא 1–25: ב-ULID עשרת הראשונים הם חותמת הזמן,
  -- ושתי פניות מאותה מילישנייה חולקות אותם. מה שמבדיל ביניהן יושב
  -- בזנב, ולכן הוא זה שנשמר.
  'T' || substr(t."id", 2, 25),
  t."id", t."tenant_id", 'in', t."message", NULL, t."user_id", t."created_at"
FROM "support_tickets" t
ON CONFLICT ("id") DO NOTHING;

-- והתשובה שכבר נשלחה, כשיש כזו. `send_state` נשאר NULL ולא 'sent':
-- איננו יודעים אם היא באמת יצאה — זו בדיוק התקלה שהמיגרציה הזו
-- מגיעה בעקבותיה, ולסמן 'sent' על סמך כלום היה להנציח אותה.
INSERT INTO "support_ticket_messages"
  ("id", "ticket_id", "tenant_id", "direction", "body", "send_state", "created_by", "created_at")
SELECT
  'R' || substr(t."id", 2, 25),
  t."id", t."tenant_id", 'out', t."reply", NULL, NULL,
  COALESCE(t."replied_at", t."updated_at")
FROM "support_tickets" t
WHERE t."reply" IS NOT NULL AND t."reply" <> ''
ON CONFLICT ("id") DO NOTHING;

-- ‎**ה-RLS נדלק בסוף, אחרי המילוי אחורה.**
--
-- ‎`FORCE ROW LEVEL SECURITY` חל גם על בעל הטבלה, ומיגרציות רצות
-- בשמו. הכנסה שנעשית לפני שהפוליסות קיימות אינה תלויה בהנחה על
-- ההרשאות של מי שמריץ — והיא ממילא הסדר הנכון: הטבלה מתמלאת ואז
-- נסגרת.
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages FORCE ROW LEVEL SECURITY;

-- אותן שתי פוליסות בדיוק כמו על `support_tickets`, ומאותו נימוק:
-- המשרד רואה את השיחה שלו, והתמיכה חוצה דיירים מאחורי הדגל שנדלק
-- רק ב-`withSupportDesk` ומאחורי PlatformAdminGuard.
CREATE POLICY tenant_isolation ON support_ticket_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY support_desk ON support_ticket_messages
  USING (current_setting('app.support_desk', true) = 'on')
  WITH CHECK (current_setting('app.support_desk', true) = 'on');
