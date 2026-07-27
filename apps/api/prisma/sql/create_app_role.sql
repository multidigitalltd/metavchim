-- ============================================================
-- תפקיד האפליקציה — לא Superuser, לא בעל הטבלאות, לא BYPASSRLS.
-- זה התפקיד שה-API מתחבר איתו; פוליסות ה-RLS חלות עליו במלואן.
-- מיגרציות רצות עם משתמש הבעלים הנפרד (docs/04 §2).
--
-- שימוש (הסיסמה נקבעת בהתקנה, לא כאן):
--   psql -v app_password='...' -f create_app_role.sql
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    CREATE ROLE metavchim_app LOGIN PASSWORD 'metavchim_app_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO metavchim_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO metavchim_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO metavchim_app;

-- audit_log הוא Append-Only — אין UPDATE/DELETE גם לאפליקציה (docs/03 §3).
REVOKE UPDATE, DELETE ON audit_log FROM metavchim_app;
