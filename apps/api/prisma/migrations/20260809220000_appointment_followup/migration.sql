-- דחיית פגישה ותיעודה.
--
-- **rescheduled_from** — המועד הקודם. בלעדיו "נדחתה" הוא מידע שאובד
-- ברגע שהשדה נדרס: המתווך רואה פגישה ביום חמישי ואינו יודע שהיא
-- נקבעה במקור ליום שני ונדחתה פעמיים. זה בדיוק הסימן שהעסקה מתקררת.
ALTER TABLE appointments ADD COLUMN rescheduled_from TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN reschedule_count SMALLINT NOT NULL DEFAULT 0;

-- הקלטה של פגישה נשמרת כשורת `calls`, ולא כצינור תמלול שני.
--
-- `calls` היא בפועל "שיחה מוקלטת עם סיכום": יש בה הקלטה, תמלול,
-- סטטוס תמלול וסיכום, והעובד שמתמלל אותה כבר עובד. בניית מסלול מקביל
-- לפגישות הייתה משכפלת אחסון, תמלול, סיכום וסטטוס — ארבעה מקומות
-- שיתחילו להיפרד. מה שחסר היה הקישור חזרה לפגישה.
ALTER TABLE calls ADD COLUMN appointment_id CHAR(26);
CREATE INDEX calls_tenant_appointment_idx ON calls (tenant_id, appointment_id);
