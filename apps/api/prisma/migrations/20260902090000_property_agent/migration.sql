-- הסוכן המטפל בנכס.
--
-- העמודה מתעדת ואינה מסתירה: היא אינה נוגעת בפוליסות ה-RLS, ולכן
-- נכסים נשארים גלויים לכל המשרד בדיוק כפי שהיו. NULL = נכס שקדם
-- לעמודה או שלא שויך, והמסך אומר "לא משויך" במקום לנחש.
ALTER TABLE "properties" ADD COLUMN "agent_user_id" CHAR(26);

CREATE INDEX "properties_tenant_id_agent_user_id_idx"
  ON "properties" ("tenant_id", "agent_user_id");
