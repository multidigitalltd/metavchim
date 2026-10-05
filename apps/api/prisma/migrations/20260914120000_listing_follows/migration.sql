-- „עקוב אחרי הנכס” — הכיוון השני של אותה רשת.
--
-- ‏‎`demand_follows` פתר מחצית מהבעיה: מתווך שראה ביקוש שאין לו
-- ‏נכס עבורו יכול לעקוב ולדעת כשייכנס. המחצית השנייה נשארה מבוי
-- ‏סתום — מתווך רואה נכס טוב ברשת, אין לו קונה מתאים באותו רגע,
-- ‏וזה נגמר שם. גם כשהקונה נכנס אליו שבוע אחר כך, איש אינו חוזר
-- ‏לגלול מודעות ישנות כדי לבדוק.
--
-- ‎**אותו דגם בדיוק**, ובכוונה: אותו אילוץ ייחודי, אותם אינדקסים,
-- ‏אותה מדיניות RLS, ואותה החלטה שאין מפתח זר. שתי טבלאות ולא
-- ‏עמודת „כיוון” אחת: השורה מצביעה על ישות אחרת לגמרי
-- ‏(‏`shared_listings` ולא `shared_demands`), ועמודה משותפת עם
-- ‏מפתח פולימורפי הייתה מוחקת את ההבדל הזה מהסכימה ומחזירה אותו
-- ‏כבדיקה בקוד.
--
-- ‎**המעקב הוא של האדם ולא של המשרד** (`user_id` באילוץ הייחודי):
-- ‏הסוכן שלחץ הוא זה שיקבל את ההתראה, כי הקונה שיתאים הוא הקונה
-- ‏שלו. מעקב משרדי היה שולח לכל הצוות הודעה על נכס שרק אחד מהם
-- ‏עוסק בו, ואחרי שבוע כולם היו מכבים התראות.

CREATE TABLE "listing_follows" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    -- הסוכן שלחץ, והנמען של ההתראה
    "user_id" CHAR(26) NOT NULL,
    -- הנכס ברשת. בלי מפתח זר: shared_listings תחת RLS של המשרד
    -- **המפרסם**, ומפתח זר מטבלה של משרד אחר היה נאכף חוצה-דיירים
    -- ומדליף את עצם הקיום. הניקוי נעשה בסורק, שרואה את שני הצדדים.
    "listing_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listing_follows_pkey" PRIMARY KEY ("id")
);

-- מעקב אחד לכל (משרד, סוכן, נכס) — לחיצה חוזרת אינה יוצרת שני
-- מעקבים, ושתי לחיצות מקבילות אינן צריכות לקרוא זו את זו
CREATE UNIQUE INDEX "listing_follows_tenant_id_user_id_listing_id_key"
  ON "listing_follows"("tenant_id", "user_id", "listing_id");
-- „אחרי מה אני עוקב” — השאילתה של המסך, ושל הסורק בכל דייר
CREATE INDEX "listing_follows_tenant_id_created_at_idx"
  ON "listing_follows"("tenant_id", "created_at");
-- „מי עוקב אחרי הנכס הזה” — הניקוי כשפרסום נסגר
CREATE INDEX "listing_follows_listing_id_idx" ON "listing_follows"("listing_id");

ALTER TABLE listing_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_follows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON listing_follows
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "listing_follows" TO metavchim_app;
