-- נוסחי ההסכמים של המשרד: הזמנה בכתב (הסכם תיווך) והסכם בלעדיות.
--
-- שורה נוצרת רק כשהמשרד מתאים את הנוסח לעצמו. אין שורה ⇒ המערכת
-- משתמשת בנוסח ברירת המחדל שבקוד (packages/shared/logic/agreement-
-- template.ts), כך שמשרד חדש עובד ביום הראשון בלי להגדיר דבר,
-- ו"שחזור לברירת המחדל" הוא פשוט מחיקת השורה.
CREATE TABLE agreement_templates (
  id         CHAR(26)     PRIMARY KEY,
  tenant_id  CHAR(26)     NOT NULL,
  -- brokerage | exclusivity
  kind       VARCHAR(20)  NOT NULL,
  body       TEXT         NOT NULL,
  updated_by CHAR(26),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT agreement_templates_tenant_kind_key UNIQUE (tenant_id, kind)
);

-- כלל הריפו: כל טבלה עסקית חדשה מקבלת בידוד דייר במיגרציה שיוצרת
-- אותה (docs/04 §2)
ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agreement_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
