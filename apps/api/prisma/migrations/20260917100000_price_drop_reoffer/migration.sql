-- הצעה חוזרת אחרי הורדת מחיר (docs/03 — properties, interactions).
--
-- ‏הקונה שביקר ואמר „המחיר גבוה” הוא הסיכוי הכי טוב לסגירה ביום שהמחיר
-- ‏יורד — והוא היה נעלם: לא היה איפה לשמור מאיזה מחיר ירדו ומתי, ולא
-- ‏היה איך לדעת למי כבר פנו.
--
-- ‏על הנכס: המחיר הקודם ומועד השינוי (כל שינוי, לא רק ירידה — כדי
-- ‏שהכרטיס יוכל לומר „ירד מ-X ל-Y” ולא רק „ירד”).
-- ‏על האינטראקציה: `property_id` — פנייה לקונה **על נכס**. עד היום
-- ‏אינטראקציה ידעה רק את מי (ליד/קונה); „הצעתי לו שוב את ויטל 7”
-- ‏הוא מידע שנרשם על שניהם. אופציונלי, ואינו נוגע לכלל „הורה אחד בדיוק”.
-- ‏אינדקס על פגישות לפי נכס — השאילתות „מי ביקר בנכס” רצות עד היום
-- ‏על אינדקס המועד.

ALTER TABLE "properties"
  ADD COLUMN "previous_price_agorot" BIGINT,
  ADD COLUMN "price_changed_at" TIMESTAMP(3);

ALTER TABLE "interactions" ADD COLUMN "property_id" CHAR(26);
CREATE INDEX "interactions_tenant_id_property_id_created_at_idx"
  ON "interactions"("tenant_id", "property_id", "created_at");

CREATE INDEX "appointments_tenant_id_property_id_idx"
  ON "appointments"("tenant_id", "property_id");
