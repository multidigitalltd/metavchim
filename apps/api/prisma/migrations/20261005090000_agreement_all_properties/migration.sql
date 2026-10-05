-- הזמנה בכתב כללית: חלה על כל הנכסים שהמשרד יציע ללקוח, ולא על נכס אחד.
--
-- ברירת המחדל false, ולכן כל הסכם קיים נשאר בדיוק כמו שהיה: הזמנה על
-- נכס פותחת הצעות על הנכס שלה בלבד, והזמנה בלי נכס אינה פותחת אף אחד.
ALTER TABLE agreements ADD COLUMN all_properties BOOLEAN NOT NULL DEFAULT false;

-- הזמנה כללית היא הזמנה בכתב בלי נכס מסוים — בלעדיות נִתנת תמיד על נכס.
ALTER TABLE agreements
  ADD CONSTRAINT agreements_all_properties_scope
  CHECK (NOT all_properties OR (kind = 'brokerage' AND property_id IS NULL));

-- הסכם פעיל אחד לכל (לקוח, סוג, נכס) — ועכשיו גם לכל היקף. הזמנה כללית
-- והזמנה על נכס שתואר ביד הן שני מסמכים שונים, גם ששתיהן בלי property_id.
DROP INDEX agreements_active_unique;
CREATE UNIQUE INDEX agreements_active_unique
  ON agreements (tenant_id, contact_id, kind, COALESCE(property_id, ''), all_properties)
  WHERE status IN ('pending', 'viewed');
