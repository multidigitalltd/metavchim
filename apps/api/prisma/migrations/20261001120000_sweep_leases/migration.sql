-- ‏חכירת סבבים מחזוריים — ראו apps/api/src/core/sweeps.ts.
--
-- ‏שורה לכל סבב: מי מחזיק אותו ועד מתי. מופע API שמתעורר בזמן שהחכירה
-- ‏בתוקף אצל מופע אחר מדלג, כך שסבב אינו רץ פעמיים בתקופה אחת. טבלת
-- ‏פלטפורמה: אין בה tenant_id ולכן אין RLS.
CREATE TABLE IF NOT EXISTS "sweep_leases" (
  "name" VARCHAR(60) NOT NULL,
  "holder" VARCHAR(120) NOT NULL,
  "until" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sweep_leases_pkey" PRIMARY KEY ("name")
);

-- ‏הרשאות תפקיד האפליקציה — מאותה סיבה כמו ב-20260902140000_mentor_goals:
-- ‏ALTER DEFAULT PRIVILEGES אינו מכסה מסד שהוקם לפניו.
GRANT SELECT, INSERT, UPDATE, DELETE ON "sweep_leases" TO metavchim_app;
