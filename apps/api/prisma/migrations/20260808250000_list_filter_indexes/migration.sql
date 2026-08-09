-- החיפוש ברשימות הורחב מכתובת בלבד לטקסט החופשי שנכתב על הנכס ועל
-- הקונה. כל שדה חדש נשאל ב-ILIKE '%…%', שאינו יכול להשתמש באינדקס
-- B-Tree — ובלי אינדקס טריגרמות כל הקלדה בשורת החיפוש סורקת את כל
-- הטבלה. אותו טיפול שקיבלו כבר street/city/marketing_title.
CREATE INDEX properties_neighborhood_trgm ON properties USING GIN (neighborhood gin_trgm_ops);
CREATE INDEX properties_marketing_description_trgm ON properties USING GIN (marketing_description gin_trgm_ops);
CREATE INDEX properties_internal_notes_trgm ON properties USING GIN (internal_notes gin_trgm_ops);
CREATE INDEX properties_property_type_trgm ON properties USING GIN (property_type gin_trgm_ops);

CREATE INDEX buyers_agent_notes_trgm ON buyers USING GIN (agent_notes gin_trgm_ops);
CREATE INDEX buyers_ai_notes_trgm ON buyers USING GIN (ai_notes gin_trgm_ops);

-- הערים המבוקשות הן מערך, ונשאלות עם has (= ANY). אינדקס GIN רגיל
-- הוא הנכון למערכים, לא טריגרמות.
CREATE INDEX buyers_cities_gin ON buyers USING GIN (cities);

-- טווחי המחיר והחדרים נשאלים כאי-שוויון על עמודה בודדת בתוך הדייר.
CREATE INDEX properties_tenant_price_idx ON properties (tenant_id, price_agorot);
CREATE INDEX properties_tenant_rooms_idx ON properties (tenant_id, rooms);
