-- ============================================================
-- Row-Level Security — שכבת הבידוד השלישית (docs/04 §2, ADR-003)
-- חלק מהמיגרציות המנוהלות: prisma migrate deploy מפעיל את זה בכל
-- סביבה, כולל פרודקשן נקי. אין צעד ידני.
--
-- כלל לעתיד: כל טבלה עסקית חדשה מוסיפה ENABLE/FORCE RLS + פוליסת
-- tenant_isolation בתוך המיגרציה שיוצרת אותה.
--
-- מחוץ ל-RLS בכוונה:
--   users/sessions   — תשתית אימות; החיפוש קורה לפני שקיים הקשר דייר.
--   outbox_events    — ה-Dispatcher קורא חוצה-דיירים; אין Endpoint שחושף.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'properties', 'property_media', 'buyers', 'leads',
    'interactions', 'voice_intakes', 'matches', 'offers',
    'notifications', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, t);
  END LOOP;
END $$;

-- דף הצעה ציבורי: גישה לשורת ההצעה היחידה שהטוקן שלה הוצג (docs/04 §7).
DROP POLICY IF EXISTS offer_public_read ON offers;
CREATE POLICY offer_public_read ON offers FOR SELECT
  USING (public_token = current_setting('app.offer_token', true));

DROP POLICY IF EXISTS offer_public_update ON offers;
CREATE POLICY offer_public_update ON offers FOR UPDATE
  USING (public_token = current_setting('app.offer_token', true))
  WITH CHECK (public_token = current_setting('app.offer_token', true));

-- ביטול RLS על outbox_events אם הופעל בגרסה מוקדמת (idempotent).
DROP POLICY IF EXISTS tenant_isolation ON outbox_events;
ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events DISABLE ROW LEVEL SECURITY;

-- audit_log הוא Append-Only: אין UPDATE/DELETE לתפקיד האפליקציה
-- (מותנה בקיום התפקיד — נוצר ע"י create_app_role.sql בהתקנה).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_log FROM metavchim_app';
  END IF;
END $$;
