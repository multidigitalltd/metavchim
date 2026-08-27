-- חשבוניות מס קבלה — מסמך אחד לכל תשלום שנגבה.
--
-- הפלטפורמה גובה מהמשרדים בקארדקום, וכל גבייה מחייבת מסמך. עד היום
-- המסמכים הופקו ידנית; מכאן הם נוצרים אוטומטית בלינט, ושורה כאן היא
-- המעקב: מה כבר הופק, מה ממתין, ומה נכשל ומחכה לאדם.
--
-- **מחוץ ל-RLS, כמו `payments`.** זו רשומה של הפלטפורמה מול המשרד
-- ולא נתון של המשרד: המשרד אינו קורא אותה דרך המערכת, והיא נשמרת
-- גם אחרי שהמשרד נמחק — מסמך מס בחובת שמירה של שבע שנים. אין בה
-- פרט אישי של לקוח קצה.
CREATE TABLE "invoices" (
  "id"              CHAR(26) PRIMARY KEY,
  -- לא ON DELETE CASCADE: מחיקת משרד אינה מוחקת מסמכי מס. הקשר
  -- נשמר כמזהה בלבד, בדיוק כמו ב-payments.
  "tenant_id"       CHAR(26) NOT NULL,
  -- **ייחודי, וזה מה שהופך את ההפקה לאידמפוטנטית**: הוובהוק של
  -- קארדקום מגיע יותר מפעם אחת, והסורק רץ במקביל. שתי חשבוניות על
  -- אותו תשלום הן תקלה שמתגלה אצל רואה החשבון.
  "payment_id"      CHAR(26) NOT NULL UNIQUE REFERENCES "payments"("id") ON DELETE RESTRICT,
  -- ספק הפקת המסמכים. עמודה ולא קבוע: החלפת ספק לא אמורה לשכתב
  -- שורות היסטוריות שהופקו אצל הקודם.
  "provider"        VARCHAR(20) NOT NULL DEFAULT 'linet',
  -- pending = ממתין להפקה · issued = הופק · failed = נכשל ומחכה לאדם
  "status"          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- **שני מזהים שונים, ובכוונה.** `document_id` הוא המזהה הפנימי
  -- אצל הספק — הוא ורק הוא פותח את המסמך (`/print/doc/{id}`).
  -- `document_number` הוא מספר ההקצאה שמופיע בספרים ובעיני הלקוח.
  -- שמירת ההקצאה בשדה אחד לשניהם הפכה כל מסמך ללא-נגיש ברגע
  -- שהקישור השמור פג (ביקורת Codex).
  "document_id"     VARCHAR(60),
  "document_number" VARCHAR(40),
  -- קישור למסמך אצל הספק, כשהוא מוחזר
  "document_url"    VARCHAR(500),
  -- הסכום שנגבה בפועל, ופירוקו. שלושתם נשמרים ולא מחושבים מחדש:
  -- שיעור המע"מ משתנה בחקיקה, ומסמך משנה שעברה חייב להישאר קריא
  -- לפי מה שהיה נכון אז.
  "gross_agorot"    INTEGER NOT NULL,
  "net_agorot"      INTEGER NOT NULL,
  "vat_agorot"      INTEGER NOT NULL,
  "vat_percent"     INTEGER NOT NULL,
  "description"     VARCHAR(200) NOT NULL,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  -- מתי לנסות שוב. NULL = לא ממתין לניסיון (הופק, או מוצה)
  "next_attempt_at" TIMESTAMPTZ,
  -- מה הספק אמר בכישלון האחרון — לתמיכה, לא ללקוח
  "last_error"      VARCHAR(300),
  "issued_at"       TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- הסורק שואל "מה ממתין להפקה עכשיו" — זו השאילתה החמה היחידה כאן
CREATE INDEX "invoices_due_idx" ON "invoices" ("status", "next_attempt_at");
-- מסך הפלטפורמה: מה קרה למשרד הזה, לפי סדר
CREATE INDEX "invoices_tenant_idx" ON "invoices" ("tenant_id", "created_at" DESC);
