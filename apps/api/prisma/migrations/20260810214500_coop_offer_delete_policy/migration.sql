-- פוליסת DELETE ל-coop_offers — לא הייתה קיימת, ולכן אף צד לא יכול
-- היה למחוק הצעת שת"פ (תחת FORCE RLS, בלי פוליסה = אסור). הצורך עלה
-- במחיקת חשבון מלאה: משרד שנמחק חייב להיעלם גם מהצעות שהציע ושקיבל.
-- ההיקף זהה לקריאה — כל צד רשאי למחוק הצעה שהוא שותף לה.
CREATE POLICY coop_delete ON coop_offers FOR DELETE
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  );
