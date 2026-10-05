-- ‎**מנוע המסלולים — שלב א׳.**
--
-- ‏שלוש טבלאות: ההגדרות שנערכות במסך, מי נמצא במסלול, ומה נשלח לו.
-- ‏המנוע עצמו יושב בקוד; כאן רק מה שהוא קורא וכותב.
--
-- ‎**שום דבר לא יוצא מהמיגרציה הזאת.** כל השלבים נזרעים כבויים
-- ‏(`enabled = false`) ובלי נוסחים, כי הנוסחים עוברים אישור לפני
-- ‏שהם נכנסים. מה שנזרע הוא **המבנה** — עיתוי, קהל וערוצים — כדי
-- ‏שהמסך יהיה מלא מהרגע הראשון ולא יידרש למישהו להמציא אותו מחדש.

-- ────────────────────────────  ההגדרות  ────────────────────────────
--
-- ‏טבלה של הפלטפורמה ולא של דייר: אלה ההגדרות שלנו על הדיוור שלנו,
-- ‏כמו `platform_settings`. אין בה `tenant_id` ולכן אין לה RLS.
CREATE TABLE "funnel_stages" (
    "id" CHAR(26) NOT NULL,
    -- conversion | dunning
    "track" VARCHAR(20) NOT NULL,
    -- ‏מזהה יציב. הוא מה שנרשם ביומן ההודעות, ולכן שינוי שלו מוחק
    -- ‏את הזיכרון של „מה כבר נשלח” והשלב יוצא שוב לכולם.
    "key" VARCHAR(60) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    -- funnel | trial | payment — ראו logic/funnel.ts
    "clock" VARCHAR(20) NOT NULL,
    -- ‏שלילי = לפני העוגן. `trial` עם `-2` הוא „יומיים לפני התפוגה”.
    "offset_days" INTEGER NOT NULL,
    -- ‏כל התנאים חייבים להתקיים. ריק = כולם.
    "audience" TEXT[] NOT NULL DEFAULT '{}',
    "channels" TEXT[] NOT NULL DEFAULT '{}',
    -- ‏נזרע כבוי. נדלק בשלב ד׳/ה׳, אחרי שהנוסחים אושרו.
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_subject" VARCHAR(200),
    "email_heading" VARCHAR(200),
    -- ‏פסקאות מופרדות בשורה ריקה — אותו מבנה של `EmailContent`.
    "email_body" TEXT,
    -- ‏שם התבנית כפי שנרשמה ב-WhatsApp Manager. ריק = טרם אושרה.
    "whatsapp_template" VARCHAR(120),
    "whatsapp_language" VARCHAR(10) NOT NULL DEFAULT 'he',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "funnel_stages_pkey" PRIMARY KEY ("id")
);

-- ‏מפתח ייחודי בתוך המסלול — שני שלבים באותו שם היו הופכים את
-- ‏היומן לדו-משמעי, ואז „כבר נשלח” היה נכון לאחד ושגוי לשני.
CREATE UNIQUE INDEX "funnel_stages_track_key_key" ON "funnel_stages"("track", "key");
CREATE INDEX "funnel_stages_track_sort_order_idx" ON "funnel_stages"("track", "sort_order");

-- ────────────────────────────  מי במסלול  ────────────────────────────
--
-- ‎`started_at` הוא היום 0 של המשרד — זה השדה שמממש את „כל משרד
-- ‏לאט לאט מהיום שהתחיל המשפך”.
CREATE TABLE "funnel_enrollments" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "track" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    -- paid | completed | opted_out | resolved
    "ended_reason" VARCHAR(20),
    -- ‏אכיפת המרווח המזערי בין הודעות, בלי לסרוק את היומן בכל סבב.
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "funnel_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "funnel_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ‎**רישום חי אחד לכל מסלול, ולא אחד לתמיד.**
--
-- ‏המשפך קורה פעם אחת, אבל גבייה שנכשלת יכולה לקרות שוב בעוד חצי
-- ‏שנה — ואז זה מסלול חדש עם יום 0 חדש. אילוץ „שורה אחת למשרד”
-- ‏היה חוסם את הפעם השנייה; חלקי על `ended_at IS NULL` מתיר
-- ‏היסטוריה ומונע כפילות במקביל.
CREATE UNIQUE INDEX "funnel_enrollments_tenant_id_track_live_key"
  ON "funnel_enrollments"("tenant_id", "track")
  WHERE "ended_at" IS NULL;
