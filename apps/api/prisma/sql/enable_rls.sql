-- ============================================================
-- Row-Level Security — שכבת הבידוד השלישית (docs/04 §2, ADR-003)
-- מורץ כחלק מכל מיגרציה על טבלאות חדשות.
--
-- האפליקציה מריצה בכל טרנזקציה:
--   SET LOCAL app.tenant_id = '<ULID>';
-- (מנוהל אוטומטית ב-PrismaService — לא ידנית בקוד עסקי)
-- ============================================================

-- תפקיד האפליקציה אינו בעל הטבלאות ואינו BYPASSRLS.
-- ALTER ROLE metavchim_app NOBYPASSRLS;

DO $$
DECLARE
  t text;
BEGIN
  -- users/sessions אינן כאן בכוונה: החיפוש בהן קורה לפני שקיים הקשר דייר
  -- (Login). אין בהן PII של לקוחות קצה; סינון הדייר נאכף בשכבת האפליקציה.
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'properties', 'property_media',
    'buyers', 'leads', 'matches', 'offers', 'outbox_events', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, t);
  END LOOP;
END $$;

-- audit_log הוא Append-Only: אין UPDATE/DELETE גם לתפקיד האפליקציה.
-- REVOKE UPDATE, DELETE ON audit_log FROM metavchim_app;
