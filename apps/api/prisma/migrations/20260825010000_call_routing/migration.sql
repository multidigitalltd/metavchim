-- הניתוב שנצפה כשהשיחה הגיעה, ולא כשהיא הסתיימה.
--
-- 015 שולחת שלושה אירועים לשיחה אחת (`Calling` ⟵ `Answer` ⟵
-- `Hangup`), ורק האחרון כותב שורת שיחה. המספר הווירטואלי נפתר עד כה
-- באירוע האחרון בלבד — ולכן הגדרה שהועברה לנכס אחר באמצע השיחה, או
-- לפני `Hangup` שנשלח שוב באיחור, קבעה למפרע לאיזה נכס השיחה שייכת.
-- דוח שיוצא לבעל נכס אינו יכול להישען על תצורה שאולי כבר אינה זו
-- שהלקוח חייג אליה.
--
-- הטבלה מחזיקה שיחות **באוויר** בלבד: שורה נכתבת פעם אחת באירוע
-- הראשון, ונמחקת ברגע ששורת השיחה נכתבה מתוכה.
--
-- ‎`virtual_number_id IS NULL` פירושו „נצפה, ולא התאים אף מספר”, ולא
-- „לא נצפה” — הקיום של השורה הוא הנתון. בלי ההבחנה הזו מספר שהוגדר
-- אחרי תחילת השיחה היה נתפס בסופה.
CREATE TABLE "call_routings" (
    "tenant_id" CHAR(26) NOT NULL,
    "provider_call_id" VARCHAR(80) NOT NULL,
    "virtual_number_id" CHAR(26),
    "label" VARCHAR(60) NOT NULL DEFAULT '',
    "lead_source" VARCHAR(20) NOT NULL DEFAULT '',
    "assigned_to_user_id" CHAR(26),
    "property_id" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_routings_pkey" PRIMARY KEY ("tenant_id", "provider_call_id")
);

-- ניקוי היתומות לפי גיל — שיחה שה-`Hangup` שלה לא הגיע מעולם
CREATE INDEX "call_routings_tenant_id_created_at_idx"
  ON "call_routings" ("tenant_id", "created_at");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE call_routings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_routings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON call_routings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
