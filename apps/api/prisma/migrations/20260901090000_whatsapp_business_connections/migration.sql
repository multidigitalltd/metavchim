-- ‎**חיבור וואטסאפ ביזנס של משרד — הקו שלו, לא של הפלטפורמה.**
--
-- עד היום היה קו אחד (הסוכן האישי) והמשרדים זוהו לפי מספר שהוקלד
-- ביד בהגדרות. כאן כל משרד מחבר את המספר **שלו** דרך Embedded
-- Signup, וה-WABA, המספר והחיוב מול Meta הם שלו (docs/12, ADR-006).
--
-- ‎**מחוץ ל-RLS למרות `tenant_id`** — בדיוק כמו `whatsapp_links`
-- ומאותה סיבה: השורה נקראת בנתיב הציבורי של ה-Webhook, ברגע שבו
-- הדייר עדיין אינו ידוע, והיא עצמה מה שמגלה אותו. פוליסה כאן הייתה
-- חוסמת את השאילתה שנועדה להכריע לאיזה משרד ההודעה שייכת.
CREATE TABLE "whatsapp_business_connections" (
    "id"                     CHAR(26)     NOT NULL,
    "tenant_id"              CHAR(26)     NOT NULL,
    -- מזהי Meta — יציבים ולא-סודיים, והם מפתחות הניתוב
    "waba_id"                VARCHAR(32)  NOT NULL,
    "phone_number_id"        VARCHAR(32)  NOT NULL,
    -- המספר המוצג, ספרות בלבד (9725...) — לתצוגה ולגיבוי הניתוב
    "display_phone"          VARCHAR(20)  NOT NULL,
    "verified_name"          VARCHAR(120),
    -- ‎**ה-business token של המתווך — NULL אחרי ניתוק, בכוונה.**
    --
    -- הניתוק מוחק את הסוד ומשאיר את השורה: הסטטוס והסיבה הם מידע
    -- שהמשרד צריך לראות. עמודת חובה הייתה כופה בחירה בין החזקת סוד
    -- חי אחרי ניתוק לבין מחיקת כל המטא-דאטה (ביקורת Codex על התכנון).
    "access_token_encrypted" TEXT,
    -- pending_history | connected | payment_required | disconnected | error
    "status"                 VARCHAR(20)  NOT NULL DEFAULT 'pending_history',
    "history_shared"         BOOLEAN      NOT NULL DEFAULT false,
    "history_synced_through" TIMESTAMP(3),
    -- בריאות הקו כפי ש-Meta מדווחת עליה ב-account_update
    "quality_rating"         VARCHAR(10),
    "messaging_tier"         VARCHAR(20),
    "connected_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at"        TIMESTAMP(3),
    "disconnect_reason"      VARCHAR(40),
    "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_business_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_business_connections_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- קו אחד של Meta שייך לחיבור אחד. **חלקי על `disconnected_at`**: משרד
-- שניתק וחיבר מחדש את אותו מספר חייב להצליח, וההיסטוריה של הניתוק
-- הקודם נשארת לצידו.
CREATE UNIQUE INDEX "whatsapp_business_connections_active_line_key"
  ON "whatsapp_business_connections"("phone_number_id") WHERE "disconnected_at" IS NULL;

-- „מה מחובר אצלי” — השאילתה של מסך ההגדרות. משרד יכול להחזיק כמה
-- קווים (סניפים), ולכן `tenant_id` אינו ייחודי.
CREATE INDEX "whatsapp_business_connections_tenant_idx"
  ON "whatsapp_business_connections"("tenant_id");

-- גיבוי הניתוב: מטען ישן של Meta נושא לפעמים רק את המספר המוצג
CREATE INDEX "whatsapp_business_connections_display_phone_idx"
  ON "whatsapp_business_connections"("display_phone");

GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_business_connections" TO metavchim_app;

-- ‎**מצב שיחת לקוח על קו של משרד.**
--
-- שתי עובדות שאין להן מקום אחר: מתי הלקוח כתב לאחרונה (חלון 24
-- השעות של Meta), והאם המתווך ענה ידנית מהטלפון — ואז הבוט חייב
-- לשתוק. בלי השורה הזו הבוט היה נכנס לדבר בתוך שיחה שאדם כבר מנהל.
--
-- ‎**תחת RLS מלא**, בניגוד לטבלה שמעליה: כאן אין שאלת ניתוב — הדייר
-- כבר ידוע מהחיבור — ויש נתוני לקוחות קצה.
CREATE TABLE "whatsapp_conversations" (
    "id"               CHAR(26)     NOT NULL,
    "tenant_id"        CHAR(26)     NOT NULL,
    "connection_id"    CHAR(26)     NOT NULL,
    "contact_id"       CHAR(26)     NOT NULL,
    -- פתיחת חלון 24 השעות — ההודעה הנכנסת האחרונה מהלקוח
    "last_inbound_at"  TIMESTAMP(3),
    -- המתווך ענה ידנית מהאפליקציה ⇒ הבוט שותק עד כאן
    "bot_paused_until" TIMESTAMP(3),
    -- שלב תסריט הבוט ומה שנאסף עד כה
    "bot_state"        JSONB        NOT NULL DEFAULT '{}',
    -- הלקוח ביקש הסרה — אין פנייה יזומה אליו לעולם
    "opted_out_at"     TIMESTAMP(3),
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_conversations_connection_id_fkey"
      FOREIGN KEY ("connection_id") REFERENCES "whatsapp_business_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "whatsapp_conversations_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- שיחה אחת לכל צמד קו-לקוח. זה גם מה שהופך את הקליטה לאידמפוטנטית
-- מול שתי הודעות שנוחתות במקביל.
CREATE UNIQUE INDEX "whatsapp_conversations_line_contact_key"
  ON "whatsapp_conversations"("connection_id", "contact_id");

CREATE INDEX "whatsapp_conversations_tenant_contact_idx"
  ON "whatsapp_conversations"("tenant_id", "contact_id");

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON whatsapp_conversations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_conversations" TO metavchim_app;

-- היסטוריה מיובאת ואזכור איש קשר על הודעה.
--
-- ‎**היסטוריה אינה `interactions`**: האילוץ `interaction_exactly_one_parent`
-- מחייב ליד או קונה לכל שורה, ולהודעה שיובאה מסנכרון אין אף אחד
-- מהם — היא שייכת לאיש הקשר (ביקורת Codex על התכנון). `messages`
-- כבר נושא `contact_id`, ולכן הייבוא נוחת שם עם `provider` משלו.
-- השליפה לפי איש קשר וזמן כבר מכוסה באינדקס הקיים
-- `messages_tenant_id_contact_id_created_at_idx`.
COMMENT ON COLUMN "messages"."provider" IS
  'walink | cloud_api | coexistence_api | coexistence_echo | coexistence_history';
