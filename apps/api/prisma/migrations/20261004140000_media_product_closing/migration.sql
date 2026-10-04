-- רכש מדיה: מועד סגירה לכל מוצר בנפרד — גובר על מועד המדיה כשהוא קיים
ALTER TABLE media_products
  ADD COLUMN next_closing_at TIMESTAMP(3),
  ADD COLUMN reminded_for_closing_at TIMESTAMP(3);
