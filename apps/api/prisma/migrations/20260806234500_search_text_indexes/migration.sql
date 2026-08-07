-- החיפוש הגלובלי עבר לחפש גם בטקסט החופשי שנכתב במערכת (סיכומי
-- שיחות, הערות, פתקי יומן ומשימות). כל אלה נשאלים עם ILIKE '%…%',
-- שאינו יכול להשתמש באינדקס B-Tree — כלומר סריקה מלאה של הטבלה בכל
-- הקלדה בשורת החיפוש.
--
-- pg_trgm הופך את החיפוש הזה לאינדקסבילי: אינדקס GIN על טריגרמות
-- משרת גם התאמה באמצע המחרוזת. בלעדיו העלות גדלה לינארית עם היקף
-- הפעילות של כל המשרדים על השרת, לא רק של המחפש.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX interactions_content_trgm ON interactions USING GIN (content gin_trgm_ops);
CREATE INDEX calls_summary_trgm ON calls USING GIN (summary gin_trgm_ops);
CREATE INDEX appointments_title_trgm ON appointments USING GIN (title gin_trgm_ops);
CREATE INDEX appointments_notes_trgm ON appointments USING GIN (notes gin_trgm_ops);
CREATE INDEX tasks_title_trgm ON tasks USING GIN (title gin_trgm_ops);
CREATE INDEX tasks_notes_trgm ON tasks USING GIN (notes gin_trgm_ops);

-- כתובות הנכסים נשאלות באותה צורה מאז החיפוש הראשון, ומקבלות כאן
-- את אותו טיפול.
CREATE INDEX properties_street_trgm ON properties USING GIN (street gin_trgm_ops);
CREATE INDEX properties_city_trgm ON properties USING GIN (city gin_trgm_ops);
CREATE INDEX properties_marketing_title_trgm ON properties USING GIN (marketing_title gin_trgm_ops);
