-- מספר פנייה אחד לשני המקורות, וסטטוס אחד.
--
-- ## למה מספר
--
-- פנייה זוהתה עד עכשיו ב-ULID. אי אפשר לומר אותו בטלפון, אי אפשר
-- לבקש מלקוח לצטט אותו, ואי אפשר לשים אותו בנושא של מייל. „פנייה
-- 1042” עושה את שלושת הדברים — ובעיקר, היא חוזרת אלינו מעצמה:
-- המספר נדבק לנושא, ותשובה שנפתחה כמייל חדש (בלי הטוקן שלנו)
-- עדיין מוצאת את דרכה.
--
-- ## למה רצף אחד ולא אחד לכל טבלה
--
-- מבחינת מי שמטפל יש **תור אחד**: פנייה שהגיעה מהכפתור במערכת
-- ופנייה שהגיעה במייל הן אותה עבודה. שני רצפים היו מייצרים שתי
-- „פניות 17” שונות — בדיוק הבלבול שהמספר נועד למנוע.
CREATE SEQUENCE "support_reference_seq" AS BIGINT START 1;

ALTER TABLE "support_tickets" ADD COLUMN "reference" INTEGER;
ALTER TABLE "support_threads" ADD COLUMN "reference" INTEGER;

-- השורות הקיימות ממוספרות **לפי סדר הזמן ומשני המקורות יחד**, כדי
-- שהמספרים יקראו כהיסטוריה אחת ולא כשני רצפים משורגים.
CREATE TEMP TABLE "support_ref_backfill" AS
SELECT src, id, row_number() OVER (ORDER BY created_at, id) AS n
FROM (
  SELECT 'ticket'::text AS src, id, created_at FROM "support_tickets"
  UNION ALL
  SELECT 'thread'::text AS src, id, created_at FROM "support_threads"
) AS all_rows;

UPDATE "support_tickets" t
SET "reference" = b.n
FROM "support_ref_backfill" b
WHERE b.src = 'ticket' AND b.id = t.id;

UPDATE "support_threads" h
SET "reference" = b.n
FROM "support_ref_backfill" b
WHERE b.src = 'thread' AND b.id = h.id;

-- הרצף ממשיך מהמספר האחרון שחולק. `false` = הערך הבא הוא בדיוק זה.
SELECT setval(
  'support_reference_seq',
  COALESCE((SELECT MAX(n) FROM "support_ref_backfill"), 0) + 1,
  false
);

DROP TABLE "support_ref_backfill";

ALTER TABLE "support_tickets"
  ALTER COLUMN "reference" SET DEFAULT nextval('support_reference_seq'),
  ALTER COLUMN "reference" SET NOT NULL;
ALTER TABLE "support_threads"
  ALTER COLUMN "reference" SET DEFAULT nextval('support_reference_seq'),
  ALTER COLUMN "reference" SET NOT NULL;

CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets" ("reference");
CREATE UNIQUE INDEX "support_threads_reference_key" ON "support_threads" ("reference");

-- ## סטטוס אחד
--
-- הפניות מהכפתור נשאו `resolved` והשרשורים `closed` — שני קודים
-- לאותו מצב, שכבר הוצג בעברית באותה מילה („נסגרה”). שולחן אחד
-- מחייב אוצר מילים אחד, ולכן `resolved` עובר ל-`closed`.
UPDATE "support_tickets" SET "status" = 'closed' WHERE "status" = 'resolved';
