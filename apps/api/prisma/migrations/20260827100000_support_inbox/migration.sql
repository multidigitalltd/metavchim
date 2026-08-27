-- תיבת התמיכה של הפלטפורמה — כתובת שירות שהיא חלק מהמערכת.
--
-- **מחוץ ל-RLS, וגם בלי `tenant_id` חובה.** זו הנקודה שבה היא שונה
-- מתיבת המשרד: פנייה לתמיכה יכולה להגיע ממי שאינו לקוח כלל — מתווך
-- ששוקל להצטרף, ספק, או מישהו שטעה בכתובת. שרשור נקשר למשרד כשאפשר
-- לזהות אותו לפי כתובת השולח, ונשאר בלי משרד כשלא.

-- שרשור = פונה אחד ונושא אחד.
CREATE TABLE "support_threads" (
  "id"            CHAR(26) PRIMARY KEY,
  -- הטוקן שנשתל בכתובת התשובה. הוא מה שמחזיר את תשובת הפונה לאותו
  -- שרשור במקום לפתוח פנייה חדשה בכל סבב.
  "reply_token"   CHAR(26) NOT NULL UNIQUE,
  -- המשרד, כשזוהה לפי כתובת השולח. NULL = פונה שאינו לקוח.
  "tenant_id"     CHAR(26),
  "contact_email" VARCHAR(254),
  "contact_name"  VARCHAR(120) NOT NULL,
  "subject"       VARCHAR(200) NOT NULL,
  -- open | closed. פתוח עד שסוגרים במפורש — פנייה אינה נסגרת מעצמה
  "status"        VARCHAR(20) NOT NULL DEFAULT 'open',
  -- מתי הגיעה ההודעה האחרונה, לסידור הרשימה לפי מי מחכה
  "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- מתי נקראה לאחרונה על ידי התמיכה; NULL = לא נקראה
  "read_at"       TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- הרשימה נקראת "מי מחכה" — פתוחים לפי ההודעה האחרונה
CREATE INDEX "support_threads_open_idx" ON "support_threads" ("status", "last_message_at" DESC);
-- שרשור לפי שולח: פנייה חוזרת בלי טוקן מצטרפת לשרשור הפתוח שלו
CREATE INDEX "support_threads_email_idx" ON "support_threads" ("contact_email", "status");

CREATE TABLE "support_messages" (
  "id"          CHAR(26) PRIMARY KEY,
  "thread_id"   CHAR(26) NOT NULL REFERENCES "support_threads"("id") ON DELETE CASCADE,
  -- in = מהפונה אלינו; out = תשובת התמיכה
  "direction"   VARCHAR(3) NOT NULL,
  "body"        VARCHAR(20000) NOT NULL,
  "from_email"  VARCHAR(254),
  -- MessageID של הספק — דה-דופליקציה מול Webhook שנשלח פעמיים
  "provider_message_id" VARCHAR(200) UNIQUE,
  -- מי מהתמיכה ענה; NULL בהודעה נכנסת
  "created_by"  CHAR(26),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "support_messages_thread_idx" ON "support_messages" ("thread_id", "created_at");

-- קבצים מצורפים — צילום מסך הוא הדבר הכי שימושי שפונה יכול לשלוח,
-- והשמטתו הופכת פנייה מלאה לפנייה חלקית. אותם כללי סוגים כמו בתיבת
-- המשרד; התוכן באחסון האובייקטים והמפתח כאן.
CREATE TABLE "support_attachments" (
  "id"           CHAR(26) PRIMARY KEY,
  "message_id"   CHAR(26) NOT NULL REFERENCES "support_messages"("id") ON DELETE CASCADE,
  -- image | video | file
  "kind"         VARCHAR(10) NOT NULL,
  "name"         VARCHAR(200) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes"   INTEGER NOT NULL,
  "s3_key"       VARCHAR(300) NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "support_attachments_message_idx" ON "support_attachments" ("message_id");
