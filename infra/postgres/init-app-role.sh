#!/bin/sh
# רץ אוטומטית בעליית ה-DB הראשונה (docker-entrypoint-initdb.d) — יוצר
# את תפקיד האפליקציה לפני שמיגרציות ה-API רצות: חלקן מפנות אליו
# (GRANT/REVOKE) ונכשלות אם אינו קיים. מקביל ל-create_app_role.sql של
# הפיתוח; ההרשאות פר-טבלה (audit_log append-only) חיות במיגרציות עצמן.
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD חסר — הגדירו ב-.env.production}"

psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'EOSQL'
SELECT format('CREATE ROLE metavchim_app LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') \gexec
GRANT USAGE ON SCHEMA public TO metavchim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO metavchim_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO metavchim_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO metavchim_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO metavchim_app;
EOSQL
