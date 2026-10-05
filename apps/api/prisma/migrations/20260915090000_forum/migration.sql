-- ‎**הפורום המקצועי — שאלות, תגובות, מדריך בעלי מקצוע וכלים (docs/16).**
--
-- ‎**למה הטבלאות האלה מחוץ ל-RLS, ובלי `tenant_id` כלל.**
--
-- הפורום הוא קהילה **בין** משרדים: שאלה שנשאלת בתל אביב נקראת
-- בחיפה, וזה כל הטעם. אין כאן נתון של משרד — לא לקוח, לא נכס, לא
-- טלפון — ולכן אין כאן דייר לבודד. זהו אותו מעמד של `support_threads`
-- ו-`platform_credit_ledger`: תוכן של הפלטפורמה, לא של דייר.
--
-- ‎**ולמה זו החלטה ולא קיצור דרך.** האנונימיות היא הפיצ'ר של הפורום
-- (ראו `forum/page.tsx` הישן): שאלה מקצועית מביכה נשאלת רק כשאיש אינו
-- יכול לגלות מי שאל. עמודת `tenant_id` על שרשור אנונימי הייתה מצביעה
-- על המשרד השואל בכל שאילתה, בכל גיבוי ובכל מסך תמיכה — ופוליסת RLS
-- שמסתירה אותה מהמסך אינה מסתירה אותה מהמסד. לכן שרשור או תגובה
-- אנונימיים **אינם נושאים מזהה מחבר בכלל**: לא משתמש, לא משרד.
--
-- ‎**מה כן נשמר — `author_key`.** חתם HMAC של מזהה המשתמש עם מפתח
-- השרת (`CryptoService.forumAuthorKey`). הוא מספיק כדי שהמחבר יוכל
-- לערוך ולמחוק את שלו, כדי לסמן „השואל/ת” על תגובותיו בשרשור שלו,
-- וכדי להגביל קצב — ואינו מספיק כדי לגלות מי הוא ממבט על הטבלה.
-- חשיפה של מחבר אנונימי בפנייה משפטית היא פעולה מכוונת (חישוב החתם
-- למשתמש חשוד ע"י מנהל הפלטפורמה), לא עמודה שקוראים.
--
-- ‎**ואיך מגיעה תשובה למי שאין לו שם.** מעקב הוא שורה `(שרשור, משתמש)`,
-- וסטור כזה על שרשור אנונימי היה מצביע על המחבר בלי לחשב דבר. לכן
-- מחבר אנונימי אינו „עוקב”: השורה שלו נושאת `author_ref` — מזהי
-- המשרד והמשתמש **מוצפנים** במפתח הנתונים של השרת (אותה הצפנה של
-- טלפון ואימייל בכרטיסי הלקוחות), ו-`author_notify` — האם הוא רוצה
-- לשמוע על תגובות. מה שקורא את הטבלה בלי המפתח רואה טקסט מוצפן.
--
-- ‎**מחבר מזוהה** נושא גם `author_user_id` (לשם) ו-`author_tenant_id`
-- (לתג המשרד), שניהם `ON DELETE SET NULL`: משרד שנמחק לוקח איתו את
-- המשתמשים, והתוכן נשאר בקהילה כ„משתמש שנמחק” — כמו בכל פורום
-- מקצועי. השאלות והתשובות הן ידע משותף, לא נתון של המשרד.
--
-- ‎**דירוג בעלי מקצוע** — אותו עיקרון: `rater_key` לייחודיות (דירוג
-- אחד לכל מדרג), ו-`user_id` רק כשהמדרג בחר להזדהות.

-- ============================================================
-- שרשורים
-- ============================================================
CREATE TABLE "forum_threads" (
  "id"               CHAR(26)      PRIMARY KEY,
  -- question | discussion | tip — FORUM_KINDS ב-shared
  "kind"             VARCHAR(20)   NOT NULL,
  -- FORUM_TOPICS ב-shared
  "topic"            VARCHAR(30)   NOT NULL,
  "title"            VARCHAR(160)  NOT NULL,
  "body"             VARCHAR(6000) NOT NULL,
  "anonymous"        BOOLEAN       NOT NULL DEFAULT false,
  "author_key"       CHAR(64)      NOT NULL,
  -- מחבר אנונימי: מזהי המשרד והמשתמש מוצפנים (AES-GCM), לשליחת תשובות
  "author_ref"       VARCHAR(255),
  "author_notify"    BOOLEAN       NOT NULL DEFAULT true,
  "author_user_id"   CHAR(26),
  "author_tenant_id" CHAR(26),
  -- מונים מוחזקים כאן כדי שרשימה לא תצטרך COUNT לכל שורה
  "reply_count"      INTEGER       NOT NULL DEFAULT 0,
  "score"            INTEGER       NOT NULL DEFAULT 0,
  -- התגובה שהשואל/ת סימן/ה כתשובה; NULL = עדיין פתוח
  "accepted_post_id" CHAR(26),
  "pinned"           BOOLEAN       NOT NULL DEFAULT false,
  "locked"           BOOLEAN       NOT NULL DEFAULT false,
  -- הוסתר ע"י ניהול הפלטפורמה; NULL = גלוי
  "hidden_at"        TIMESTAMP(3),
  "last_activity_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "edited_at"        TIMESTAMP(3),
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "forum_threads_kind_check"
    CHECK ("kind" IN ('question', 'discussion', 'tip')),
  CONSTRAINT "forum_threads_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "forum_threads_author_tenant_id_fkey"
    FOREIGN KEY ("author_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL
);

-- הרשימה הראשית: גלויים, נעוצים קודם, ואז לפי פעילות אחרונה
CREATE INDEX "forum_threads_list_idx"
  ON "forum_threads" ("hidden_at", "pinned", "last_activity_at" DESC);
CREATE INDEX "forum_threads_topic_idx"
  ON "forum_threads" ("topic", "last_activity_at" DESC);
CREATE INDEX "forum_threads_author_key_idx"
  ON "forum_threads" ("author_key", "created_at" DESC);
-- חיפוש: תצורת `simple` — עברית אינה נגזרת, ורק פירוק למילים
-- והורדת רישיות. אותו ביטוי בדיוק חייב להופיע בשאילתה כדי שהאינדקס
-- ישמש; ראו `forum.service.ts`.
CREATE INDEX "forum_threads_search_idx"
  ON "forum_threads" USING GIN (to_tsvector('simple', "title" || ' ' || "body"));

-- ============================================================
-- תגובות — שטוחות, כרונולוגיות; התשובה המקובלת מוצגת ראשונה
-- ============================================================
CREATE TABLE "forum_posts" (
  "id"               CHAR(26)      PRIMARY KEY,
  "thread_id"        CHAR(26)      NOT NULL,
  "body"             VARCHAR(6000) NOT NULL,
  "anonymous"        BOOLEAN       NOT NULL DEFAULT false,
  "author_key"       CHAR(64)      NOT NULL,
  "author_ref"       VARCHAR(255),
  "author_notify"    BOOLEAN       NOT NULL DEFAULT true,
  "author_user_id"   CHAR(26),
  "author_tenant_id" CHAR(26),
  "score"            INTEGER       NOT NULL DEFAULT 0,
  "hidden_at"        TIMESTAMP(3),
  "edited_at"        TIMESTAMP(3),
  "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_posts_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE,
  CONSTRAINT "forum_posts_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "forum_posts_author_tenant_id_fkey"
    FOREIGN KEY ("author_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL
);

CREATE INDEX "forum_posts_thread_id_created_at_idx"
  ON "forum_posts" ("thread_id", "created_at");
CREATE INDEX "forum_posts_author_key_idx"
  ON "forum_posts" ("author_key", "created_at" DESC);
-- החיפוש מכסה גם תשובות — „בשאלות ובתשובות”, כמו שהמסך מבטיח
CREATE INDEX "forum_posts_search_idx"
  ON "forum_posts" USING GIN (to_tsvector('simple', "body"));

-- ============================================================
-- „מועיל” — הצבעה אחת לכל משתמש על כל פריט. אין הצבעה שלילית:
-- בקהילה מקצועית קטנה „לא מועיל” הופך מהר לחשבון אישי.
-- ============================================================
CREATE TABLE "forum_votes" (
  "id"          CHAR(26)    PRIMARY KEY,
  -- thread | post
  "target_type" VARCHAR(10) NOT NULL,
  "target_id"   CHAR(26)    NOT NULL,
  "user_id"     CHAR(26)    NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_votes_target_type_check"
    CHECK ("target_type" IN ('thread', 'post')),
  CONSTRAINT "forum_votes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "forum_votes_target_user_key"
  ON "forum_votes" ("target_type", "target_id", "user_id");
CREATE INDEX "forum_votes_user_id_idx" ON "forum_votes" ("user_id");

-- ============================================================
-- מעקב אחרי שרשור — שורה = עוקב. מעקב אחרי כל הפורום והערוצים
-- (מייל/תקציר) יושבים ב-`users.preferences.forum`, כמו ההעדפות
-- של הוואטסאפ: העדפה של האדם, לא יחס לשרשור.
-- ============================================================
CREATE TABLE "forum_follows" (
  "id"         CHAR(26)     PRIMARY KEY,
  "thread_id"  CHAR(26)     NOT NULL,
  "user_id"    CHAR(26)     NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_follows_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE,
  CONSTRAINT "forum_follows_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "forum_follows_thread_user_key"
  ON "forum_follows" ("thread_id", "user_id");
CREATE INDEX "forum_follows_user_id_idx" ON "forum_follows" ("user_id");

-- ============================================================
-- המדריך — כלים ובעלי מקצוע בטבלה אחת. הסוג מבדיל; הדירוג משותף.
-- ============================================================
CREATE TABLE "forum_listings" (
  "id"                   CHAR(26)      PRIMARY KEY,
  -- tool | pro
  "kind"                 VARCHAR(10)   NOT NULL,
  -- FORUM_PRO_CATEGORIES / FORUM_TOOL_CATEGORIES לפי הסוג
  "category"             VARCHAR(30)   NOT NULL,
  "name"                 VARCHAR(120)  NOT NULL,
  "description"          VARCHAR(1000) NOT NULL,
  "url"                  VARCHAR(500),
  -- פרטי קשר **עסקיים** של בעל המקצוע — לא של אדם פרטי
  "contact"              VARCHAR(120),
  "area"                 VARCHAR(80),
  "created_by_user_id"   CHAR(26),
  "created_by_tenant_id" CHAR(26),
  -- ממוצע נגזר: sum / count. שני מונים ולא ממוצע צף — ממוצע שמתעדכן
  -- בדלתא צובר שגיאת עיגול; שני שלמים לא.
  "rating_sum"           INTEGER       NOT NULL DEFAULT 0,
  "rating_count"         INTEGER       NOT NULL DEFAULT 0,
  "hidden_at"            TIMESTAMP(3),
  "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "forum_listings_kind_check" CHECK ("kind" IN ('tool', 'pro')),
  CONSTRAINT "forum_listings_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "forum_listings_created_by_tenant_id_fkey"
    FOREIGN KEY ("created_by_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL
);

CREATE INDEX "forum_listings_kind_idx"
  ON "forum_listings" ("kind", "hidden_at", "rating_count" DESC);

-- ============================================================
-- דירוג מניסיון אישי — כוכב עד חמישה, ומשפט. אחד לכל מדרג.
-- ============================================================
CREATE TABLE "forum_ratings" (
  "id"         CHAR(26)     PRIMARY KEY,
  "listing_id" CHAR(26)     NOT NULL,
  "rater_key"  CHAR(64)     NOT NULL,
  -- רק כשהמדרג בחר להזדהות
  "user_id"    CHAR(26),
  "score"      SMALLINT     NOT NULL,
  "comment"    VARCHAR(500),
  "anonymous"  BOOLEAN      NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "forum_ratings_score_range" CHECK ("score" BETWEEN 1 AND 5),
  CONSTRAINT "forum_ratings_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "forum_listings"("id") ON DELETE CASCADE,
  CONSTRAINT "forum_ratings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "forum_ratings_listing_rater_key"
  ON "forum_ratings" ("listing_id", "rater_key");

-- ============================================================
-- דיווחים — תור הניהול של הפלטפורמה. דיווח אחד לכל מדווח על פריט.
-- ============================================================
CREATE TABLE "forum_reports" (
  "id"               CHAR(26)     PRIMARY KEY,
  -- thread | post | listing | rating
  "target_type"      VARCHAR(10)  NOT NULL,
  "target_id"        CHAR(26)     NOT NULL,
  "reporter_user_id" CHAR(26),
  -- FORUM_REPORT_REASONS ב-shared
  "reason"           VARCHAR(20)  NOT NULL,
  "note"             VARCHAR(500),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"      TIMESTAMP(3),
  CONSTRAINT "forum_reports_target_type_check"
    CHECK ("target_type" IN ('thread', 'post', 'listing', 'rating')),
  CONSTRAINT "forum_reports_reporter_user_id_fkey"
    FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "forum_reports_target_reporter_key"
  ON "forum_reports" ("target_type", "target_id", "reporter_user_id");
CREATE INDEX "forum_reports_open_idx"
  ON "forum_reports" ("resolved_at", "created_at" DESC);

-- ============================================================
-- מצב הדיוור — עד איזו התראה נשלח מייל לכל משתמש.
--
-- המייל הוא ערוץ שלישי של אותן שורות ב-`notifications` (אחרי הפעמון
-- והוואטסאפ), ולכן מה שנדרש הוא רק חותמת: „עד כאן נשלח”. טבלה ולא
-- מפתח ב-`preferences`: הסורק כותב אותה בכל סבב, והמשתמש עורך את
-- ההעדפות באותו רגע — כתיבה משותפת לאותו JSON היא מרוץ.
-- ============================================================
CREATE TABLE "forum_mail_state" (
  "user_id"        CHAR(26)     PRIMARY KEY,
  "mailed_through" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_mailed_at" TIMESTAMP(3),
  CONSTRAINT "forum_mail_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

-- מחוץ ל-RLS בכוונה — ראו הכותרת. ההרשאות כמו לכל טבלה.
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_threads TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_posts TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_votes TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_follows TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_listings TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_ratings TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_reports TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_mail_state TO metavchim_app;
