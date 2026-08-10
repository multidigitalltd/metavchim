-- ביקוש משותף עשיר יותר: שכונות מבוקשות (מועתקות מדרישות הקונה,
-- אנונימיות כמו הערים) + הערת התיאור החופשי שכבר קיימת בסכימה
-- (notes) מחוברת סוף-סוף לזרימת השיתוף.

-- AlterTable
ALTER TABLE "shared_demands" ADD COLUMN "neighborhoods" TEXT[] NOT NULL DEFAULT '{}';
