-- סנכרון יומן Google — דו-כיווני.
--
-- החיבור הוא **למשתמש** ולא למשרד: ליומן של סוכן יש בעלים אחד, וגם
-- אם המשרד מחליט לחבר את כולם — כל אחד מאשר את החשבון שלו. חיבור
-- ברמת המשרד היה מחייב חשבון Google משותף, וזה בדיוק מה שאף משרד
-- לא עושה.
--
-- הטוקן מוצפן באותו מנגנון של אישורי הסליקה. הוא refresh token
-- ארוך-טווח, ומי שמשיג אותו קורא וכותב ביומן הפרטי של הסוכן — לכן
-- הוא לעולם אינו מוחזר ללקוח, גם לא חלקית.
CREATE TABLE google_calendar_links (
  id                     CHAR(26) PRIMARY KEY,
  tenant_id              CHAR(26) NOT NULL,
  user_id                CHAR(26) NOT NULL,
  google_email           VARCHAR(254) NOT NULL,
  -- היומן שאליו כותבים. "primary" הוא היומן הראשי של החשבון.
  calendar_id            VARCHAR(200) NOT NULL DEFAULT 'primary',
  refresh_token_encrypted TEXT NOT NULL,
  -- טוקן הסנכרון המצטבר של Google: הבקשה הבאה מקבלת רק מה שהשתנה
  -- מאז. בלעדיו כל סבב היה מושך את היומן כולו, ו-Google מגביל את זה.
  sync_token             TEXT,
  last_sync_at           TIMESTAMPTZ,
  -- מה קרה בסבב האחרון. מוצג למשתמש: חיבור שנשבר בשקט הוא חיבור
  -- שהמשתמש סומך עליו ואינו עובד.
  last_error             VARCHAR(300),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- חיבור אחד לכל משתמש. חיבור שני של אותו אדם מחליף את הראשון.
CREATE UNIQUE INDEX google_calendar_links_user_key ON google_calendar_links (user_id);
CREATE INDEX google_calendar_links_tenant_idx ON google_calendar_links (tenant_id);

ALTER TABLE google_calendar_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON google_calendar_links
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- מי הבעלים של הפגישה — הסוכן שיומנו מסונכרן איתה.
--
-- created_by קיים כבר, אבל הוא "מי הקליד" ולא "יומן של מי": פגישה
-- שמנהל המשרד קובע לסוכן צריכה להופיע ביומן של הסוכן, לא של המנהל.
ALTER TABLE appointments ADD COLUMN owner_user_id CHAR(26);

-- מאיפה הפגישה הגיעה: system (נקבעה כאן) | google (נמשכה מהיומן).
--
-- בלי ההבחנה הזו הדחיפה החוצה הייתה מחזירה ל-Google אירוע שזה עתה
-- הגיע ממנו, וזה לולאה — כל צד "מעדכן" את השני לנצח.
ALTER TABLE appointments ADD COLUMN sync_source VARCHAR(10) NOT NULL DEFAULT 'system';

-- מתי נדחף לאחרונה, ומה היה מזהה היומן. ה-google_event_id כבר קיים.
ALTER TABLE appointments ADD COLUMN google_synced_at TIMESTAMPTZ;

CREATE INDEX appointments_google_event_idx ON appointments (tenant_id, google_event_id);
