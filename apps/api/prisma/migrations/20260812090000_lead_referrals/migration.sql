-- הפניית לקוח במקום "מכירת ליד": התמורה נקבעת בידי המשרד המפנה,
-- אחוז ממנה הוא עמלת פלטפורמה, הסיבה חובה, ושני הצדדים מדרגים.

-- הסיבה. הפניות שקדמו לשדה מקבלות 'unspecified' — הן באמת פורסמו
-- בלי סיבה, והמסך יאמר זאת ולא יציג סיבה שלא נבחרה.
ALTER TABLE "shared_leads" ADD COLUMN "reason" VARCHAR(30) NOT NULL DEFAULT 'unspecified';
ALTER TABLE "shared_leads" ADD COLUMN "reason_detail" VARCHAR(200);

-- עמלת הפלטפורמה מצולמת ברגע הפרסום, כמו התמורה עצמה: שינוי שיעור
-- העמלה לא ישנה הפניה שכבר פורסמה. 0 בהפניות הישנות — לא נגבתה בהן.
ALTER TABLE "shared_leads" ADD COLUMN "platform_fee_credits" INTEGER NOT NULL DEFAULT 0;

-- המשרד הקולט מחפש את ההפניות שקלט — לדירוג ולהיסטוריה
CREATE INDEX "shared_leads_buyer_tenant_id_sold_at_idx" ON "shared_leads"("buyer_tenant_id", "sold_at");

-- קריאה למשרד הקולט. קודם הייתה קריאת רשת ל-active בלבד, ולכן
-- ברגע שההפניה נקלטה היא נעלמה מעיני מי ששילם עליה — כולל היכולת
-- לדרג אותה. הקריאה מוגבלת לשורות שהוא עצמו קלט.
CREATE POLICY receiver_read ON shared_leads FOR SELECT
  USING (buyer_tenant_id = current_setting('app.tenant_id', true));

-- דירוג הדדי על הפניה שנקלטה
CREATE TABLE "lead_referral_ratings" (
    "id" CHAR(26) NOT NULL,
    "shared_lead_id" CHAR(26) NOT NULL,
    "seller_tenant_id" CHAR(26) NOT NULL,
    "buyer_tenant_id" CHAR(26) NOT NULL,
    "rater_tenant_id" CHAR(26) NOT NULL,
    "rater_role" VARCHAR(10) NOT NULL,
    "score" SMALLINT NOT NULL,
    "comment" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_referral_ratings_pkey" PRIMARY KEY ("id")
);

-- דירוג אחד לכל צד בכל הפניה — אכיפה במסד ולא רק בקוד
CREATE UNIQUE INDEX "lead_referral_ratings_shared_lead_id_rater_tenant_id_key"
  ON "lead_referral_ratings"("shared_lead_id", "rater_tenant_id");

CREATE INDEX "lead_referral_ratings_seller_tenant_id_created_at_idx"
  ON "lead_referral_ratings"("seller_tenant_id", "created_at");

-- הציון חייב להיות בסקאלה גם אם קוד עתידי ישכח לבדוק
ALTER TABLE "lead_referral_ratings"
  ADD CONSTRAINT "lead_referral_ratings_score_range" CHECK ("score" BETWEEN 1 AND 5);

-- RLS: **שני הצדדים להפניה בלבד.** ההערה שמשרד כותב על משרד אינה
-- נחשפת לרשת לעולם — אין כאן מדיניות network_read, וזו בדיוק הסיבה
-- שהמוניטין יושב בטבלה נפרדת של מספרים.
ALTER TABLE lead_referral_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_referral_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY party_access ON lead_referral_ratings
  USING (
    seller_tenant_id = current_setting('app.tenant_id', true)
    OR buyer_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    -- כותב רק בשמו שלו, ורק אם הוא באמת צד בהפניה
    rater_tenant_id = current_setting('app.tenant_id', true)
    AND (
      seller_tenant_id = current_setting('app.tenant_id', true)
      OR buyer_tenant_id = current_setting('app.tenant_id', true)
    )
  );

-- מוניטין ההפניות: מספרים בלבד, ולכן אפשר לחשוף אותם לרשת
CREATE TABLE "referral_reputation" (
    "tenant_id" CHAR(26) NOT NULL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_reputation_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE referral_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_reputation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referral_reputation
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
-- הלוח מציג את הדירוג של כל משרד מפנה לפני שמשלמים לו
CREATE POLICY network_read ON referral_reputation FOR SELECT
  USING (current_setting('app.network_read', true) = 'on');
