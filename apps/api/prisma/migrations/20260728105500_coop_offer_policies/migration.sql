-- פיצול פוליסת coop_offers לפי פעולה (התגלה באימות E2E):
-- הסוכנות המקבלת היא שמעדכנת סטטוס (מעוניין/דחייה) — פוליסה אחת עם
-- WITH CHECK על הצד המציע חסמה אותה.
DROP POLICY IF EXISTS coop_two_sided ON coop_offers;

-- קריאה: שני הצדדים בלבד
CREATE POLICY coop_select ON coop_offers FOR SELECT
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  );

-- יצירה: רק הסוכנות המציעה
CREATE POLICY coop_insert ON coop_offers FOR INSERT
  WITH CHECK (from_tenant_id = current_setting('app.tenant_id', true));

-- עדכון (תגובה להצעה): רק הסוכנות המקבלת
CREATE POLICY coop_update ON coop_offers FOR UPDATE
  USING (to_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (to_tenant_id = current_setting('app.tenant_id', true));
