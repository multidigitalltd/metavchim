-- הרשמה עצמית של משרד + תקופת ניסיון.
--
-- עד כה משרד הוקם רק ידנית ממסך הפלטפורמה. עמודה אחת חסרה כדי
-- שההרשמה תהיה אמיתית: מתי הניסיון נגמר.
--
-- העמודה על tenants ולא בתוך settings ה-JSON: היא נבדקת בכל בקשה
-- (אימות ה-Session), ותנאי על JSON לא היה יכול להישען על אינדקס.
-- NULL = אין תפוגה, וזה המצב של כל משרד שהוקם ידנית או ששילם.
ALTER TABLE tenants ADD COLUMN trial_ends_at TIMESTAMP(3);

-- מאיזה ערוץ המשרד הגיע — הרשמה עצמית או הקמה ידנית. משמש לדוח
-- ולתמיכה, לא להרשאות.
ALTER TABLE tenants ADD COLUMN signup_source VARCHAR(20) NOT NULL DEFAULT 'manual';

CREATE INDEX tenants_trial_ends_at_idx ON tenants (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;
