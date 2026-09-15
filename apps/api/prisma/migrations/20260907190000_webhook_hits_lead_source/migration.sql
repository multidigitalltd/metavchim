-- ‏היומן חדל להיות של המרכזייה בלבד.
--
-- ‏פנייה לוובהוק הלידים עם מפתח שאינו מוכר נדחתה ב-404 ולא הותירה
-- ‏שום עקבה — בדיוק העיוורון שבשבילו נבנה יומן המרכזיות. מקור שני
-- ‏עם טבלה משלו, מסך משלו, סינון משלו וריקון משלו היה מכפיל את
-- ‏הכול כדי לענות על אותה שאלה עצמה.
ALTER TABLE "telephony_webhook_hits" RENAME TO "webhook_hits";

-- ‏מאיזה נתיב הגיעה הפנייה. השורות הקיימות כולן של המרכזייה, ולכן
-- ‏ברירת המחדל היא גם ההיסטוריה הנכונה ולא ניחוש.
ALTER TABLE "webhook_hits"
  ADD COLUMN "source" VARCHAR(12) NOT NULL DEFAULT 'telephony';

-- ‏„הפניות של המרכזייה” ו„הפניות של הלידים” הן שתי שאלות נפרדות,
-- ‏ושתיהן נשאלות לפי זמן.
CREATE INDEX "webhook_hits_source_idx"
  ON "webhook_hits" ("source", "received_at" DESC);

-- ‏שמות האינדקסים נגררים עם השם הישן; מיושרים כדי ששאילתת אבחון
-- ‏על הטבלה לא תחזיר שמות שמפנים לטבלה שאינה קיימת.
ALTER INDEX "telephony_webhook_hits_received_at_idx"
  RENAME TO "webhook_hits_received_at_idx";
ALTER INDEX "telephony_webhook_hits_tenant_received_idx"
  RENAME TO "webhook_hits_tenant_received_idx";
ALTER INDEX "telephony_webhook_hits_call_idx"
  RENAME TO "webhook_hits_call_idx";
ALTER INDEX "telephony_webhook_hits_peer_idx"
  RENAME TO "webhook_hits_peer_idx";
ALTER INDEX "telephony_webhook_hits_pkey" RENAME TO "webhook_hits_pkey";
