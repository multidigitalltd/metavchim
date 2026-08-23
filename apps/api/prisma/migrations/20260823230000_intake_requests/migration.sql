-- „מלאו לי מה אתם מחפשים” — טופס שהלקוח ממלא בעצמו.
--
-- הדרישות של קונה נאספות היום בשיחה, והמתווך מקליד תוך כדי. מה
-- שנופל בין הכיסאות נופל שם לתמיד: תקציב שנאמר ולא נרשם, שכונה
-- שנשכחה. הקישור מעביר את ההקלדה ללקוח — שגם יודע את התשובות טוב
-- יותר, וגם ממלא אותן כשנוח לו ולא בזמן שהמתווך על הקו.
--
-- הטוקן הוא ההרשאה, כמו בדף הנחיתה ובדף ההצעה.

CREATE TABLE "intake_requests" (
    "id"           CHAR(26)     NOT NULL,
    "tenant_id"    CHAR(26)     NOT NULL,
    "token"        CHAR(43)     NOT NULL,
    "subject"      VARCHAR(10)  NOT NULL,
    "subject_id"   CHAR(26)     NOT NULL,
    "contact_id"   CHAR(26)     NOT NULL,
    "status"       VARCHAR(12)  NOT NULL DEFAULT 'sent',
    "channel"      VARCHAR(20)  NOT NULL DEFAULT 'manual',
    "created_by"   CHAR(26),
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "opened_at"    TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "answers"      JSONB,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intake_requests_subject_check" CHECK ("subject" IN ('lead', 'buyer')),
    CONSTRAINT "intake_requests_status_check"
      CHECK ("status" IN ('sent', 'opened', 'submitted', 'revoked'))
);

CREATE UNIQUE INDEX "intake_requests_token_key" ON "intake_requests"("token");
CREATE INDEX "intake_requests_tenant_id_subject_subject_id_idx"
  ON "intake_requests"("tenant_id", "subject", "subject_id");
CREATE INDEX "intake_requests_tenant_id_status_idx"
  ON "intake_requests"("tenant_id", "status");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intake_requests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- הפוליסה הציבורית: חשיפת השורה **היחידה** שהטוקן שלה הוצג, בלי
-- הקשר דייר. אותו דפוס בדיוק כמו `app.landing_token`.
--
-- SELECT בלבד, ורק על הטבלה הזו. כל מה שאחריה — שם המשרד, שם
-- הלקוח, הדרישות הקיימות והכתיבה עצמה — נעשה תחת הקשר דייר מפורש
-- שנגזר מהשורה הזו. כך משטח הגישה הציבורי הוא שורה אחת בטבלה
-- אחת, ולא פוליסת כתיבה על טבלאות הלקוחות.
CREATE POLICY intake_request_public ON intake_requests FOR SELECT
  USING (token = current_setting('app.intake_token', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON intake_requests TO metavchim_app;
