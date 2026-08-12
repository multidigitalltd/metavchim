-- חסימת מודול למשרד בידי הפלטפורמה.
--
-- עמודה על tenants ולא טבלה נפרדת: הרשימה נקראת בכל אימות Session
-- יחד עם שורת המשרד שממילא נטענת שם, וטבלה נפרדת הייתה מוסיפה
-- שאילתה לכל בקשה. tenants נמצאת מחוץ ל-RLS (רישום הדיירים), כמו
-- plans ו-platform_settings.
ALTER TABLE "tenants" ADD COLUMN "blocked_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
