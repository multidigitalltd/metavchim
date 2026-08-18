-- יומן פניות לנתיב הוובהוק של המרכזייה — כולל פניות שנדחו.
--
-- בלעדיו בקשה עם מפתח לא מוכר מקבלת 404 ונעלמת, ומסך האבחון מציג
-- "לא התקבל אף אירוע" בדיוק כמו מרכזייה שלא פנתה מעולם.
--
-- בלי tenant_id-חובה ובלי RLS במכוון: השורות המעניינות ביותר הן
-- אלה שלא הצלחנו לשייך למשרד, וטבלה תחת RLS הייתה מסתירה אותן.
CREATE TABLE telephony_webhook_hits (
  id          CHAR(26)     PRIMARY KEY,
  received_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  outcome     VARCHAR(20)  NOT NULL,
  tenant_id   CHAR(26),
  key_prefix  VARCHAR(12)  NOT NULL,
  method      VARCHAR(6)   NOT NULL,
  field_keys  VARCHAR(400)
);

-- הקריאה היחידה היא "האחרונות", והגיזום רץ על אותו סדר
CREATE INDEX telephony_webhook_hits_received_at_idx
  ON telephony_webhook_hits (received_at DESC);
