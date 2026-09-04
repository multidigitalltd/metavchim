-- ‎**המנטור האישי — יעדים, סיכומים ושיחה (docs/13).**
--
-- שלוש טבלאות, וכולן **של המשתמש** ולא של המשרד: היעד הוא מה
-- שהמתווך ביקש מעצמו, הסיכום הוא מה שהמנטור אמר לו, והשיחה היא
-- ביניהם. `tenant_id` על כל שורה בגלל RLS (הפוליסה אינה יכולה
-- להצטרף ל-`users`), ו-`user_id` הוא חלק מכל שאילתה ב-API — מנהל
-- רואה מספרים בדוח הסוכנים, לא את הסיכום של הסוכן.
--
-- ‎**למה `ended_at` ולא מחיקה של יעד.** הסיכומים שכבר נאמרו מצטטים
-- את היעד („5 הצעות בשבוע: הושג”). יעד שנמחק היה הופך אותם למשפטים
-- על דבר שלא היה. יעד שהופסק נשאר, עם התאריך.
--
-- ‎**למה הסיכום נשמר ולא מחושב מחדש.** הוא נבנה בוורקר במוצאי שבת
-- מנתונים שמשתנים אחר כך (סיור שתועד באיחור), וההודעה שנשלחה
-- לפעמון ולוואטסאפ חייבת להיות זהה למה שהמסך מציג. ייחודיות על
-- ‎(דייר, משתמש, תחילת שבוע) היא האידמפוטנטיות: ריצה כפולה של
-- הוורקר אינה שולחת פעמיים.
--
-- ‎**מחיקת משתמש גוררת את שלו** (`ON DELETE CASCADE`), כמו בתזכורות
-- ההפעלה: יעד בלי בעלים אינו יעד.
CREATE TABLE "mentor_goals" (
  "id"         CHAR(26)     PRIMARY KEY,
  "tenant_id"  CHAR(26)     NOT NULL,
  "user_id"    CHAR(26)     NOT NULL,
  -- MENTOR_GOAL_METRICS ב-shared — הרשימה הסגורה נאכפת ב-Zod
  "metric"     VARCHAR(30)  NOT NULL,
  -- week | month
  "period"     VARCHAR(10)  NOT NULL,
  "target"     INTEGER      NOT NULL,
  -- ה„למה” של המתווך — מצוטט כשקשה
  "why"        VARCHAR(200),
  -- כוונת יישום: „כש… אז…”
  "intention"  VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = פעיל. חותמת = הופסק, ונשאר להיסטוריה
  "ended_at"   TIMESTAMP(3),
  CONSTRAINT "mentor_goals_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "mentor_goals_tenant_id_user_id_ended_at_idx"
  ON "mentor_goals"("tenant_id", "user_id", "ended_at");

CREATE TABLE "mentor_reviews" (
  "id"                  CHAR(26)      PRIMARY KEY,
  "tenant_id"           CHAR(26)      NOT NULL,
  "user_id"             CHAR(26)      NOT NULL,
  -- ראשון 00:00 שעון ישראל, כ-UTC — אותו גבול של `mentorPeriodRange`
  "week_start"          TIMESTAMP(3)  NOT NULL,
  -- celebrate | steady | encourage
  "mood"                VARCHAR(20)   NOT NULL,
  "headline"            VARCHAR(200)  NOT NULL,
  -- הפסקאות, הבקשה לשבוע הבא והשאלה — כפי שנאמרו
  "body"                JSONB         NOT NULL,
  -- מה שהמתווך ענה לשאלת הרפלקציה; NULL = טרם ענה
  "reflection_answer"   VARCHAR(1000),
  "answered_at"         TIMESTAMP(3),
  "created_at"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mentor_reviews_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mentor_reviews_tenant_id_user_id_week_start_key"
  ON "mentor_reviews"("tenant_id", "user_id", "week_start");

-- השיחה עם המנטור — תור אחר תור, של המשתמש בלבד. ההקשר לשיחה נבנה
-- מהתורים האחרונים ומהיעדים והסיכומים; אין כאן נתוני לקוחות.
CREATE TABLE "mentor_messages" (
  "id"         CHAR(26)      PRIMARY KEY,
  "tenant_id"  CHAR(26)      NOT NULL,
  "user_id"    CHAR(26)      NOT NULL,
  -- user | mentor
  "role"       VARCHAR(10)   NOT NULL,
  "text"       VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mentor_messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "mentor_messages_tenant_id_user_id_created_at_idx"
  ON "mentor_messages"("tenant_id", "user_id", "created_at");

-- הצלחה שנאמרת בשמה — עסקה שנסגרה, בלעדיות שנחתמה, קונה שאמר
-- „מעוניין”, עסקת שת"פ. נרשמת ברגע האירוע (ולא נגזרת אחר כך
-- מ-`updated_at` של הנכס, שמשתנה בכל עריכה), עם מי שעשה אותה —
-- לנכס אין שדה „סוכן”, ומי שסימן „נמכר” הוא מי שסגר. ייחודיות על
-- ‎(דייר, סוג, ישות) — אותה עסקה אינה נחגגת פעמיים.
CREATE TABLE "mentor_wins" (
  "id"          CHAR(26)     PRIMARY KEY,
  "tenant_id"   CHAR(26)     NOT NULL,
  "user_id"     CHAR(26)     NOT NULL,
  -- deal_closed | exclusivity_signed | offer_interested | coop_deal
  "kind"        VARCHAR(30)  NOT NULL,
  "entity_type" VARCHAR(40)  NOT NULL,
  "entity_id"   CHAR(26)     NOT NULL,
  -- כותרת הנכס — בלי שם הלקוח
  "title"       VARCHAR(200) NOT NULL,
  "happened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mentor_wins_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mentor_wins_tenant_id_kind_entity_id_key"
  ON "mentor_wins"("tenant_id", "kind", "entity_id");
CREATE INDEX "mentor_wins_tenant_id_user_id_happened_at_idx"
  ON "mentor_wins"("tenant_id", "user_id", "happened_at");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE mentor_wins ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_wins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_wins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mentor_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_goals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mentor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_reviews
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mentor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_wins TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_goals TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_reviews TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_messages TO metavchim_app;
