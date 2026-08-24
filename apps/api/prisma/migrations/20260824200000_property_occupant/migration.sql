-- מי גר בנכס כשזה אינו הבעלים — דירה שמושכרת בזמן שהיא מוצעת.
-- `occupant` ולא `tenant`: `tenant_id` הוא המשרד בכל הסכימה.
ALTER TABLE "properties" ADD COLUMN "occupant_contact_id" CHAR(26);
