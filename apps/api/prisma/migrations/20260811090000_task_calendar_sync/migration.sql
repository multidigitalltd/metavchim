-- משימות ביומן Google.
--
-- עד כה נדחפו פגישות בלבד, ומשימה עם מועד יעד לא הופיעה ביומן —
-- מתווך שראה "משימה ג" במערכת ולא ב-Google הסיק שהסנכרון שבור.
-- שני השדות מקבילים לאלה שעל appointments, כדי ששני המסלולים
-- יתנהגו זהה: null ב-google_synced_at = "ממתין לדחיפה".
ALTER TABLE tasks ADD COLUMN google_event_id VARCHAR(255);
ALTER TABLE tasks ADD COLUMN google_synced_at TIMESTAMPTZ;

-- אינדקס חלקי: הסבב מחפש רק את מה שממתין לדחיפה, וזה חלק זעיר
-- מהטבלה. אינדקס מלא היה משלם על כל משימה שכבר סונכרנה.
CREATE INDEX tasks_pending_google_sync_idx
  ON tasks (tenant_id, assigned_to_user_id, due_at)
  WHERE google_synced_at IS NULL AND due_at IS NOT NULL;

-- מחיקת משימה שיש לה אירוע ביומן נדחית: השורה נשמרת עד שהסבב
-- הבא מוחק את האירוע מ-Google, ורק אז נמחקת. מחיקה מיידית הייתה
-- מוחקת את המזהה היחיד שמצביע על האירוע, והוא היה נשאר ביומן
-- לנצח בלי דרך להגיע אליו.
ALTER TABLE tasks ADD COLUMN deleted_after_sync BOOLEAN NOT NULL DEFAULT false;
