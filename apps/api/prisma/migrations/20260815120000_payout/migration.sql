-- ============================================================
-- מסלול הכסף: יתרה כספית למשרד ובקשות משיכה.
--
-- עד כה `shareLead` העביר "credits" קשיח, עם הערה שמסלול הכסף דורש
-- יתרה ומשיכה "שעדיין לא קיימות". כאן הן קיימות.
-- ============================================================

-- מה שהמשרד המפנה בחר לקבל, ומה שהובטח לו בפועל. שניהם מצולמים
-- ברגע הפרסום — המשרד הקולט משלם את מה שראה בלוח, והמפנה מקבל את
-- מה שבחר, גם אם התמחור בפלטפורמה השתנה בינתיים.
ALTER TABLE shared_leads
  ADD COLUMN IF NOT EXISTS payout_mode VARCHAR(10) NOT NULL DEFAULT 'credits',
  ADD COLUMN IF NOT EXISTS payout_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_agorot INTEGER NOT NULL DEFAULT 0;

-- הבונוס על בחירת קרדיטים חושב בפרסום ומעולם לא שולם: `buyLead`
-- זיכה `price_credits - platform_fee_credits`, בלי הבונוס שהמסך
-- הבטיח. התיקון הוא לצלם את **התמורה עצמה** על השורה ולשלם אותה,
-- במקום לחשב אותה מחדש בצד השני מנתונים חלקיים.
--
-- השורות הקיימות מקבלות בדיוק את מה שהיו מקבלות לפני השינוי. הבונוס
-- הוא קדימה בלבד — זה גם מה שנכתב במסך הפלטפורמה ("נכנס לתוקף בכל
-- הפניה שתפורסם מעכשיו"), ורטרואקטיביות כאן הייתה משנה תנאים של
-- עסקאות שכבר פורסמו.
UPDATE shared_leads
   SET payout_credits = GREATEST(0, price_credits - platform_fee_credits)
 WHERE payout_credits = 0;

-- ------------------------------------------------------------
-- הספר הכספי — Append-Only, אגורות. היתרה נגזרת מהסכום.
--
-- ספר נפרד מ-credit_ledger ולא עמודה נוספת בו: קרדיט הוא אמצעי
-- תשלום פנימי, ושקל הוא התחייבות של הפלטפורמה. ערבובם באותו מספר
-- היה הופך כל בונוס בקרדיטים לחוב כספי.
-- ------------------------------------------------------------
CREATE TABLE payout_ledger (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    -- lead_sale | withdrawal | withdrawal_reversed
    "kind" VARCHAR(30) NOT NULL,
    -- חיובי = זיכוי למשרד, שלילי = משיכה
    "amount_agorot" INTEGER NOT NULL,
    "ref_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payout_ledger_tenant_id_created_at_idx" ON payout_ledger("tenant_id", "created_at");

-- ------------------------------------------------------------
-- בקשת משיכה.
--
-- פרטי הבנק מוצפנים באותו מפתח אפליקטיבי כמו PII של לקוחות: זהו
-- המידע הרגיש ביותר שמשרד מפקיד אצלנו, והוא נקרא בדיוק בשני רגעים
-- — כשהמשרד ממלא, וכשמבצעים את ההעברה.
--
-- הפרטים יושבים על **הבקשה** ולא על המשרד. חשבון בנק שמשתנה בין
-- בקשות הוא מידע היסטורי שצריך להישמר: אחרי העברה שיצאה לחשבון
-- הלא נכון, השאלה היחידה שחשובה היא לאן בדיוק שלחנו אז.
-- ------------------------------------------------------------
CREATE TABLE payout_requests (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "amount_agorot" INTEGER NOT NULL,
    -- pending | approved | paid | rejected
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "holder_name_encrypted" TEXT NOT NULL,
    "bank_code_encrypted" TEXT NOT NULL,
    "branch_encrypted" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "business_id_encrypted" TEXT NOT NULL,
    "note" VARCHAR(300),
    "requested_by" CHAR(26) NOT NULL,
    -- ההחלטה בצד הפלטפורמה
    "decided_at" TIMESTAMP(3),
    "decided_by" CHAR(26),
    "decision_note" VARCHAR(300),
    -- אסמכתת ההעברה בבנק. בלעדיה "שולם" הוא אמירה בלי גיבוי.
    "reference" VARCHAR(120),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payout_requests_tenant_id_created_at_idx" ON payout_requests("tenant_id", "created_at");
CREATE INDEX "payout_requests_status_created_at_idx" ON payout_requests("status", "created_at");

-- ------------------------------------------------------------
-- RLS — כל טבלה עסקית חדשה מקבלת בידוד דייר במיגרציה שיוצרת אותה.
--
-- ולצידו `payout_desk`, אותו דפוס בדיוק כמו `support_desk`: מסך
-- הפלטפורמה חייב לראות חוצה-דיירים כדי לאשר העברות, והדגל נדלק
-- אך ורק בשירות שמשרת אותו מאחורי PlatformAdminGuard. שתי שכבות
-- ולא אחת — כאן יושבים פרטי חשבון בנק.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payout_ledger', 'payout_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, t);
    EXECUTE format('DROP POLICY IF EXISTS payout_desk ON %I', t);
    EXECUTE format($f$
      CREATE POLICY payout_desk ON %I
        USING (current_setting('app.payout_desk', true) = 'on')
        WITH CHECK (current_setting('app.payout_desk', true) = 'on')
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO metavchim_app', t);
  END LOOP;
END $$;

-- הספר הכספי Append-Only ברמת המסד, כמו credit_ledger ו-audit_log:
-- תנועה שנמחקת היא כסף שנעלם מהמאזן, ותיקון "קטן" בסכום הוא בדיוק
-- הדבר שאסור שיהיה אפשרי — גם לא לתוקף שהשיג את הרשאות האפליקציה.
--
-- payout_requests **אינה** מוגנת כך: היא מחזיקה פרטי חשבון בנק,
-- ומחיקת משרד חייבת להיות מסוגלת להסיר אותם. הראיה הכספית נשארת
-- בספר, שאין בו שום פרט מזהה.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON payout_ledger FROM metavchim_app';
  END IF;
END $$;
