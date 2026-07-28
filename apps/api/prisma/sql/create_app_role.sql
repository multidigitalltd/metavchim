-- ============================================================
-- תפקיד האפליקציה — לא Superuser, לא בעל הטבלאות, לא BYPASSRLS.
-- זה התפקיד שה-API מתחבר איתו; פוליסות ה-RLS חלות עליו במלואן.
-- מיגרציות רצות עם משתמש הבעלים הנפרד (docs/04 §2).
--
-- חובה לספק סיסמה — אין ברירת מחדל (ביקורת Codex, PR #1):
--   psql "$DIRECT_DATABASE_URL" \
--     -c "SET app.provision_password = '<סיסמה-חזקה>'" \
--     -f prisma/sql/create_app_role.sql
-- ============================================================

DO $$
DECLARE
  pw text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    pw := current_setting('app.provision_password', true);
    IF pw IS NULL OR length(pw) < 16 THEN
      RAISE EXCEPTION 'app.provision_password חסר או קצר מ-16 תווים — ראו הוראות בראש הקובץ';
    END IF;
    EXECUTE format('CREATE ROLE metavchim_app LOGIN PASSWORD %L', pw);
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO metavchim_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO metavchim_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO metavchim_app;

-- audit_log הוא Append-Only — אין UPDATE/DELETE גם לאפליקציה (docs/03 §3).
REVOKE UPDATE, DELETE ON audit_log FROM metavchim_app;
