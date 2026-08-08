-- הקלטת שיחה, תמלול וסיכום (docs/09 שלב 2).
--
-- המתווך מעלה הקלטה לכרטיס השיחה, השרת מתמלל אותה בשירות המקומי
-- ומחלץ ממנה את מה שנרשם בפנקס — תקציב, חדרים, אזור, ומתי לחזור.
--
-- ההקלטה נשמרת ב-S3 ולא בטבלה: הן כבדות, והטבלה נשלפת בכל רשימת
-- שיחות. המפתח בלבד יושב כאן.
ALTER TABLE calls ADD COLUMN recording_key VARCHAR(300);
ALTER TABLE calls ADD COLUMN transcript TEXT;
ALTER TABLE calls ADD COLUMN transcribed_at TIMESTAMP(3);

-- pending | running | done | failed | unavailable
--
-- למה עמודה ולא נגזרת מ-transcript IS NULL: תמלול שנכשל ותמלול
-- שטרם התחיל נראים אותו דבר בלעדיה, והמתווך שממתין מול מסך ריק
-- אינו יודע אם לחכות או להקליד בעצמו. 'unavailable' הוא המצב שבו
-- שירות התמלול כבוי — זו תצורה, לא כשל, והמסך אומר זאת אחרת.
ALTER TABLE calls ADD COLUMN transcription_status VARCHAR(20);

-- הסורק של העובד מחפש בדיוק את הממתינים; אינדקס חלקי כדי שלא
-- יחזיק את כל היסטוריית השיחות של המשרד.
CREATE INDEX calls_pending_transcription_idx ON calls (tenant_id, occurred_at)
  WHERE transcription_status IN ('pending', 'running');
