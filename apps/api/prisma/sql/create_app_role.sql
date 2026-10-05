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
/*
 * ‎**וגם לרצפים — השורה שנשכחה כאן והייתה מאז בסקריפט של הייצור.**
 *
 * ‏שתי שורות ה-GRANT שמעל חלות על מה שקיים **ברגע ההרצה**, ושורת
 * ‏ברירת המחדל כיסתה טבלאות בלבד. לכן טבלה חדשה ממיגרציה עתידית
 * ‏עבדה מעצמה, ורצף חדש — לא: תפקיד האפליקציה קיבל
 * ‎`permission denied for sequence`‎ ברגע שעמודה עם
 * ‎`DEFAULT nextval(...)`‎ נכתבה.
 *
 * ‏זה אינו תרחיש תיאורטי: ‎`tenant_customer_no_seq`‎ נוצר במיגרציה
 * ‏ובלי השורה הזו כל יצירת משרד — הרשמה עצמית וגם פתיחה ממסך
 * ‏הפלטפורמה — נפלה על מסד שכבר הוקצה (ביקורת Codex).
 *
 * ‎`infra/postgres/init-app-role.sh` — שמצהיר על עצמו כמקבילה של
 * ‏הקובץ הזה — כבר החזיק את השורה. ההפרש בין השניים הוא הבאג
 * ‏עצמו, ולכן ‎`verify:iac`‎ נועל אותם זה לזה מעכשיו.
 */
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO metavchim_app;

-- ============================================================
-- הטבלאות ה-Append-Only — **כאן, ולא רק במיגרציות שיצרו אותן.**
--
-- כל אחת מהן מבטלת את ההרשאה בתוך המיגרציה שלה, וזה לא הספיק:
-- הסקריפט הזה רץ **אחרי** המיגרציות (ראו סדר המשימות ב-CI), ושורת
-- ה-GRANT שמעל מחזירה UPDATE ו-DELETE על **כל** הטבלאות. כלומר כל
-- הרצת הקצאה החזירה בשקט את מה שהמיגרציות ביטלו, ורק `audit_log`
-- שרד — כי רק הוא בוטל שוב כאן.
--
-- זה נבדק על מסד חי: אחרי migrate + הסקריפט הזה, ל-`metavchim_app`
-- היו UPDATE ו-DELETE מלאים על `credit_ledger` ועל `payout_ledger`,
-- בעוד שלושה מקומות בקוד מצהירים שהן מוגנות. מחיקת חשבון אפילו
-- נמנעת מלגעת בהן בנימוק שהמחיקה "הייתה נופלת על permission denied".
--
-- למה זה משנה: אלה ספרי החשבונות של הכסף (קרדיטים ושקלים) ויומן
-- הביקורת. תוקף שהשיג את הרשאות האפליקציה יכול היה לשכתב מאזן או
-- למחוק עקבות — וזו בדיוק ההנחה שהבקרה הזו קיימת כדי לשלול.
--
-- `to_regclass` ולא REVOKE ישיר: הסקריפט רץ גם על מסד שטרם עברו בו
-- כל המיגרציות, וטבלה שאינה קיימת הייתה מפילה אותו תחת ON_ERROR_STOP.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  -- יומן הביקורת וספרי הכסף — docs/03 §3
  FOREACH t IN ARRAY ARRAY['audit_log', 'credit_ledger', 'payout_ledger']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM metavchim_app', t);
    END IF;
  END LOOP;

  /*
   * שרשור חדר העסקה — Append-Only בעריכה בלבד.
   *
   * DELETE **נשאר**, בשונה מהשלוש שמעליו: מחיקת חשבון חייבת לנקות
   * את השרשור, ובלעדיה הוא היה נשאר חי אצל המשרד השני עם שמות
   * הסוכנים שנמחקו. מה שאסור הוא לשכתב למפרע מה שהצד השני כבר קרא.
   */
  IF to_regclass('public.coop_deal_messages') IS NOT NULL THEN
    REVOKE UPDATE ON coop_deal_messages FROM metavchim_app;
  END IF;
END $$;
