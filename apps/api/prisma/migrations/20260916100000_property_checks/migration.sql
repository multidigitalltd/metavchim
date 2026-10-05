-- תיק הבדיקות של הנכס — מה נבדק לפני שמחתימים (docs/03 — property_checks).
--
-- ‏מתווך שלוקח נכס לשיווק בודק נסח, שעבודים, תכנון, היתרים, חריגות
-- ‏ושוכר. עד היום זה נעשה בראש, בפתק או לא בכלל — וחריגת בנייה
-- ‏שמתגלה בשמאות הבנק, אחרי זיכרון דברים, היא הדרך הנפוצה ביותר
-- ‏שעסקה נופלת אחרי שכולם כבר לחצו ידיים.
--
-- ‎**שורה לכל (נכס, בדיקה) — ורק למה שסומן.** הרשימה עצמה סגורה
-- ‏בקוד (`PROPERTY_CHECKS` בחבילה המשותפת); בדיקה שאיש לא נגע בה
-- ‏אינה שורה, והמסך ממזג את הרשימה עם השורות. כך הוספת בדיקה
-- ‏לרשימה אינה מיגרציית נתונים, ונכס חדש אינו יוצר אחת-עשרה שורות
-- ‏ריקות.
--
-- ‎**בלי קובץ.** הנסח והאישורים נשמרים במסמכי הנכס (`signed_documents`);
-- ‏כאן רק המצב, ההערה, מי בדק ומתי.
--
-- ‏טבלת דייר רגילה: RLS, אינדקסים שפותחים ב-`tenant_id`, ובלי מפתח
-- ‏זר לנכס — כמו שאר לווייני הנכס (משימות, פגישות), שהמחיקה שלהם
-- ‏עוברת במחיקת המשרד ובמחיקת הנכס ולא ב-CASCADE שאיש אינו רואה.

CREATE TABLE "property_checks" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    -- PROPERTY_CHECK_KEYS
    "key" VARCHAR(40) NOT NULL,
    -- unchecked | ok | issue | na
    "status" VARCHAR(12) NOT NULL DEFAULT 'unchecked',
    "note" VARCHAR(500),
    -- מי סימן לאחרונה, ומתי — הביקורת של „מי אמר שזה תקין”
    "checked_by_user_id" CHAR(26),
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "property_checks_pkey" PRIMARY KEY ("id")
);

-- בדיקה אחת לכל נכס — הסימון החוזר מעדכן, לא מכפיל
CREATE UNIQUE INDEX "property_checks_tenant_id_property_id_key_key"
  ON "property_checks"("tenant_id", "property_id", "key");

ALTER TABLE property_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_checks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "property_checks" TO metavchim_app;
