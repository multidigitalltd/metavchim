-- רכישת קרדיטים באותה טבלת תשלומים.
--
-- טבלה אחת ולא שתיים: זה המקום היחיד לראות את כל הכסף שנכנס, וגם
-- מסלול הזיכוי, החשבוניות והאידמפוטנטיות מול קארדקום כבר יושבים
-- כאן. ההבחנה היא בשדה `purpose`.
ALTER TABLE payments ADD COLUMN purpose VARCHAR(20) NOT NULL DEFAULT 'subscription';
ALTER TABLE payments ADD COLUMN credits_purchased INTEGER;

-- מסלול ומחזור חיוב אינם קיימים ברכישת קרדיטים. ערך מדומה היה נראה
-- כמו מנוי בכל דוח; ריק אומר את האמת.
ALTER TABLE payments ALTER COLUMN plan_code DROP NOT NULL;
ALTER TABLE payments ALTER COLUMN billing_cycle DROP NOT NULL;
