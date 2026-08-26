-- מסמכים שנחתמו מחוץ למערכת ונסרקו לתוכה.
--
-- **טבלה נפרדת מ-agreements, ולא סוג נוסף בתוכה.** שם, rendered_body
-- ו-body_hash הם NOT NULL ומשמעותם „זה הנוסח שהוצג ללקוח, וזו ההוכחה
-- שלא שונה”. לסריקה אין נוסח שהמערכת הציגה, ולכן כל ערך שהיינו
-- כותבים בשתי העמודות האלה היה הצהרה שאיננה נכונה — על השורה הזו,
-- ומכאן על כל מי שקורא את העמודה בלי לבדוק מאיזו שורה היא באה.
--
-- הגיבוב כאן (file_hash) טוען טענה צנועה ואמיתית: הבתים שהועלו הם
-- הבתים שנשמרו. הוא אינו טוען דבר על מה שכתוב בדף.
--
-- **מה כן זהה:** מסמך מסוג brokerage/exclusivity הוא הצהרת המתווך
-- שהלקוח חתם על הזמנה בכתב או על בלעדיות, והוא פותח את שער ההצעות
-- בדיוק כמו חתימה במערכת — חוק המתווכים דורש הזמנה בכתב חתומה, לא
-- הזמנה שנחתמה במסך מסוים. הבדיקה: AgreementsService.hasSigned.
CREATE TABLE signed_documents (
  id           CHAR(26)     PRIMARY KEY,
  tenant_id    CHAR(26)     NOT NULL,
  -- brokerage | exclusivity | other
  kind         VARCHAR(20)  NOT NULL,
  -- ריק = הלקוח נמחק מהמערכת. כמו ב-agreements, מסמך חתום אינו
  -- נמחק — הוא ראיה משפטית ובסיס הזכאות לדמי התיווך
  contact_id   CHAR(26),
  property_id  CHAR(26),
  -- השם כפי שהמתווך יראה אותו, אחרי ניקוי (shared — safeFileName)
  file_name    VARCHAR(200) NOT NULL,
  mime_type    VARCHAR(80)  NOT NULL,
  byte_size    INTEGER      NOT NULL,
  s3_key       VARCHAR(300) NOT NULL,
  -- SHA-256 של הקובץ כפי שהועלה
  file_hash    CHAR(64)     NOT NULL,
  -- מתי נחתם על הנייר, כפי שהמתווך מסר. DATE ולא TIMESTAMP: על דף
  -- חתום כתוב תאריך, לא שעה
  signed_on    DATE,
  -- מי חתם, כפי שהמתווך מסר. אין לנו דרך לאמת, ולכן השדה נושא את
  -- שמו של מי שהצהיר עליו — ראו uploaded_by
  signer_name  VARCHAR(120),
  note         VARCHAR(500),
  uploaded_by  CHAR(26),
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- שתי הדרכים שבהן המסמך נדרש: הלשונית בכרטיס (לפי נכס או לפי לקוח)
-- ו-hasSigned (לפי לקוח + סוג).
CREATE INDEX signed_documents_tenant_property_idx
  ON signed_documents (tenant_id, property_id);
CREATE INDEX signed_documents_tenant_contact_kind_idx
  ON signed_documents (tenant_id, contact_id, kind);

ALTER TABLE signed_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE signed_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON signed_documents
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- **אין כאן פוליסת טוקן ציבורי**, בשונה מ-agreements: לשורה הזו אין
-- קישור חתימה ואין מסך שהלקוח פותח. כל גישה עוברת דרך משתמש מחובר.
