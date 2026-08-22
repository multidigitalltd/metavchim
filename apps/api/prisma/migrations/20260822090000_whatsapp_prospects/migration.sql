-- מתעניינים שכתבו לסוכן ואינם משתמשים במערכת.
--
-- הטבלה **אינה תחת RLS** ואין בה tenant_id — במכוון: מי שכותב אינו
-- שייך לאף משרד, וזו בדיוק הסיבה שהוא נרשם כאן. היא נכתבת מהנתיב
-- הציבורי של ה-Webhook, לפני שיש הקשר דייר כלשהו, בדיוק כמו
-- telephony_webhook_hits.
--
-- מה שנשמר הוא המינימום: מספר, מתי נראה, ומתי נענה. אין תוכן הודעה
-- ואין שם — המטרה היחידה היא לא לשלוח את אותו מענה שיווקי פעמיים.

-- CreateTable
CREATE TABLE "whatsapp_prospects" (
    "id" CHAR(26) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "replied_at" TIMESTAMP(3),
    "messages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "whatsapp_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_prospects_phone_key" ON "whatsapp_prospects"("phone");
