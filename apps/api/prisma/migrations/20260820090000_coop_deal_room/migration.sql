-- ============================================================
-- חדר העסקה — סביבת העבודה המשותפת של שני משרדים בשיתוף פעולה.
--
-- שתי טבלאות: החדר עצמו והשרשור שבתוכו. שתיהן דו-צדדיות באותו דגם
-- שכבר קיים ב-coop_offers/coop_interests — שני המשרדים ורק הם.
-- ============================================================

-- מי הציע. בלי זה החדר יודע אילו שני **משרדים** שותפים, אבל לא את מי
-- להרים אליו טלפון — וזו כל התועלת שבו. `Buyer.ownerUserId` נותן את
-- הצד שמביא את הקונה; לצד המציע לא היה עד כה שום מקום שרושם אותו.
-- NULL בשורות קיימות, והחדר נופל אז לבעל המשרד — כמו במיילים.
ALTER TABLE coop_offers ADD COLUMN created_by CHAR(26);
ALTER TABLE coop_interests ADD COLUMN created_by CHAR(26);

CREATE TABLE coop_deals (
  id                CHAR(26) PRIMARY KEY,
  origin_type       VARCHAR(10) NOT NULL,
  origin_id         CHAR(26) NOT NULL,
  listing_tenant_id CHAR(26) NOT NULL,
  buyer_tenant_id   CHAR(26) NOT NULL,
  property_id       CHAR(26) NOT NULL,
  buyer_id          CHAR(26) NOT NULL,
  listing_user_id   CHAR(26),
  buyer_user_id     CHAR(26),
  commission_split  SMALLINT NOT NULL,
  stage             VARCHAR(20) NOT NULL DEFAULT 'contact',
  closed_note       VARCHAR(200),
  closed_at         TIMESTAMP(3),
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP(3) NOT NULL
);

-- חיבור אחד = חדר אחד. בלי האילוץ הזה לחיצה כפולה על "מעניין"
-- (או שתי לשוניות פתוחות) הייתה פותחת שני חדרים לאותה עסקה, ושני
-- המשרדים היו מנהלים אותה בשני מקומות בלי לדעת.
CREATE UNIQUE INDEX coop_deals_origin ON coop_deals (origin_id);
CREATE INDEX coop_deals_listing_side ON coop_deals (listing_tenant_id, stage, updated_at);
CREATE INDEX coop_deals_buyer_side ON coop_deals (buyer_tenant_id, stage, updated_at);

CREATE TABLE coop_deal_messages (
  id         CHAR(26) PRIMARY KEY,
  deal_id    CHAR(26) NOT NULL,
  author_tenant_id CHAR(26) NOT NULL,
  user_id    CHAR(26),
  kind       VARCHAR(20) NOT NULL DEFAULT 'message',
  body       VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX coop_deal_messages_thread ON coop_deal_messages (deal_id, created_at);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE coop_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE coop_deals FORCE ROW LEVEL SECURITY;

-- קריאה: שני הצדדים בלבד
CREATE POLICY coop_deal_select ON coop_deals FOR SELECT
  USING (
    listing_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  );

-- יצירה: רק בידי צד שהוא עצמו שותף לחדר. השרת יוצר את החדר בהקשר
-- הדייר שאישר את החיבור, ולכן הוא תמיד אחד משני הצדדים; הפוליסה
-- מוודאת שאי אפשר ליצור חדר בין שני משרדים זרים.
CREATE POLICY coop_deal_insert ON coop_deals FOR INSERT
  WITH CHECK (
    listing_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  );

-- עדכון (מעבר שלב): שני הצדדים.
--
-- כאן, בשונה מ-coop_offers, **שניהם** מעדכנים ובכוונה: סיור נקבע
-- בידי מי שמביא את הקונה, וחוזה נחתם אצל מי שמחזיק את הנכס. חדר
-- שרק צד אחד יכול להזיז בו את הסטטוס הוא חדר שהצד השני מדווח בו
-- בטלפון.
CREATE POLICY coop_deal_update ON coop_deals FOR UPDATE
  USING (
    listing_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    listing_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  );

-- מחיקה: כל צד. נדרש למחיקת חשבון מלאה — תחת FORCE RLS, בלי פוליסה
-- ה-deleteMany היה מוחק אפס שורות בשקט ומשאיר את החדר חי אצל השני.
CREATE POLICY coop_deal_delete ON coop_deals FOR DELETE
  USING (
    listing_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  );

ALTER TABLE coop_deal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE coop_deal_messages FORCE ROW LEVEL SECURITY;

-- הגישה לשרשור נגזרת מהחדר ולא נשמרת שוב על השורה: `author_tenant_id`
-- הוא מי **כתב**, ולולא ה-EXISTS היה כל צד רואה רק את מה שהוא עצמו
-- כתב — כלומר שרשור שאינו שרשור.
CREATE POLICY coop_deal_message_select ON coop_deal_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM coop_deals d
      WHERE d.id = coop_deal_messages.deal_id
        AND (
          d.listing_tenant_id = current_setting('app.tenant_id', true)
          OR d.buyer_tenant_id = current_setting('app.tenant_id', true)
        )
    )
  );

-- כתיבה: רק בשם עצמך, ורק לחדר שאתה שותף לו.
--
-- `author_tenant_id` ולא `tenant_id`, ובכוונה: העמודה אומרת מי כתב,
-- לא למי השורה שייכת. בכל שאר המערכת `tenant_id` פירושו בידוד, ושם
-- כזה כאן היה גורר את הטבלה לסוויטת ה-Cross-Tenant כטבלה מבודדת —
-- שם היא הייתה נראית כדליפה בדיוק משום שהיא מתפקדת נכון.
CREATE POLICY coop_deal_message_insert ON coop_deal_messages FOR INSERT
  WITH CHECK (
    author_tenant_id = current_setting('app.tenant_id', true)
    AND EXISTS (
      SELECT 1 FROM coop_deals d
      WHERE d.id = coop_deal_messages.deal_id
        AND (
          d.listing_tenant_id = current_setting('app.tenant_id', true)
          OR d.buyer_tenant_id = current_setting('app.tenant_id', true)
        )
    )
  );

-- אין פוליסת UPDATE, ובכוונה: השרשור הוא Append-Only כמו יומן
-- הביקורת. משרד שיכול לערוך למפרע מה שהצד השני כבר קרא הופך את
-- החדר מרישום להצעה.

-- מחיקה: כל צד לחדר — נדרש למחיקת חשבון, מאותו נימוק כמו בחדר עצמו.
CREATE POLICY coop_deal_message_delete ON coop_deal_messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM coop_deals d
      WHERE d.id = coop_deal_messages.deal_id
        AND (
          d.listing_tenant_id = current_setting('app.tenant_id', true)
          OR d.buyer_tenant_id = current_setting('app.tenant_id', true)
        )
    )
  );

-- העדכון על השרשור נשלל גם ברמת ההרשאה, לא רק בהיעדר פוליסה:
-- פוליסה שמישהו יוסיף בעתיד בטעות לא תוכל לעקוף את זה.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'metavchim_app') THEN
    EXECUTE 'REVOKE UPDATE ON coop_deal_messages FROM metavchim_app';
  END IF;
END $$;
