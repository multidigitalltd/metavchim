-- קישור מפורש בין מספר וואטסאפ לחשבון.
--
-- הזהות בערוץ הוואטסאפ נגזרה עד כה ממספר הטלפון בלבד: השוואת ספרות
-- מול שדה `phone` של משתמש פעיל. זה עובד, וזו גם הבעיה — איש מעולם
-- לא **אמר** שהמספר הזה שלו. מספר שהוחזר לשוק וניתן למישהו אחר פותח
-- לבעליו החדש את כל מאגר המשרד, ואותו מספר אצל שני משתמשים הוכרע
-- בשקט לפי „מי התחבר לאחרונה”.
--
-- הטבלה **אינה תחת RLS**, ויש בה `tenant_id` — כמו `users`: היא
-- נקראת בנתיב הציבורי של ה-Webhook, ברגע שבו הדייר עדיין אינו ידוע,
-- והיא עצמה מה שמגלה אותו. פוליסה כאן הייתה חוסמת את השאילתה שנועדה
-- להכריע לאיזה משרד הפנייה שייכת.
--
-- המספר מוצפן ברמת האפליקציה כמו כל PII במנוחה (docs/04), עם HMAC
-- לחיפוש — אותו דפוס של אנשי הקשר, השיחות והמתעניינים.

-- CreateTable
CREATE TABLE "whatsapp_links" (
    "id" CHAR(26) NOT NULL,
    "wa_id_hash" CHAR(64) NOT NULL,
    "wa_id_encrypted" TEXT NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    -- code = המתווך הוכיח בעצמו; phone = קישור שנוצר מהשוואת ספרות
    -- לחשבון יחיד, ונדרש לאימות מפורש כשמשהו בו משתנה
    "source" VARCHAR(10) NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- מתי מישהו **הוכיח** שהמספר שלו. שימוש שוטף אינו ראיה: מכשיר
    -- גנוב משתמש בדיוק כמו הבעלים.
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    -- מנותק, ולא נמחק: „היה מחובר ונותק” הוא מידע שהמתווך צריך
    -- לראות, ובלעדיו ניתוק נראה כמו „מעולם לא היה”
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(20),

    CONSTRAINT "whatsapp_links_pkey" PRIMARY KEY ("id")
);

-- מספר אחד, קישור פעיל אחד. שורות מנותקות אינן מפריעות לקישור חדש.
CREATE UNIQUE INDEX "whatsapp_links_active_wa_id_key"
    ON "whatsapp_links"("wa_id_hash") WHERE "revoked_at" IS NULL;

-- „איזה מכשיר מחובר אליי” — השאילתה של מסך ההגדרות
CREATE INDEX "whatsapp_links_user_id_idx" ON "whatsapp_links"("user_id");

-- ומהצד השני: חשבון אחד, מכשיר פעיל אחד.
--
-- זו האכיפה של מה שהמסך מבטיח („המכשיר שמחובר”, ביחיד). הניתוק
-- שבקוד מספיק לרצף פעולות, אבל לא לשתי בקשות מקבילות: שתיהן
-- מנתקות אפס שורות ושתיהן מוסיפות, ואינדקס על המספר בלבד אינו
-- מונע זאת. האינדקס הזה הופך את המרוץ לשגיאה שאפשר לנסות שוב.
CREATE UNIQUE INDEX "whatsapp_links_active_user_key"
    ON "whatsapp_links"("user_id") WHERE "revoked_at" IS NULL;

-- מחיקת משתמש גוררת את הקישור: קישור בלי חשבון הוא מפתח למאגר
-- שאין לו בעלים
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_links" TO metavchim_app;
