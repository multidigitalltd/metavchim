-- ‎**מספר לקוח למשרד — מה שאפשר לומר בטלפון.**
--
-- ‏משרד זוהה עד עכשיו ב-ULID בלבד. אי אפשר להקריא אותו, אי אפשר
-- ‏לבקש ממנו לצטט אותו, ואי אפשר לחפש לפיו ברשימה בעין. „משרד
-- ‏‎100427” עושה את שלושת הדברים. אותו נימוק בדיוק כמו
-- ‏‎`support_reference_seq`, ואותו דפוס.
--
-- ‎**מתחיל ב-100000 ולא ב-1**, וזו הדרישה: שש ספרות לפחות. מספר
-- ‏קצר נראה כמו מונה פנימי („משרד 7”), ומספרים באורך משתנה אינם
-- ‏נקראים כזהות. הרצף ממשיך לשבע ספרות מעצמו כשיגיע לשם — „לפחות
-- ‏שש”, ולא „בדיוק שש”.
--
-- ‎**עמודה ולא נגזרת מ-`created_at`:** מספר שנגזר מסדר כלשהו משתנה
-- ‏כשמשרד נמחק או כשהסדר משתנה, ומספר לקוח שמשתנה גרוע ממספר
-- ‏שאינו קיים. הרצף מבטיח שהוא מחולק פעם אחת ואינו חוזר.
CREATE SEQUENCE "tenant_customer_no_seq" AS BIGINT START 100000;

ALTER TABLE "tenants" ADD COLUMN "customer_no" INTEGER;

-- ‏המשרדים הקיימים ממוספרים לפי סדר ההקמה, כדי שהמספרים ייקראו
-- ‏כהיסטוריה ולא כפיזור אקראי. `id` שובר שוויון כדי שהריצה תהיה
-- ‏דטרמיניסטית גם לשתי הקמות באותה שנייה.
CREATE TEMP TABLE "tenant_no_backfill" AS
SELECT id, 99999 + row_number() OVER (ORDER BY created_at, id) AS n
FROM "tenants";

UPDATE "tenants" t
SET "customer_no" = b.n
FROM "tenant_no_backfill" b
WHERE b.id = t.id;

-- ‏הרצף ממשיך מהמספר האחרון שחולק. `false` = הערך הבא הוא בדיוק זה.
SELECT setval(
  'tenant_customer_no_seq',
  COALESCE((SELECT MAX(n) FROM "tenant_no_backfill"), 99999) + 1,
  false
);

DROP TABLE "tenant_no_backfill";

ALTER TABLE "tenants"
  ALTER COLUMN "customer_no" SET DEFAULT nextval('tenant_customer_no_seq'),
  ALTER COLUMN "customer_no" SET NOT NULL;

CREATE UNIQUE INDEX "tenants_customer_no_key" ON "tenants" ("customer_no");

-- ‎**והרשאה על הרצף — למסד שכבר הוקצה.**
--
-- ‏ברירות המחדל של ההקצאה כיסו טבלאות בלבד, ולכן רצף חדש אינו
-- ‏נגיש לתפקיד האפליקציה: כל יצירת משרד (הרשמה עצמית ופתיחה ממסך
-- ‏הפלטפורמה כאחת) נופלת על `permission denied for sequence`,
-- ‏מפני שהעמודה נכתבת דרך `DEFAULT nextval(...)`. השורה החסרה
-- ‏נוספה ל-`create_app_role.sql`, אבל היא חלה על מה שייווצר
-- ‏**אחריה** — ולא על הרצף שנוצר כאן, על מסד שהוקצה קודם.
--
-- ‏מותנה בקיום התפקיד, כמו שאר המיגרציות שנוגעות בו: הוא נוצר
-- ‏ע"י ההקצאה בהתקנה ואינו קיים בכל מסד.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE tenant_customer_no_seq TO metavchim_app';
  END IF;
END $$;
