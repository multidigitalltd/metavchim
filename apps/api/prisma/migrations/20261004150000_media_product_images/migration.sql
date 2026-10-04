-- רכש מדיה: הדמיה לכל מוצר — תמונה שמשויכת למוצר (kind = product), יורדת איתו
ALTER TABLE media_outlet_images ADD COLUMN product_id CHAR(26);
ALTER TABLE media_outlet_images
  ADD CONSTRAINT media_outlet_images_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES media_products(id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX media_outlet_images_product_id_sort_order_idx ON media_outlet_images(product_id, sort_order);
