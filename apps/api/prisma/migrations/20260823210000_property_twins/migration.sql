-- נכסים תאומים — „עוד כמה כאלה יש לי”.
--
-- לקוח מתעניין בדירה אחת, והמתווך יודע שיש לו עוד שתיים באותו
-- סגנון. בזמן השיחה הוא צריך להיזכר בהן, ולעיתים קרובות לא נזכר.
-- הקישור מוגדר מראש ומופיע בכרטיס כשהוא על הקו.
--
-- שורה אחת לזוג, בסדר קנוני (property_a_id < property_b_id). הקשר
-- סימטרי מעצם משמעותו, והסדר הוא מה שהופך את האינדקס הייחודי
-- למחסום: בלעדיו „א׳,ב׳” ו„ב׳,א׳” הן שתי שורות חוקיות לאותו קשר,
-- והכרטיס היה מציג את אותו נכס פעמיים.

CREATE TABLE "property_twins" (
    "id"            CHAR(26)     NOT NULL,
    "tenant_id"     CHAR(26)     NOT NULL,
    "property_a_id" CHAR(26)     NOT NULL,
    "property_b_id" CHAR(26)     NOT NULL,
    "note"          VARCHAR(200),
    "created_by"    CHAR(26),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_twins_pkey" PRIMARY KEY ("id"),
    -- הסדר הקנוני נאכף במסד ולא רק בקוד: שורה הפוכה שנכתבה בטעות
    -- (ייבוא, תיקון ידני) הייתה עוקפת בשקט את האינדקס הייחודי.
    -- הבדיקה גם פוסלת נכס שהוא תאום של עצמו.
    --
    -- COLLATE "C" ולא ההשוואה שברירת המחדל: הקוד ממיין ב-JavaScript,
    -- כלומר לפי קוד התו, ואילו bpchar משווה לפי ה-collation של המסד.
    -- לאלפבית של ULID שתי השיטות מסכימות היום, אבל „מסכימות היום”
    -- אינה ערובה: מסד שיוקם עם collation אחר היה דוחה שורה תקינה
    -- לחלוטין ב-500. כאן שני הצדדים מדברים באותה שפה.
    CONSTRAINT "property_twins_canonical_order"
      CHECK ("property_a_id" COLLATE "C" < "property_b_id" COLLATE "C")
);

CREATE UNIQUE INDEX "property_twins_tenant_id_property_a_id_property_b_id_key"
  ON "property_twins"("tenant_id", "property_a_id", "property_b_id");
-- שני אינדקסים ולא אחד: הקריאה מכרטיס נכס שואלת „היכן אני”, והנכס
-- יכול לשבת בכל אחד משני הצדדים.
CREATE INDEX "property_twins_tenant_id_property_a_id_idx"
  ON "property_twins"("tenant_id", "property_a_id");
CREATE INDEX "property_twins_tenant_id_property_b_id_idx"
  ON "property_twins"("tenant_id", "property_b_id");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE property_twins ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_twins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_twins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON property_twins TO metavchim_app;
