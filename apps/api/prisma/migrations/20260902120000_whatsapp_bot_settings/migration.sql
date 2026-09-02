-- הגדרות הבוט של הסוכן (docs/12 §6.2).
--
-- NULL = ברירות המחדל. זו גם ההתנהגות ה"אחידה לכולם": סוכן שאינו
-- נוגע בהגדרות מקבל בדיוק את השלד הקבוע.
ALTER TABLE whatsapp_business_connections ADD COLUMN bot_settings JSONB;
