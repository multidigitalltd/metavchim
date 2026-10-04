-- רכש מדיה: קובץ המודעה לדפוס, וסימון „פורסם”
ALTER TABLE media_orders
  ADD COLUMN creative_key VARCHAR(200),
  ADD COLUMN creative_mime VARCHAR(40),
  ADD COLUMN creative_name VARCHAR(160),
  ADD COLUMN creative_token VARCHAR(64),
  ADD COLUMN creative_uploaded_at TIMESTAMP(3),
  ADD COLUMN published_at TIMESTAMP(3),
  ADD COLUMN published_note VARCHAR(300) NOT NULL DEFAULT '';

-- הקישור שנציג המדיה מקבל — אקראי ויחיד; חיפוש לפיו הוא הנתיב הציבורי
CREATE UNIQUE INDEX media_orders_creative_token_key ON media_orders(creative_token);
