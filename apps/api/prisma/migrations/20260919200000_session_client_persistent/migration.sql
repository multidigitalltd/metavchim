-- Session של האפליקציה לנייד: מי נושא את הטוקן, והאם הוא מתמשך.
--
-- client — web | mobile. שער „חיבור אחד לחשבון” ב-web סופר רק דפדפנים:
-- הטלפון של אותו אדם אינו „חיבור נוסף” שדורש לבחור ביניהם.
--
-- persistent — Session של 30 יום שמתגלגל בכל פעילות, במקום 12 השעות
-- של הדפדפן. רק לאפליקציה, ורק כשהמכשיר עצמו נעול: מי שהטלפון שלו
-- דורש קוד או טביעת אצבע אינו צריך להקליד סיסמה בכל בוקר.
ALTER TABLE sessions
  ADD COLUMN client     VARCHAR(10) NOT NULL DEFAULT 'web',
  ADD COLUMN persistent BOOLEAN     NOT NULL DEFAULT false;
