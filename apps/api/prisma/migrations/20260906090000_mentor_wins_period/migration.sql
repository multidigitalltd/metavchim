-- ‎**הצלחה לכל תקופה — יעד שהושג נחגג בכל שבוע שהושג בו (docs/14 §3).**
--
-- ‎`mentor_wins` נעלה הצלחה לפי (משרד, סוג, ישות): עסקה נסגרת פעם
-- אחת. יעד שבועי מושג שבוע אחרי שבוע, ואותו יעד (אותה שורה ב-
-- ‎`mentor_goals`) הוא חגיגה חדשה בכל תקופה. ‎`period_key` הוא תחילת
-- התקופה („2026-09-06”), וריק לאירועים החד-פעמיים — כך הנעילה הישנה
-- נשמרת בדיוק להם.
ALTER TABLE "mentor_wins"
  ADD COLUMN "period_key" VARCHAR(10) NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "mentor_wins_tenant_id_kind_entity_id_key";
CREATE UNIQUE INDEX "mentor_wins_tenant_id_kind_entity_id_period_key_key"
  ON "mentor_wins"("tenant_id", "kind", "entity_id", "period_key");
