-- דחיפת התראות לוואטסאפ.
--
-- `whatsapp_at` נפרד מ-`pushed_at`: הערוצים עצמאיים (פוש דורש מפתחות
-- VAPID, וואטסאפ דורש טוקן של Meta), וסימון משותף היה גורם לערוץ אחד
-- לבלוע התראות שהשני מעולם לא ראה.
--
-- `last_inbound_at` הוא חלון 24 השעות של Meta: הודעה יזומה בטקסט
-- חופשי מותרת רק בתוכו, ומחוצה לו נדרשת תבנית מאושרת.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "whatsapp_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "whatsapp_chats" ADD COLUMN "last_inbound_at" TIMESTAMP(3);

-- AlterTable
-- עד מתי כל סוכן קיבל. סימון על ההתראה בלבד היה גורם למי שקיבל
-- אותה לקבל שוב בכל סריקה כשנמען אחר שלה נכשל.
ALTER TABLE "whatsapp_chats" ADD COLUMN "notified_through" TIMESTAMP(3);

-- CreateIndex
-- הסורק שולף בדיוק את "טרם נשלחו, ומהזמן האחרון" בכל דייר.
CREATE INDEX "notifications_tenant_whatsapp_idx"
  ON "notifications" ("tenant_id", "whatsapp_at", "created_at");
