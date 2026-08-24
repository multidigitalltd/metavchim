-- קישור טופס שנוצר לפני שיש כרטיס.
--
-- המתווך פוגש לקוח שאינו במאגר ורוצה לשלוח לו טופס דרישות מיד,
-- בלי לפתוח לו קודם כרטיס ידני. בקישור כזה אין עדיין כרטיס ואין
-- איש קשר — הם נוצרים כשהלקוח שולח, מהפרטים שהוא עצמו מילא.
--
-- שתי העמודות היו NOT NULL ולכן לא יכלו לתאר את המצב הזה. הן
-- נשארות מלאות בכל הקישורים הקיימים ובכל קישור לכרטיס; רק
-- ‎subject = 'open'‎ מתחיל בלעדיהן, ומקבל אותן בשליחה.
ALTER TABLE "intake_requests" ALTER COLUMN "subject_id" DROP NOT NULL;
ALTER TABLE "intake_requests" ALTER COLUMN "contact_id" DROP NOT NULL;

-- והערך `open` עצמו: `subject` נסגר ב-CHECK על שני הכרטיסים
-- בלבד, ולכן קישור פתוח נדחה במסד לפני שהגיע לשום היגיון.
-- שחרור ה-NOT NULL בלעדיו הוא חצי מיגרציה — הטור מוכן לקבל את
-- המצב החדש, והשורה שמתארת אותו אינה יכולה להיכתב.
ALTER TABLE "intake_requests" DROP CONSTRAINT "intake_requests_subject_check";
ALTER TABLE "intake_requests"
  ADD CONSTRAINT "intake_requests_subject_check"
  CHECK ("subject" IN ('lead', 'buyer', 'open'));

-- הכרטיס ואיש הקשר חובה בכל קישור שאינו פתוח.
--
-- שחרור ה-NOT NULL נועד למצב אחד בלבד, והוא פתח אותו לכולם: באג
-- בקוד היה יכול ליצור קישור לליד בלי ליד, והצד הציבורי היה מגיע
-- לשורה שאינה מצביעה על דבר — ואז `targetBuyerId` מחפש קונה לפי
-- `contact_id` ריק. האילוץ מחזיר את הכלל הישן לכל מי שהוא עדיין
-- חל עליו, ומשאיר את החריג לערך אחד מפורש.
ALTER TABLE "intake_requests"
  ADD CONSTRAINT "intake_requests_card_required"
  CHECK (
    "subject" = 'open'
    OR ("subject_id" IS NOT NULL AND "contact_id" IS NOT NULL)
  );
