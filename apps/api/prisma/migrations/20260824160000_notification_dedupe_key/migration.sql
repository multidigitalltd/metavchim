-- מפתח ייחודיות לאירוע שההתראה מדווחת עליו.
--
-- 015 שולחת `Calling` פעמיים לאותה שיחה, וההתראה על צלצול נכתבת
-- לפני ששורת השיחה קיימת — ולכן הבדיקה הקודמת ("האם כבר יש שיחה
-- עם ה-callid הזה") חיפשה שורה שבשלב הזה לעולם אינה קיימת.
--
-- ב-Postgres שורות עם NULL אינן מתנגשות באילוץ ייחודיות, ולכן
-- ההתראות הקיימות — שכולן ללא מפתח — נשארות חוקיות, וגם כל התראה
-- עתידית שאין לה אירוע חיצוני להיתלות בו.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" VARCHAR(120);

CREATE UNIQUE INDEX "notifications_tenant_id_dedupe_key_key"
  ON "notifications" ("tenant_id", "dedupe_key");
