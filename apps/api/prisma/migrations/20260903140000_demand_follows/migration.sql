-- „עקוב אחרי הביקוש” — מה שקורה כשאין לך נכס מתאים היום.
--
-- ‏רשת השיתופים מציגה שני סוגי ביקושים: כאלה שיש לך נכס עבורם,
-- ‏וכאלה שאין. הראשונים הם עבודה — „הצע נכס זה”, לחיצה אחת.
-- ‏**השניים לא היו כלום**: מתווך קרא, ראה שאין לו מה להציע, וזה
-- ‏נגמר שם — גם כשהנכס שהיה מתאים בדיוק נכנס למאגר שלו שבוע אחר
-- ‏כך. איש אינו חוזר לגלול ביקושים ישנים כדי לבדוק.
--
-- ‏השורה הזו הופכת את הביקוש הזה מ„אין לי מה לעשות” ל„אני אדע”.
--
-- ‎**המעקב הוא של האדם ולא של המשרד** (`user_id` באילוץ הייחודי):
-- ‏סוכן שלחץ הוא זה שיקבל את ההתראה. מעקב משרדי היה שולח לכל הצוות
-- ‏הודעה על נכס שרק אחד מהם עוסק בו, ואחרי שבוע כולם היו מכבים
-- ‏התראות. שני סוכנים באותו משרד יכולים לעקוב אחרי אותו ביקוש.

CREATE TABLE "demand_follows" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    -- הסוכן שלחץ, והנמען של ההתראה
    "user_id" CHAR(26) NOT NULL,
    -- הביקוש ברשת. בלי מפתח זר: shared_demands תחת RLS של המשרד
    -- **המפרסם**, ומפתח זר מטבלה של משרד אחר היה נאכף חוצה-דיירים
    -- ומדליף את עצם הקיום. הניקוי נעשה בסורק, שרואה את שני הצדדים.
    "demand_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demand_follows_pkey" PRIMARY KEY ("id")
);

-- מעקב אחד לכל (משרד, סוכן, ביקוש) — לחיצה חוזרת אינה יוצרת שני
-- מעקבים, ושתי לחיצות מקבילות אינן צריכות לקרוא זו את זו
CREATE UNIQUE INDEX "demand_follows_tenant_id_user_id_demand_id_key"
  ON "demand_follows"("tenant_id", "user_id", "demand_id");
-- „אחרי מה אני עוקב” — השאילתה של המסך, ושל הסורק בכל דייר
CREATE INDEX "demand_follows_tenant_id_created_at_idx"
  ON "demand_follows"("tenant_id", "created_at");
-- „מי עוקב אחרי הביקוש הזה” — הניקוי כשביקוש נסגר
CREATE INDEX "demand_follows_demand_id_idx" ON "demand_follows"("demand_id");

ALTER TABLE demand_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_follows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON demand_follows
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "demand_follows" TO metavchim_app;
