-- מסלול חינמי אינו פוקע — ניקוי התאריכים שנשארו על משרדים קיימים.
--
-- השער כבר אינו נשען על השדות האלה כשהמסלול חינמי, אבל שורה
-- שממשיכה לשאת תאריך תפוגה משקרת: היא מזינה את הבאנר „הניסיון
-- מסתיים בעוד X ימים”, והיא הופכת לאמת ברגע שהמשרד יוחזר למסלול
-- בתשלום. משרד חינמי שנפתח כניסיון של 14 יום נסגר אחריהם
-- (דיווח המשתמש), וזו השורה שגרמה לזה.
--
-- ההגדרה של „חינמי” זהה ל-`isFreePlan` בקוד: אפס בשני המחזורים
-- ולא „לפי הצעה”. מסלול שאינו קיים בטבלה אינו מטופל כאן, ובצדק —
-- אי אפשר לדעת עליו דבר.
--
-- משרד מושהה או סגור אינו נגזר: ההשהיה היא החלטת בעל הפלטפורמה
-- ואינה עניין של חיוב.
UPDATE tenants t
SET trial_ends_at = NULL,
    paid_until    = NULL,
    status        = 'active'
FROM plans p
WHERE p.code = t.plan
  AND p.price_on_request = false
  AND p.monthly_price_agorot = 0
  AND COALESCE(p.yearly_price_agorot, 0) = 0
  AND t.status IN ('active', 'trial')
  AND (t.trial_ends_at IS NOT NULL OR t.paid_until IS NOT NULL OR t.status <> 'active');
