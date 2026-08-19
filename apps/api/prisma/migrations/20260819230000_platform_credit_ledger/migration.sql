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
