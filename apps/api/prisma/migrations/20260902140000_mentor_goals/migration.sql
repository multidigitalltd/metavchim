-- המנטור האישי: יעדים בארבע רמות, וציון ביצוע לכל שבוע.
--
-- שתי טבלאות ולא אחת, כי הן עונות על שתי שאלות שונות: mentor_goals
-- הוא "לאן", ו-mentor_weekly_scores הוא "מה עשיתי בפועל" — ההיסטוריה
-- שעליה נשענת ההשוואה "איפה היית לפני תקופה".

CREATE TABLE "mentor_goals" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "horizon" VARCHAR(10) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "target_agorot" BIGINT NOT NULL,
    "average_commission_agorot" BIGINT,
    "ratios" JSONB NOT NULL DEFAULT '{}',
    "commitment" JSONB NOT NULL DEFAULT '{}',
    "obstacle" VARCHAR(400),
    "if_then_plan" VARCHAR(400),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "achieved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mentor_goals_pkey" PRIMARY KEY ("id")
);

-- יעד אחד לכל רמה לכל תקופה: קביעה חוזרת מעדכנת, לא מכפילה
CREATE UNIQUE INDEX "mentor_goals_tenant_id_user_id_horizon_period_start_key"
  ON "mentor_goals"("tenant_id", "user_id", "horizon", "period_start");
CREATE INDEX "mentor_goals_tenant_id_user_id_horizon_idx"
  ON "mentor_goals"("tenant_id", "user_id", "horizon");

CREATE TABLE "mentor_weekly_scores" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "week_key" VARCHAR(10) NOT NULL,
    "committed" JSONB NOT NULL DEFAULT '{}',
    "actual" JSONB NOT NULL DEFAULT '{}',
    "percent" INTEGER NOT NULL DEFAULT 0,
    "on_track" BOOLEAN NOT NULL DEFAULT false,
    "sent_moments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mentor_weekly_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mentor_weekly_scores_tenant_id_user_id_week_key_key"
  ON "mentor_weekly_scores"("tenant_id", "user_id", "week_key");
CREATE INDEX "mentor_weekly_scores_tenant_id_user_id_week_key_idx"
  ON "mentor_weekly_scores"("tenant_id", "user_id", "week_key");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר.
-- הבידוד בין סוכנים בתוך אותו משרד נעשה בשאילתה (user_id), ולא כאן:
-- app.tenant_id הוא ההקשר היחיד שקיים בחיבור.
ALTER TABLE mentor_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_goals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mentor_weekly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_weekly_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_weekly_scores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- הרשאות תפקיד האפליקציה. ALTER DEFAULT PRIVILEGES שב-
-- infra/postgres/init-app-role.sh מכסה טבלאות חדשות, אבל מסד שהוקם
-- לפניו אינו מכוסה — ובלי ההרשאה ה-RLS אינו מגן על דבר, הוא פשוט
-- הופך את הטבלה לבלתי קריאה לגמרי.
GRANT SELECT, INSERT, UPDATE, DELETE ON "mentor_goals" TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mentor_weekly_scores" TO metavchim_app;