CREATE INDEX "funnel_enrollments_track_started_at_idx"
  ON "funnel_enrollments"("track", "started_at");

-- ‎**המשרד של הרישום — כמפתח שאפשר להצביע עליו.**
--
-- ‏‎`id` הוא כבר ייחודי, ולכן האילוץ הזה אינו מוסיף שום הגבלה על
-- ‏הנתונים. תפקידו היחיד הוא לאפשר ל-`funnel_messages` להצביע על
-- ‏**הצמד** ‎`(id, tenant_id)`, וכך לא תיתכן הודעה שמשויכת לרישום
-- ‏של משרד אחד ונושאת את מזהה המשרד של אחר.
ALTER TABLE "funnel_enrollments"
  ADD CONSTRAINT "funnel_enrollments_id_tenant_id_key" UNIQUE ("id", "tenant_id");

-- ────────────────────────────  מה נשלח  ────────────────────────────
--
-- ‏שורה לכל נמען ולכל ערוץ — לא לכל הודעה. „נשלח למשרד” אינו מדיד:
-- ‏למשרד יש שני בעלים, אחד פתח והשני לא, ושורה אחת לשניהם הייתה
-- ‏מוחקת בדיוק את מה שהמסך אמור להראות.
CREATE TABLE "funnel_messages" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "enrollment_id" CHAR(26) NOT NULL,
    "track" VARCHAR(20) NOT NULL,
    "stage_key" VARCHAR(60) NOT NULL,
    -- ‎**בלי מפתח זר אל `users`, בכוונה.**
    --
    -- ‏אותו נימוק של `support_tickets.user_id`: מי שהוסר מהמשרד עדיין
    -- ‏קיבל את ההודעה, והיומן צריך להמשיך לומר את זה. מחיקת המשרד
    -- ‏מפילה את השורה דרך `tenant_id`.
    "user_id" CHAR(26) NOT NULL,
    -- ‏עותק של הכתובת/המספר כפי שהיו ברגע השליחה. משתמש שהחליף מייל
    -- ‏אינו משנה למפרע לאן ההודעה ההיא הלכה.
    "destination" VARCHAR(254) NOT NULL,
    -- email | whatsapp
    "channel" VARCHAR(20) NOT NULL,
    -- queued | sent | failed
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    -- ‏הטוקן שבפיקסל הפתיחה ובהפניית ההקלקה. אקראי ולא נגזר מהמזהים:
    -- ‏כתובת שאפשר לנחש היא כתובת שאפשר לזייף בה „נפתח”.
    "token" VARCHAR(64) NOT NULL,
    "provider_message_id" VARCHAR(200),
    "sent_at" TIMESTAMP(3),
    -- ‏אמיתי בוואטסאפ בלבד. במייל נשאר ריק — ראו סעיף המדידה בתוכנית.
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    -- ‏הערכה בלבד: פיקסל שנטען. Apple ו-Gmail טוענים אותו גם בלי קורא.
    "opened_at" TIMESTAMP(3),
    -- ‏המדד האמיתי.
    "clicked_at" TIMESTAMP(3),
    "error" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "funnel_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "funnel_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- ‎**המפתח הוא הצמד, ולא כל עמודה לחוד.**
    --
    -- ‏שני מפתחות זרים נפרדים — `tenant_id` אל `tenants`,
    -- ‏`enrollment_id` אל `funnel_enrollments` — מקבלים כל צירוף
    -- ‏ביניהם: שורה עם הרישום של משרד א׳ ועם `tenant_id` של משרד ב׳
    -- ‏עוברת את שניהם. פוליסת ה-RLS מסננת לפי `tenant_id` בלבד,
    -- ‏ולכן משרד ב׳ היה קורא נמען, יעד ונתוני מסירה של משרד א׳
    -- ‏(ביקורת Codex, P1).
    --
    -- ‏האכיפה כאן ולא בקוד: „הקוד תמיד כותב את שניהם נכון” הוא
    -- ‏בדיוק סוג ההנחה שנשברת בכתיבה השנייה, ובטבלה שכל תפקיד
    -- ‏ה-RLS עליה הוא בידוד בין משרדים.
    CONSTRAINT "funnel_messages_enrollment_id_fkey"
      FOREIGN KEY ("enrollment_id", "tenant_id")
      REFERENCES "funnel_enrollments"("id", "tenant_id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

-- ‎**„פעם אחת” נאכף במסד, לא בקוד.**
--
-- ‏זה הלקח של ההמרה בנכסים לגיוס: „קרא, ראה שלא נשלח, שלח” הוא
-- ‏מרוץ שמסתיים בשתי הודעות זהות לאותו אדם. האינדקס הופך את
-- ‏השנייה לבלתי אפשרית — גם כששני עותקים של השירות רצים במקביל.
CREATE UNIQUE INDEX "funnel_messages_enrollment_stage_user_channel_key"
  ON "funnel_messages"("enrollment_id", "stage_key", "user_id", "channel");
-- ‏חיפוש הטוקן — הפיקסל וההפניה מגיעים עם זה ותו לא.
CREATE UNIQUE INDEX "funnel_messages_token_key" ON "funnel_messages"("token");
-- ‏ההיסטוריה של משרד יחיד במסך
CREATE INDEX "funnel_messages_tenant_id_created_at_idx"
  ON "funnel_messages"("tenant_id", "created_at" DESC);
-- ‏תור המסך: מה יצא במסלול, מהחדש לישן
CREATE INDEX "funnel_messages_track_created_at_idx"
  ON "funnel_messages"("track", "created_at" DESC);

-- ────────────────────────────  בידוד  ────────────────────────────
--
-- ‏שתי הטבלאות נושאות `tenant_id` ולכן הן תחת RLS, בדיוק כמו כל
-- ‏טבלה אחרת. הפוליסה השנייה היא אותה תבנית של `support_tickets`:
-- ‏מנהל הפלטפורמה קורא חוצה-דיירים כי בלי זה המסך „מי קיבל ומי
-- ‏פתח” אינו קיים, והדגל נדלק אך ורק ב-`withFunnelAdmin` מאחורי
-- ‏`PlatformAdminGuard`.
ALTER TABLE funnel_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON funnel_enrollments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY funnel_admin ON funnel_enrollments
  USING (current_setting('app.funnel_admin', true) = 'on')
  WITH CHECK (current_setting('app.funnel_admin', true) = 'on');

ALTER TABLE funnel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON funnel_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY funnel_admin ON funnel_messages
  USING (current_setting('app.funnel_admin', true) = 'on')
  WITH CHECK (current_setting('app.funnel_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "funnel_stages" TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "funnel_enrollments" TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "funnel_messages" TO metavchim_app;

-- ────────────────────────────  ברירות המחדל  ────────────────────────────
--
-- ‏ארבעה-עשר שלבים: שבעה על שעון המשפך, שלושה על שעון הניסיון,
-- ‏וארבעה בגבייה. כולם כבויים ובלי נוסח.
--
-- ‏שלוש הודעות המועד אינן נושאות תנאי „הניסיון בתוקף”, ובכוונה:
-- ‏`closing` יוצאת ביום התפוגה עצמו ו-`last_call` שבוע אחריה, ולכן
-- ‏תנאי כזה היה חוסם אותן תמיד. מה שמגן על משרד שהניסיון שלו פג
-- ‏מזמן הוא **תקרת הפיגור** של שעון הניסיון — יומיים — שמוחקת אותן
-- ‏לגמרי עבורו. מנגנון אחד, ולא שניים שיכולים לסתור.
INSERT INTO "funnel_stages"
  ("id", "track", "key", "title", "clock", "offset_days", "audience", "channels", "sort_order", "updated_at")
VALUES
  ('01M1TVQ7WCHGGPBAJTQXNHGF4H', 'conversion', 'd0_first_action',  'יום 0 — פעולה ראשונה אחת',      'funnel',   0, '{always}',                  '{email,whatsapp}',  0, CURRENT_TIMESTAMP),
  ('01M1TVQ7WEV72Y252XEZ2XWHZ4', 'conversion', 'd1_empty_screen',  'יום 1 — להסיר את המסך הריק',    'funnel',   1, '{no_properties}',           '{email,whatsapp}', 10, CURRENT_TIMESTAMP),
  ('01M1TVQ7WEPQD5SBYV8JG4XPFP', 'conversion', 'd3_one_feature',   'יום 3 — פיצ׳ר אחד, שלהם',       'funnel',   3, '{next_step_pending}',       '{email,whatsapp}', 20, CURRENT_TIMESTAMP),
  ('01M1TVQ7WE4HYKSH346RVY66JM', 'conversion', 'd5_intro_call',    'יום 5 — שיחת היכרות 20 דקות',   'funnel',   5, '{always}',                  '{email,whatsapp}', 30, CURRENT_TIMESTAMP),
  ('01M1TVQ7WEGDE7RFMEMRDKKXT3', 'conversion', 'd8_what_we_did',   'יום 8 — מה המערכת עשתה להם',    'funnel',   8, '{has_data}',                '{email,whatsapp}', 40, CURRENT_TIMESTAMP),
  ('01M1TVQ7WEJFB6S3Q06K33ABGK', 'conversion', 'd11_before_money', 'יום 11 — הדחיפה לפני הכסף',     'funnel',  11, '{feature_unused}',          '{email,whatsapp}', 50, CURRENT_TIMESTAMP),
  ('01M1TVQ7WE6VN9MBJVXNG2978K', 'conversion', 'd17_data_waiting', 'יום 17 — הנתונים שלכם ממתינים', 'funnel',  17, '{no_card,has_data}',        '{email,whatsapp}', 60, CURRENT_TIMESTAMP),
  ('01M1TVQ7WE9FY31SPXTW6ZNJ2M', 'conversion', 'trial_heads_up',   'יומיים לפני — נשארו יומיים',    'trial',   -2, '{no_card}',                 '{email,whatsapp}', 70, CURRENT_TIMESTAMP),
  ('01M1TVQ7WENHH76R71YT6Q3N57', 'conversion', 'trial_closing',    'ביום התפוגה — מה בדיוק ננעל',   'trial',    0, '{no_card}',                 '{email,whatsapp}', 80, CURRENT_TIMESTAMP),
  ('01M1TVQ7WFEQC5ZYS87X0E87AK', 'conversion', 'trial_last_call',  'שבוע אחרי — אחרונה, ואז שקט',   'trial',    7, '{no_card}',                 '{email,whatsapp}', 90, CURRENT_TIMESTAMP),
  ('01M1TVQ7WF1JXRHY1AG5SGGK59', 'dunning',    'pay_failed',       'מיד — החיוב לא עבר',            'payment',  0, '{charge_still_failing}',    '{email,whatsapp}',  0, CURRENT_TIMESTAMP),
  ('01M1TVQ7WFYQBCSQSTCSQA1295', 'dunning',    'pay_reminder',     'יום אחרי — תזכורת קצרה',        'payment',  1, '{charge_still_failing}',    '{email,whatsapp}', 10, CURRENT_TIMESTAMP),
  ('01M1TVQ7WFWV5JN6044FVF9ZYJ', 'dunning',    'pay_last_day',     'יומיים אחרי — מחר זה נסגר',     'payment',  2, '{charge_still_failing}',    '{email,whatsapp}', 20, CURRENT_TIMESTAMP),
  ('01M1TVQ7WFX8STF320VQZJD1RN', 'dunning',    'pay_locked',       'הנעילה — החשבון נעול',          'payment',  3, '{charge_still_failing}',    '{email,whatsapp}', 30, CURRENT_TIMESTAMP);
