-- חשבון הקרדיטים של הפלטפורמה.
--
-- עמלת ההפניה חושבה ונשמרה על שורת ההפניה, אבל לא נזקפה לשום ספר:
-- היא הייתה ההפרש בין מה שהמשרד הקולט חויב לבין מה שהמפנה זוכה.
-- כלומר לא היה מקום להסתכל בו כדי לדעת כמה הפלטפורמה הרוויחה.
--
-- הטבלה **אינה** תחת RLS, כמו plans, coupons ו-platform_settings:
-- אין לה דייר. היא נקראת ונכתבת רק מנתיבי הפלטפורמה ומנקודת הקליטה
-- של הפניה, ושתיהן מוגנות בשער נפרד.
CREATE TABLE "platform_credit_ledger" (
  "id"                CHAR(26) PRIMARY KEY,
  -- referral_fee | burn | adjustment
  "kind"              VARCHAR(30) NOT NULL,
  -- חיובי = נזקף לפלטפורמה, שלילי = נמחק ממנה
  "amount"            INTEGER NOT NULL,
  -- ההכנסה שהוכרה בשורה. אפס בכל שורה שאינה מחיקה.
  "recognized_agorot" INTEGER NOT NULL DEFAULT 0,
  -- מחיר הקרדיט ברגע המחיקה, מצולם. המחיר משתנה מהמסך, ובלי צילום
  -- כל שינוי תמחור היה משכתב את הדוח למפרע.
  "unit_price_agorot" INTEGER NOT NULL DEFAULT 0,
  -- הצד היקר של אותה הפניה, מצולם על אותה שורה:
  --
  -- הבונוס הוא קרדיטים חדשים שנוצרו יש מאין, והמזומן הוא כסף שיצא.
  -- שניהם היו נקראים מ-shared_leads, וזו טבלה תחת RLS שאין
  -- לפלטפורמה דרך חוקית לקרוא ממנה חוצה-דיירים — ניסיון כזה מחזיר
  -- אפס שורות **בשקט**, כלומר דוח שמראה 0 בכל שורה ונראה תקין.
  -- הצילום כאן פותר את זה בלי לפתוח פוליסת קריאה נוספת.
  "bonus_credits"     INTEGER NOT NULL DEFAULT 0,
  "cash_paid_agorot"  INTEGER NOT NULL DEFAULT 0,
  -- מאיזה משרד הגיעה העמלה — לדוח בלבד, אין כאן בידוד דיירים
  "source_tenant_id"  CHAR(26),
  "ref_id"            CHAR(26),
  "note"              VARCHAR(200),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "platform_credit_ledger_created_at_idx"
  ON "platform_credit_ledger" ("created_at");
CREATE INDEX "platform_credit_ledger_kind_created_at_idx"
  ON "platform_credit_ledger" ("kind", "created_at");

-- הפניה אחת מזכה את הפלטפורמה פעם אחת. בלי האילוץ הזה קליטה שנוסתה
-- פעמיים הייתה מזכה פעמיים, וזה סוג הבאג שמתגלה רק בכסף.
CREATE UNIQUE INDEX "platform_credit_ledger_referral_fee_once_idx"
  ON "platform_credit_ledger" ("ref_id")
  WHERE "kind" = 'referral_fee';

-- ============================================================
-- מילוי למפרע: הפניות שכבר נסגרו לפני שהספר היה קיים
-- ------------------------------------------------------------
-- בלי זה העמלות שכבר נגבו נעלמות מהיתרה ולעולם לא ניתן יהיה למחוק
-- אותן, בעוד שהבונוס שהונפק כנגדן **כן** היה נספר — כלומר הדוח היה
-- מציג הפסד גדול מהאמת ביום ההפעלה.
--
-- המיגרציה רצה בתפקיד הבעלים ולכן היא קוראת את shared_leads בלי
-- RLS. זו הפעם היחידה שהנתון הזה נקרא משם; מכאן והלאה הוא נכתב
-- לספר ברגע הקליטה.
--
-- החישובים זהים לאלה שבקוד:
--   עמלה = LEAST(platform_fee_credits, price_credits - 1), לא שלילית
--   נטו   = price_credits - עמלה
--   בונוס = payout_credits - נטו, רק במסלול קרדיטים ולא שלילי
INSERT INTO "platform_credit_ledger"
  ("id", "kind", "amount", "bonus_credits", "cash_paid_agorot",
   "source_tenant_id", "ref_id", "note", "created_at")
SELECT
  -- מזהה יציב באורך 26 שאינו מתנגש עם ULID שנוצר בקוד
  'BACKFILL' || lpad(row_number() OVER (ORDER BY s.sold_at, s.id)::text, 18, '0'),
  'referral_fee',
  fee.value,
  CASE
    WHEN s.payout_credits > 0
      THEN GREATEST(0, s.payout_credits - (s.price_credits - fee.value))
    ELSE 0
  END,
  s.payout_agorot,
  s.buyer_tenant_id,
  s.id,
  'נזקף למפרע בהפעלת הספר',
  COALESCE(s.sold_at, CURRENT_TIMESTAMP)
FROM "shared_leads" s
CROSS JOIN LATERAL (
  SELECT GREATEST(0, LEAST(s.platform_fee_credits, s.price_credits - 1)) AS value
) fee
WHERE s.status = 'sold';
