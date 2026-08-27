-- מתי ההתאמה **נוצרה** — להבדיל ממתי חושבה לאחרונה.
--
-- ההצעות האוטומטיות במייל מבטיחות גבול הפעלה: „מכאן והלאה”. משרד
-- שמדליק את הדגל אינו אמור לדוור את כל המאגר ההיסטורי שלו, והמימוש
-- סינן `computed_at >= autoEmailOffersSince`.
--
-- אבל `computed_at` **זז**: `upsertMatch` דורס אותו בכל חישוב מחדש,
-- וחישוב מחדש קורה על כל עריכת נכס או קונה. כלומר התאמה בת שנתיים
-- שהנכס שלה עודכן אתמול קיבלה חותמת של אתמול, חצתה את הגבול, והפכה
-- ל„התאמה חדשה” שנשלחת ללקוח שיושב במאגר שנתיים (ביקורת Codex).
--
-- הגבול דורש חותמת שאינה זזה. `created_at` נכתב פעם אחת ואינו
-- מתעדכן — לא ב-`upsertMatch` ולא בשום מקום אחר.
--
-- **המילוי לאחור הוא `computed_at`, וזה הערך הנכון ולא פשרה:** על
-- שורה שלא חושבה מחדש הוא בדיוק מועד היצירה, ועל שורה שכן — הוא
-- מועד בעבר. מרגע ההקפאה אף אחת מהן אינה יכולה עוד לחצות גבול
-- הפעלה עתידי, וזו כל התכלית.
ALTER TABLE "matches" ADD COLUMN "created_at" TIMESTAMP(3);

UPDATE "matches" SET "created_at" = "computed_at" WHERE "created_at" IS NULL;

ALTER TABLE "matches" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "matches" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- הסינון של הסבב האוטומטי הוא (tenant, status, created_at), והוא רץ
-- כל עשר דקות לכל משרד שהדגל דלוק אצלו.
CREATE INDEX "matches_tenant_id_status_created_at_idx"
  ON "matches" ("tenant_id", "status", "created_at");
