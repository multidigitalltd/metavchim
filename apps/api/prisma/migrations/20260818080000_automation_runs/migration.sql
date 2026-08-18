-- ספר הריצות של האוטומציות המותאמות — מפתח האי-כפילות.
--
-- `jobId` ב-BullMQ מונע **הכנסה** כפולה לתור, אבל אינו הופך את
-- העיבוד לחד-פעמי: Job שנתקע (worker שמת אחרי ה-commit ולפני
-- ה-ack) נמסר שוב, והכלל רץ פעם שנייה. משימה מקבלת ULID חדש, ואין
-- שום דבר שמונע כפילות — כלומר המשרד מקבל שתי משימות זהות על אותו
-- אירוע, וזה בדיוק סוג הרעש שגורם לכבות אוטומציות (ביקורת Codex).
--
-- השורה כאן נכתבת **לפני** הפעולה ובאותה טרנזקציה. התנגשות על
-- המפתח הראשי פירושה „הכלל הזה כבר רץ על האירוע הזה”, והריצה
-- מדולגת. הטרנזקציה היא מה שהופך את זה לאטומי: או שהשורה והמשימה
-- נכתבו יחד, או ששתיהן לא.
CREATE TABLE "automation_runs" (
  "rule_id"    CHAR(26) NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
  -- מזהה האירוע ב-outbox. לא FK: אירועים ישנים נמחקים בתחזוקה,
  -- והספר צריך לשרוד אותם.
  "event_id"   CHAR(26) NOT NULL,
  "tenant_id"  CHAR(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("rule_id", "event_id")
);

-- ניקוי תקופתי יסרוק לפי גיל; בלי אינדקס הוא היה סורק את כל הטבלה.
CREATE INDEX "automation_runs_created_idx" ON "automation_runs" ("created_at");

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_runs"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
