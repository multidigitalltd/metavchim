-- ‏נכסים לגיוס — מה שהמתווך רודף אחריו, ולא מה שיש לו.
--
-- ‏מודעה מיד2, שלט על מרפסת, טיפ משכן. הנכס **אינו של המשרד**:
-- ‏המתווך מתקשר לבעלים ומנסה לקבל את הייצוג. זה חצי מהעבודה שלו,
-- ‏ועד היום היא נוהלה באקסל או בראש.
--
-- ‎**למה טבלה נפרדת ולא עוד סטטוס על `properties`.**
--
-- ‏הכלל „לא מציעים נכס כזה” היה צריך להיאכף בכל מסלול קריאה:
-- ‏התאמות, רשת שיתופי הפעולה, הצעות לקונים, דפי נחיתה, רשימת
-- ‏הנכסים, המונים. בדיוק כך נראה הבאג של „נמכר” שתוקן לפני כן —
-- ‏הכלל נאכף בכתיבה והונח בקריאה, ושורה שברחה הופיעה במסך לתמיד.
--
-- ‏וכאן הדליפה חמורה יותר: הצעת נכס שהמשרד אינו מייצג לקונה היא
-- ‏הבטחה בלי כיסוי, ומול בעלים שלא חתם — חשיפה של ממש.
--
-- ‏שורה בטבלה אחת אינה יכולה לדלוף לשאילתה על טבלה אחרת. ההפרדה
-- ‏מבנית ולא משמעתית, ואין מה לזכור להחריג.

CREATE TABLE "recruitment_targets" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,

    -- ‏שלב במשפך הגיוס. ראו RECRUITMENT_STATUSES בחבילה המשותפת —
    -- ‏הרשימה חיה שם, כי גם המסך צריך את התוויות.
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',

    -- ‏מאיפה הנכס הגיע, ורשימה סגורה ולא טקסט חופשי: „יד2” ו„יד 2”
    -- ‏הם אותו מקור, ובטקסט חופשי הם שתי שורות בכל דוח.
    "source" VARCHAR(20) NOT NULL DEFAULT 'other',
    -- ‏הקישור למודעה המקורית. http/https בלבד, נאכף בסכימה —
    -- ‏הוא מרונדר כ-href, ו-javascript: כאן הוא הרצת קוד בדפדפן.
    "source_url" VARCHAR(2000),

    -- ‏שדות הנכס — אותם שדות של `properties`, כי זה אותו טופס.
    -- ‏ההמרה מעתיקה אותם אחד לאחד.
    "city" VARCHAR(80),
    "neighborhood" VARCHAR(80),
    "street" VARCHAR(120),
    "house_number" VARCHAR(10),
    "property_type" VARCHAR(30),
    "deal_type" VARCHAR(10),
    "rooms" DECIMAL(4,1),
    "area_sqm" INTEGER,
    "floor" INTEGER,
    "total_floors" INTEGER,
    "price_agorot" BIGINT,

    -- ‏בעל הנכס שמנסים לגייס. **טקסט ולא contact**: איש קשר במערכת
    -- ‏הוא לקוח של המשרד, ומי שטרם חתם אינו כזה. הוא הופך לאיש קשר
    -- ‏ברגע ההמרה, ולא לפניה.
    "owner_name" VARCHAR(120),
    "owner_phone" VARCHAR(20),

    "notes" VARCHAR(4000),
    -- ‏הסוכן שמטפל בגיוס. NULL = לא שויך.
    "agent_user_id" CHAR(26),

    -- ‏הנכס שנוצר בהמרה. **ייחודי בתוך הדייר**: זה מה שהופך המרה
    -- ‏כפולה לבלתי אפשרית ברמת המסד, ולא רק בקוד. לחיצה שנייה על
    -- ‏„המר לנכס שלי” לא תיצור נכס שני.
    "converted_property_id" CHAR(26),
    "converted_at" TIMESTAMP(3),

    "deleted_at" TIMESTAMP(3),
    "created_by" CHAR(26),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recruitment_targets_pkey" PRIMARY KEY ("id")
);

-- ‏הרשימה במסך: הדייר, ומיון לפי עדכון אחרון
CREATE INDEX "recruitment_targets_tenant_id_updated_at_idx"
  ON "recruitment_targets"("tenant_id", "updated_at" DESC);
-- ‏סינון לפי שלב — הלשוניות מעל הרשימה
CREATE INDEX "recruitment_targets_tenant_id_status_idx"
  ON "recruitment_targets"("tenant_id", "status");
-- ‏נכס אחד לכל שורה שגויסה, ולכל היותר
CREATE UNIQUE INDEX "recruitment_targets_tenant_id_converted_property_id_key"
  ON "recruitment_targets"("tenant_id", "converted_property_id")
  WHERE "converted_property_id" IS NOT NULL;

ALTER TABLE recruitment_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_targets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "recruitment_targets" TO metavchim_app;
