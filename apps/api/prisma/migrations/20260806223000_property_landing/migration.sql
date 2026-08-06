-- דף נחיתה ציבורי לנכס ("צור דף נחיתה" בקובץ העיצוב): קישור שיווקי
-- שהמתווך שולח או מטמיע, עם טופס פנייה שנכנס ישירות ללידים.
-- הטוקן אקראי (43 תווי base64url = 256 ביט) — הקישור הוא ההרשאה.
ALTER TABLE properties ADD COLUMN landing_token CHAR(43);
CREATE UNIQUE INDEX properties_landing_token_key ON properties(landing_token);

-- פוליסת RLS ציבורית: חשיפת שורת הנכס היחידה שהטוקן שלה הוצג —
-- בלי הקשר דייר ובלי גישה לשום שורה אחרת (אותו דפוס כמו app.offer_token).
CREATE POLICY property_landing_public ON properties FOR SELECT
  USING (landing_token = current_setting('app.landing_token', true));

-- תמונות הנכס לדף הציבורי — נקראות רק דרך הנכס שהטוקן חושף.
-- תת-השאילתה עוברת בעצמה את פוליסות ה-RLS של properties, כלומר
-- מחזירה לכל היותר את הנכס של הטוקן.
CREATE POLICY property_media_landing_public ON property_media FOR SELECT
  USING (property_id IN (
    SELECT id FROM properties
    WHERE landing_token = current_setting('app.landing_token', true)
  ));
