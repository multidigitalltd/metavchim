-- מוניטין ההפניות, מפורק לממדים.
--
-- ממוצע אחד מסתיר את ההבדל בין משרד שסוטה מעט בכל ממד לבין משרד
-- שמדייק לחלוטין ברצינות ובזמינות ומנפח בשיטתיות את התקציב. השני
-- אומר משהו שאי אפשר לסמוך עליו דווקא בשדה שקובע אם הליד שווה את
-- המחיר, ומי שעומד לשלם עמלת הפניה זכאי לראות את זה.
CREATE TABLE "referral_reputation_dimensions" (
    "tenant_id" CHAR(26) NOT NULL,
    "dimension" VARCHAR(20) NOT NULL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_reputation_dimensions_pkey"
      PRIMARY KEY ("tenant_id", "dimension")
);

/*
 * אותה מדיניות בדיוק כמו `referral_reputation`, ומאותו נימוק:
 * הטבלה מכילה מספרים בלבד — לא שם לקוח, לא הערה ולא מזהה הפניה —
 * ולכן חשיפתה לרשת היא חשיפת המוניטין שהלוח קיים כדי להציג.
 *
 * הכתיבה נשארת נעולה למשרד עצמו. העדכון בפועל מגיע מהקשר המשרד
 * המפנה בתוך טרנזקציית האישור, בדיוק כמו הצבירה המצרפית.
 */
ALTER TABLE referral_reputation_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_reputation_dimensions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referral_reputation_dimensions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY network_read ON referral_reputation_dimensions FOR SELECT
  USING (current_setting('app.network_read', true) = 'on');

/*
 * אין מילוי לאחור.
 *
 * הפירוט נגזר מהפער בין ההצהרה לאישור, ושניהם שמורים —
 * `shared_leads.client_scores` ו-`lead_referral_ratings.scores` —
 * כך שמילוי לאחור היה אפשרי טכנית. הוא אינו נכון: המיגרציה
 * שהפכה את המוניטין ממדידת איכות למדידת דיוק אפסה את המונים
 * (20260819090000), ולכן כל אישור שקדם לה מתאר סקאלה אחרת.
 * פירוט שמסכם ציונים משתי סקאלות גרוע מהיעדר פירוט.
 */
