-- ‏אינדקסים למפתחות זרים שמחיקה מתפשטת דרכם.
--
-- ‏Postgres אינו יוצר אינדקס למפתח זר מעצמו. האינדקסים הקיימים על
-- ‏הטבלאות האלה פותחים ב-`tenant_id` — נכון לשאילתות של האפליקציה, שתמיד
-- ‏מסננות לפי משרד — אבל מחיקת איש קשר (בקשת מחיקה, מיזוג כפילויות)
-- ‏ומחיקת נכס מריצות בדיקת מפתח זר לפי `contact_id`/`property_id` בלבד,
-- ‏ובלי אינדקס שפותח בעמודה הזו היא סורקת את **כל** הטבלה, של כל
-- ‏המשרדים. מחיקה אחת עולה ככל שהמערכת כולה גדלה.
--
-- ‏נמדד מקומית על 200 אלף טלפונים: בדיקת `contact_phones` במחיקת איש
-- ‏קשר — כ-30ms לפני, פחות ממילישנייה אחרי.
--
-- ‏לא `CONCURRENTLY`: Prisma מריצה את הקובץ כבלוק אחד, ו-`CONCURRENTLY`
-- ‏אינו רץ בתוך טרנזקציה. בגודל הטבלאות היום הבנייה נמשכת שניות לכל היותר.

CREATE INDEX IF NOT EXISTS contact_phones_contact_id_idx ON contact_phones (contact_id);
CREATE INDEX IF NOT EXISTS contact_links_contact_id_idx ON contact_links (contact_id);
CREATE INDEX IF NOT EXISTS contact_links_related_contact_id_idx ON contact_links (related_contact_id);
CREATE INDEX IF NOT EXISTS contact_optout_tokens_contact_id_idx ON contact_optout_tokens (contact_id);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_contact_id_idx ON whatsapp_conversations (contact_id);
CREATE INDEX IF NOT EXISTS property_media_property_id_idx ON property_media (property_id);
