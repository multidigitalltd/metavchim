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
  -- מחוץ ל-RLS בכוונה:
  --   users/sessions — החיפוש בהן קורה לפני שקיים הקשר דייר (Login).
  --   outbox_events — טבלת תשתית: ה-Dispatcher חייב לקרוא חוצה-דיירים,
  --     ואף Endpoint משתמש לא נוגע בה. הבידוד נשמר אצל הצרכנים.
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'properties', 'property_media', 'buyers', 'leads',
    'interactions', 'voice_intakes', 'matches', 'offers',
    'notifications', 'audit_log'
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

-- הסרת RLS מ-outbox_events אם הופעל בגרסה קודמת (idempotent).
DROP POLICY IF EXISTS tenant_isolation ON outbox_events;
ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- דף הצעה ציבורי: גישה לשורת ההצעה היחידה שהטוקן שלה הוצג,
-- בלי הקשר דייר. האפליקציה מריצה SET LOCAL app.offer_token.
-- אין JOIN לנכס — הדף קורא רק את ה-Snapshot שבהצעה (docs/04 §7).
-- ============================================================
DROP POLICY IF EXISTS offer_public_read ON offers;
CREATE POLICY offer_public_read ON offers FOR SELECT
  USING (public_token = current_setting('app.offer_token', true));

DROP POLICY IF EXISTS offer_public_update ON offers;
CREATE POLICY offer_public_update ON offers FOR UPDATE
  USING (public_token = current_setting('app.offer_token', true))
  WITH CHECK (public_token = current_setting('app.offer_token', true));
