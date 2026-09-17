-- ‎**דירוג בעל מקצוע — תמיד בשם** (docs/16 §2).
--
-- ‏האנונימיות היא הפיצ'ר של הפורום, אבל לא של הדירוג: שאלה בעילום שם
-- ‏פוגעת לכל היותר בשואל, ואילו דירוג בעילום שם הוא אמירה על **העסק
-- ‏של מישהו אחר** שאין מולה עם מי לדבר. מי שמדרג עומד מאחורי מה
-- ‏שכתב — בשמו ובשם המשרד.
--
-- ‏המיגרציה עושה שלושה דברים, בעסקה אחת:

-- ‏1. ‎**כל דירוג שאינו יכול לשאת שם — יורד.**
-- ‏
-- ‏   התנאי אחד, כי הכלל אחד: `user_id IS NULL` פירושו שאין ממי
-- ‏   לגזור שם, ו-`rater_key` הוא חתם HMAC חד-כיווני שאין ממנו
-- ‏   זהות לשחזר. שתי דרכים מגיעות למצב הזה:
-- ‏
-- ‏   * דירוג שנשמר **בעילום שם** — `user_id` מעולם לא נכתב.
-- ‏   * דירוג שנשמר **בשם**, אבל המשתמש נמחק מאז. המפתח הזר הוא
-- ‏     ‎`ON DELETE SET NULL`, ולכן `user_id` כבר התאפס — ולפני
-- ‏     העמודה החדשה גם המשרד לא נשמר בשום מקום. שורה כזו הייתה
-- ‏     מוצגת „משתמש שנמחק” בלי משרד, כלומר בדיוק מה שהכלל בא
-- ‏     למנוע (ביקורת Codex, P2).
-- ‏
-- ‏   מהיום זה לא יקרה שוב: `rater_tenant_id` נשמר בשורה, ומחיקת
-- ‏   משתמש משאירה „משתמש שנמחק” **עם** המשרד שמאחוריו.
-- ‏
-- ‏   המונים של הרשומה מתוקנים באותה פקודה — אחרת הממוצע היה נשאר
-- ‏   על ספירה שכבר אינה קיימת.
WITH removed AS (
    DELETE FROM "forum_ratings"
    WHERE "anonymous" OR "user_id" IS NULL
    RETURNING "listing_id", "score"
), totals AS (
    SELECT "listing_id", COUNT(*)::int AS n, SUM("score")::int AS s
    FROM removed
    GROUP BY "listing_id"
)
UPDATE "forum_listings" l
SET "rating_count" = GREATEST(l."rating_count" - t.n, 0),
    "rating_sum"   = GREATEST(l."rating_sum" - t.s, 0)
FROM totals t
WHERE l."id" = t."listing_id";

-- ‏2. ‎**העמודה יורדת**, ולא רק הבחירה במסך: כל עוד היא קיימת, שורה
-- ‏   חדשה יכולה להיכתב בלעדיה.
ALTER TABLE "forum_ratings" DROP COLUMN "anonymous";

-- ‏3. ‎**המשרד נשמר בשורה, בנפרד מהמשתמש.** `user_id` מתאפס במחיקת
-- ‏   משתמש (SET NULL), ובלי עמודה משלו היה נמחק גם שם המשרד —
-- ‏   כלומר „משתמש שנמחק” בלי שום הקשר. אותו דפוס בדיוק כמו
-- ‏   `author_tenant_id` ב-`forum_threads`.
--
-- ‏השם הוא `rater_tenant_id` ולא `tenant_id` במכוון: הטבלה מחוץ
-- ‏ל-RLS (ראו כותרת `20260915090000_forum`), ועמודת `tenant_id`
-- ‏הייתה מצהירה על שיוך לדייר שאין כאן.
ALTER TABLE "forum_ratings" ADD COLUMN "rater_tenant_id" CHAR(26);

ALTER TABLE "forum_ratings"
    ADD CONSTRAINT "forum_ratings_rater_tenant_id_fkey"
    FOREIGN KEY ("rater_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL;

UPDATE "forum_ratings" r
SET "rater_tenant_id" = u."tenant_id"
FROM "users" u
WHERE u."id" = r."user_id";
