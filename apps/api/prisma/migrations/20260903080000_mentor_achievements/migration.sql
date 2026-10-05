-- שבוע שסוכן סגר בו את היעד, והפידבק של המנהל עליו.
--
-- האילוץ הייחודי (tenant, user, week) הוא לב העניין ולא פרט: הסורק
-- רץ כל יום, ובלי האילוץ סוכן שסגר את השבוע ביום שלישי היה מקבל
-- חגיגה חדשה בכל יום עד יום ראשון. הכתיבה היא ON CONFLICT DO NOTHING,
-- ולכן שתי ריצות במקביל אינן צריכות לקרוא זו את זו.

CREATE TABLE "mentor_achievements" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "week_key" VARCHAR(10) NOT NULL,
    "percent" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "reached_at" TIMESTAMP(3) NOT NULL,
    "feedback_text" VARCHAR(400),
    "feedback_by_user_id" CHAR(26),
    "feedback_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mentor_achievements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mentor_achievements_tenant_id_user_id_week_key_key"
  ON "mentor_achievements"("tenant_id", "user_id", "week_key");
-- „מי סגר ועוד לא קיבל מילה” — מסך המנהל נשען בדיוק על זה
CREATE INDEX "mentor_achievements_tenant_id_feedback_at_reached_at_idx"
  ON "mentor_achievements"("tenant_id", "feedback_at", "reached_at");

-- RLS — בידוד בין משרדים. הבידוד בין סוכנים אינו כאן בכוונה: ההישג
-- הזה *נועד* להיראות בידי ההנהלה, והגישה נשמרת ביכולת (analytics.view)
-- ולא בשורה.
ALTER TABLE mentor_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_achievements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_achievements
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "mentor_achievements" TO metavchim_app;
