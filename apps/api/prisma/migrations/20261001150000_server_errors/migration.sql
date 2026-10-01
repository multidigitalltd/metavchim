-- ‏שגיאות השרת, מקובצות ליום — מקור הסיכום היומי למנהלי הפלטפורמה
-- ‏(apps/api/src/core/server-errors.ts). שורה לכל סוג שגיאה ביום: מאיפה,
-- ‏החתימה (בלי מזהים, מספרים וכתובות מייל — serverErrorSignature), כמה,
-- ‏ומתי לראשונה ולאחרונה. טבלת פלטפורמה: אין בה tenant_id ולכן אין RLS.
CREATE TABLE IF NOT EXISTS "server_errors" (
  "day" DATE NOT NULL,
  "source" VARCHAR(120) NOT NULL,
  "signature" VARCHAR(300) NOT NULL,
  "count" INTEGER NOT NULL,
  "first_at" TIMESTAMPTZ(3) NOT NULL,
  "last_at" TIMESTAMPTZ(3) NOT NULL,
  "notified_at" TIMESTAMPTZ(3),
  CONSTRAINT "server_errors_pkey" PRIMARY KEY ("day", "source", "signature")
);

-- ‏הרשאות תפקיד האפליקציה — ראו 20260902140000_mentor_goals.
GRANT SELECT, INSERT, UPDATE, DELETE ON "server_errors" TO metavchim_app;
