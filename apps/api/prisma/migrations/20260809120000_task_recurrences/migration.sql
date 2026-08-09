-- משימות אוטומטיות קבועות — ברמת המשרד.
--
-- כל משרד עובד בקצב אחר: אחד עושה סבב טלפונים לכל הקונים בימי ראשון,
-- אחר מעדכן בעלי נכסים בראשון לחודש. עד כה מי שרצה כזה דבר היה צריך
-- לזכור אותו בעצמו — וזה בדיוק מה שנופל ברגע שיש לחץ.
--
-- הכלל שייך למשרד, המשימות שנוצרות ממנו שייכות לסוכן.
CREATE TABLE task_recurrences (
  id           CHAR(26)     PRIMARY KEY,
  tenant_id    CHAR(26)     NOT NULL,
  title        VARCHAR(200) NOT NULL,
  notes        VARCHAR(2000),
  -- daily | weekly | monthly
  frequency    VARCHAR(10)  NOT NULL,
  -- ימי שבוע למופע שבועי: 0 (ראשון) עד 6. ריק = פעם בשבוע.
  weekdays     SMALLINT[]   NOT NULL DEFAULT '{}',
  -- יום בחודש למופע חודשי. 31 נופל ליום האחרון בחודש קצר ולא מדלג.
  day_of_month SMALLINT,
  hour         SMALLINT     NOT NULL DEFAULT 9,
  minute       SMALLINT     NOT NULL DEFAULT 0,
  -- למי המשימה נוצרת. NULL = לכל סוכן פעיל במשרד, כל אחד מקבל משלו.
  assigned_to_user_id CHAR(26),
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  -- המופע האחרון שנוצר בפועל. NULL = הכלל טרם רץ, והמופע הראשון
  -- שלו נמדד מרגע היצירה ולא רטרואקטיבית.
  last_run_at  TIMESTAMP(3),
  created_by   CHAR(26),
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- הסורק עובר על כללים פעילים בכל הדיירים; האינדקס הוא עליו.
CREATE INDEX task_recurrences_active_idx ON task_recurrences (is_active, last_run_at);
CREATE INDEX task_recurrences_tenant_idx ON task_recurrences (tenant_id);

ALTER TABLE task_recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_recurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_recurrences
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
