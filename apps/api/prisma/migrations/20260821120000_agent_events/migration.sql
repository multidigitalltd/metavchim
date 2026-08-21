-- יומן משימות הסוכן: כל פירוש וכל ביצוע, משני הערוצים (דפדפן
-- ווואטסאפ). המטרה כפולה — מדידת עלות אמיתית לכל פקודה (צריכת
-- האסימונים כפי ש-Google דיווחה) ודאטה לאימון מודל ייעודי בהמשך.
-- התמלולים מכילים שמות ופרטי לקוחות קצה, ולכן RLS מלא כמו כל
-- טבלת נתוני-דייר.

-- CreateTable
CREATE TABLE "agent_events" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "transcript" VARCHAR(4000),
    "action_id" VARCHAR(40),
    "payload" JSONB NOT NULL,
    "source" VARCHAR(10),
    "model" VARCHAR(60),
    "latency_ms" INTEGER,
    "usage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_events_tenant_id_created_at_idx"
  ON "agent_events"("tenant_id", "created_at");

-- הרישום הוא fire-and-forget, ולכן כתיבה יכולה לנחות אחרי שמחיקת
-- החשבון כבר רצה. ה-FK עם Cascade סוגר את החלון: אחרי שהמשתמשים
-- נמחקו שום אירוע מאוחר אינו יכול להיכתב, ומחיקת משתמש גוררת את
-- האירועים שלו איתה (ביקורת Codex).
ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
