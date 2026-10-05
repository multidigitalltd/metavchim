-- ‎**שיחות המנטור — מרשימה אחת ארוכה לשיחות שאפשר לחזור אליהן.**
--
-- ‏`mentor_messages` הייתה רשימה שטוחה אחת לכל מתווך. זה עבד כל עוד
-- ‏המסך הציג את הארבעים האחרונים, ונשבר ברגע שביקשו „לחזור לשיחה
-- ‏מלפני שבוע”: לא היה מה לחזור אליו, כי „שיחה” לא הייתה ישות.
--
-- ‎**מזהה השיחה הוא מזהה ההודעה הראשונה שבה** — ולכן אין טבלת
-- ‏שיחות. שם השיחה נגזר מהשאלה הראשונה (`mentorThreadTitle`),
-- ‏והמועד האחרון הוא ה-`MAX` שלה. כותרת שמורה בעמודה יכולה לחלוק על
-- ‏השיחה שהיא מתארת; נגזרת אינה יכולה. גם המזהה יוצא מזה זול: ULID
-- ‏של ההודעה הראשונה כבר קיים, ייחודי, וממוין כרונולוגית.
ALTER TABLE "mentor_messages" ADD COLUMN "thread_id" CHAR(26);

-- ‎**חלוקת מה שכבר נכתב, לפי אותו כלל בדיוק שיחלק את מה שייכתב.**
--
-- ‏שש שעות שקט פותחות שיחה חדשה (`MENTOR_THREAD_GAP_MS` ב-shared).
-- ‏ההגירה הזו אינה יכולה לייבא את הקבוע, ולכן הוא כתוב כאן פעם אחת
-- ‏ומסומן — מי שמזיז את המספר שם ולא כאן משנה רק את מה שייכתב מחר,
-- ‏וההיסטוריה תישאר חלוקה אחרת. בדיקה ב-shared נועלת את הערך.
--
-- ‏שלוש שכבות ולא אחת, כי חלון בתוך חלון אסור ב-SQL: מסמנים איפה
-- ‏מתחילה שיחה, סוכמים לסידורי, ואז לוקחים את המזהה הראשון בכל
-- ‏קבוצה. המיון הוא `(created_at, id)` בשלושתן — שתי הודעות באותה
-- ‏אלפית שנייה חייבות להתקבץ באותו סדר בכל שכבה, אחרת ה„ראשון”
-- ‏אינו אותו ראשון.
WITH marked AS (
  SELECT
    id, tenant_id, user_id, created_at,
    CASE
      WHEN LAG(created_at) OVER w IS NULL
        OR created_at - LAG(created_at) OVER w > INTERVAL '6 hours'
      THEN 1
      ELSE 0
    END AS starts
  FROM mentor_messages
  WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY created_at, id)
),
numbered AS (
  SELECT
    id, tenant_id, user_id, created_at,
    SUM(starts) OVER (
      PARTITION BY tenant_id, user_id
      ORDER BY created_at, id
      ROWS UNBOUNDED PRECEDING
    ) AS grp
  FROM marked
),
headed AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY tenant_id, user_id, grp
      ORDER BY created_at, id
    ) AS head
  FROM numbered
)
UPDATE mentor_messages m
SET thread_id = h.head
FROM headed h
WHERE m.id = h.id;

-- ‏אחרי המילוי אין שורה בלי שיחה, ולכן העמודה נאכפת. `NOT NULL`
-- ‏ולא ברירת מחדל: הודעה בלי שיחה היא בדיוק המצב שהטבלה הזו נועדה
-- ‏להוציא מהעולם, ועדיף שתיפול בכתיבה מאשר תיווצר יתומה.
ALTER TABLE "mentor_messages" ALTER COLUMN "thread_id" SET NOT NULL;

-- ‏האינדקס הקיים משרת „ההודעות האחרונות של המתווך”; זה משרת „פתח
-- ‏את השיחה הזו” ואת קיבוץ הרשימה.
CREATE INDEX "mentor_messages_tenant_id_user_id_thread_id_created_at_idx"
  ON "mentor_messages"("tenant_id", "user_id", "thread_id", "created_at");
