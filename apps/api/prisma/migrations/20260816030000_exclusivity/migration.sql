-- ============================================================
-- תיק הבלעדיות: תקופה מנוהלת ופעולות שיווק מתועדות.
--
-- `properties.exclusive_until` קיים בסכמה מהיום הראשון ומעולם לא
-- נקרא בשום מסך. הסכם הבלעדיות נחתם דרך המערכת, אבל התקופה עצמה
-- נשמרה כטקסט חופשי בתוך גוף המסמך. כלומר המשרד חתם על בלעדיות
-- והמערכת לא ידעה מתי היא נגמרת — ובוודאי לא ידעה על סעיף 9(ב2),
-- שמסיים אותה בתום שליש מהתקופה כשלא תועדו פעולות שיווק.
-- ============================================================

-- ------------------------------------------------------------
-- תקופת בלעדיות אחת.
--
-- טבלה נפרדת ולא שתי עמודות על הנכס: לנכס יש היסטוריה של בלעדיויות
-- (חודשה, פקעה, ניתנה שוב אחרי חצי שנה), ופעולות השיווק נתלות
-- בתקופה מסוימת — פעולה משנה שעברה אינה מקיימת את הדרישה של התקופה
-- הנוכחית. `properties.exclusive/exclusive_until` נשארים כמטמון
-- לרשימות ולסינון, ומתעדכנים מהתקופה הפעילה.
-- ------------------------------------------------------------
CREATE TABLE property_exclusivities (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    -- ההסכם החתום שממנו נולדה התקופה, כשיש כזה. NULL = הוזנה ידנית
    -- (בלעדיות שנחתמה על נייר לפני שהמשרד עבר למערכת).
    "agreement_id" CHAR(26),
    -- apartment | other — שתי המדרגות של סעיף 9, ולא סוג הנכס שלנו
    "subject" VARCHAR(10) NOT NULL,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE NOT NULL,
    -- האם סוכם על "פעולת שיווק אחרת" (פריט 7 בתקנות). בלי הסכמה
    -- מפורשת הפריט אינו נספר, ולכן זה שדה ולא הנחה.
    "agreed_custom_action" BOOLEAN NOT NULL DEFAULT false,
    -- מתי התקופה חדלה להיות הנוכחית, ולמה.
    -- expired | cancelled | sold | replaced
    "ended_at" TIMESTAMP(3),
    "end_reason" VARCHAR(20),
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_exclusivities_pkey" PRIMARY KEY ("id")
);

-- **בלעדיות פתוחה אחת לכל נכס, ברמת המסד.**
--
-- שתי בלעדיויות חופפות על אותו נכס אינן מצב שצריך להתמודד איתו
-- בקוד — הן מצב שאסור שייווצר. תקופה שהסתיימה (מכל סיבה, כולל
-- פקיעה טבעית) מקבלת `ended_at`, ואז הנכס פנוי לבלעדיות חדשה.
CREATE UNIQUE INDEX "property_exclusivities_open_once"
    ON property_exclusivities("property_id") WHERE "ended_at" IS NULL;

CREATE INDEX "property_exclusivities_tenant_ends" ON property_exclusivities("tenant_id", "ends_at");

-- ------------------------------------------------------------
-- פעולת שיווק מתועדת.
--
-- `source_key` הוא מפתח האירוע שיצר אותה בזיהוי אוטומטי
-- (`offer:<id>`, `viewing:<id>`), והאינדקס הייחודי החלקי עליו הוא
-- מה שמונע כפילות כשאותו אירוע מעובד פעמיים. רישום ידני אינו נושא
-- מפתח, ולכן אינו מוגבל — מתווך שתלה שני שלטים רשאי לרשום שניים.
-- ------------------------------------------------------------
CREATE TABLE marketing_actions (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "exclusivity_id" CHAR(26) NOT NULL,
    "property_id" CHAR(26) NOT NULL,
    -- signage | client_database | daily_newspaper | local_newspaper |
    -- viewing_invitation | broker_network | agreed_other
    "kind" VARCHAR(30) NOT NULL,
    -- auto | manual
    "source" VARCHAR(10) NOT NULL,
    "source_key" VARCHAR(120),
    "detail" VARCHAR(300),
    -- קישור לאסמכתה (מודעה, צילום השלט). ראיה, לא קישוט.
    "evidence_url" VARCHAR(500),
    -- לשיתוף מתווכים בלבד: כמה נחשפו. פחות מחמישה אינו נספר.
    "broker_count" INTEGER,
    "performed_at" TIMESTAMP(3) NOT NULL,
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_actions_source_once"
    ON marketing_actions("exclusivity_id", "source_key") WHERE "source_key" IS NOT NULL;

CREATE INDEX "marketing_actions_exclusivity_performed"
    ON marketing_actions("exclusivity_id", "performed_at");

-- ------------------------------------------------------------
-- RLS — בידוד דייר לשתי הטבלאות, במיגרציה שיוצרת אותן.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_exclusivities', 'marketing_actions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO metavchim_app', t);
  END LOOP;
END $$;
