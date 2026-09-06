-- ‎**תרגול שיחה עם המנטור (docs/14 §7.3).**
--
-- תרגול אחד = שורה: התרחיש, התורים (המתווך והדמות), והמשוב בסוף.
-- לא ב-`mentor_messages`: השיחה עם המנטור היא זיכרון שנכנס לפרומפט
-- של השיחה הבאה, ותרגול שבו „המנטור” הוא מוכר כועס היה מזהם אותו.
-- של המשתמש, כמו כל טבלה של המנטור.
CREATE TABLE "mentor_practices" (
  "id"          CHAR(26)      PRIMARY KEY,
  "tenant_id"   CHAR(26)      NOT NULL,
  "user_id"     CHAR(26)      NOT NULL,
  -- מתוך PRACTICE_SCENARIOS ב-shared
  "scenario"    VARCHAR(40)   NOT NULL,
  -- [{role: agent|counterpart, text}] — PracticeTurn
  "turns"       JSONB         NOT NULL DEFAULT '[]'::jsonb,
  -- כמה תורים של המתווך — למכסה היומית ולתקרה של תרגול
  "agent_turns" SMALLINT      NOT NULL DEFAULT 0,
  -- MentorPracticeFeedback — NULL עד שביקשו משוב
  "feedback"    JSONB,
  "score"       SMALLINT,
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"    TIMESTAMP(3),
  CONSTRAINT "mentor_practices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "mentor_practices_tenant_id_user_id_created_at_idx"
  ON "mentor_practices"("tenant_id", "user_id", "created_at");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE mentor_practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_practices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mentor_practices
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_practices TO metavchim_app;
