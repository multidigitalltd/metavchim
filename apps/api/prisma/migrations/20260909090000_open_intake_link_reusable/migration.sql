-- ‎**קישור כללי שכבר נמצא בידי לקוחות — ניקוי מה שנתפס עליו.**
--
-- ‏עד עכשיו מילוי של קישור פתוח נתפס על **שורת הקישור עצמה**:
-- ‏‎`subject_id` הצביע על הכרטיס שנוצר, `contact_id` על איש הקשר,
-- ‏ו-`answers` נשאו את מה שהלקוח מילא. משם נבעו שתי תקלות:
--
-- ‏1. הלקוח **הבא** שמילא את אותו קישור נחת על הכרטיס של הראשון
-- ‏   ודרס את תשובותיו.
-- ‏2. חמור מזה — עמוד הטופס הציבורי בונה את מה שהלקוח רואה משלושת
-- ‏   השדות האלה. כלומר מי שקיבל את הקישור אחרי מישהו אחר נפתח לו
-- ‏   טופס עם **השם והפרטים של הלקוח הקודם** (דיווח המשתמש).
--
-- ‏הקוד כבר אינו כותב לשם: כל מילוי מקבל שורת שליחה משלו. ההגירה
-- ‏הזו מטפלת במה שכבר נכתב — קישורים שכבר מסתובבים בוואטסאפ, ואשר
-- ‏בלעדיה ימשיכו להדליף לכל מי שיפתח אותם.
--
-- ‎**מה שנתפס אינו נמחק — הוא עובר לשורה משלו.** הכרטיס שנוצר
-- ‏והתשובות שהלקוח מסר נשארים קשורים זה לזה בדיוק כמו קודם; מה
-- ‏שמשתנה הוא שהם כבר לא יושבים על הקישור.
INSERT INTO intake_requests
  (id, tenant_id, token, subject, subject_id, contact_id, side,
   channel, created_by, expires_at, status, submitted_at, submission_rev,
   property_id, answers, created_at, updated_at)
SELECT
  -- ‏מזהה חדש בצורת ULID. `id` הוא CHAR(26) ולא מפתח שנגזר ממשהו,
  -- ‏ולכן די ב-26 תווים ייחודיים; המקור הוא מזהה השורה עצמה, כדי
  -- ‏שהרצה חוזרת של ההגירה לא תייצר כפילות.
  upper(substr(md5('open_fill:' || r.id), 1, 26)),
  r.tenant_id,
  -- ‏טוקן משלה כי העמודה ייחודית. הוא לעולם אינו נשלח לאיש: מה
  -- ‏שבידי הלקוחות הוא הטוקן של הקישור, וזו שורת שליחה סגורה.
  substr(md5('t1:' || r.id) || md5('t2:' || r.id) || md5('t3:' || r.id), 1, 43),
  -- ‏מילוי של קונה נהפך לבקשה של כרטיס; מילוי של מוכר נשאר `open`,
  -- ‏כי אין כרטיס קונה לתלות בו. `channel` הוא מה שמבדיל בין השניים.
  CASE WHEN r.subject_id IS NOT NULL THEN 'buyer' ELSE 'open' END,
  r.subject_id,
  r.contact_id,
  r.side,
  'open_fill',
  r.created_by,
  r.expires_at,
  'submitted',
  COALESCE(r.submitted_at, r.updated_at),
  r.submission_rev,
  -- ‏טיוטת הנכס של המוכר עוברת איתו: בלעדיה המוכר הבא היה כותב
  -- ‏לתוך הטיוטה של הקודם.
  r.property_id,
  r.answers,
  COALESCE(r.submitted_at, r.created_at),
  now()
FROM intake_requests r
WHERE r.subject = 'open'
  -- ‏שורות מילוי שההגירה עצמה יצרה אינן חומר גלם להרצה הבאה
  AND r.channel <> 'open_fill'
  -- ‎**כל שדה רגיש, ולא רק הכרטיס.**
  --
  -- ‏‎`submitSeller` כותב `contact_id`, `answers` ו-`submitted_at` על
  -- ‏שורת הקישור אך **אינו** כותב `subject_id` — למוכר אין כרטיס
  -- ‏קונה. תנאי על `subject_id` בלבד היה מדלג בדיוק על השורות
  -- ‏האלה, כלומר משאיר את דליפת צד המוכר כפי שהיא: המוכר הבא
  -- ‏שפותח את הקישור מקבל את הברכה והטופס של הקודם (ביקורת Codex).
  AND (
    r.subject_id IS NOT NULL
    OR r.contact_id IS NOT NULL
    OR r.answers IS NOT NULL
    OR r.submitted_at IS NOT NULL
    OR r.property_id IS NOT NULL
  )
ON CONFLICT (id) DO NOTHING;

-- ‏ועכשיו הקישור חוזר להיות קישור: בלי כרטיס, בלי איש קשר, בלי
-- ‏תשובות, ובלי „כבר מילאת”. `status` חוזר ל-`sent` — ברירת המחדל
-- ‏של קישור חדש — ולכן הוא פעיל שוב, וזו בדיוק הכוונה.
--
-- ‎`revoked` אינו נגרר לכאן: קישור שהמשרד ביטל נשאר מבוטל, והניקוי
-- ‏אינו מחזיר אותו לחיים.
UPDATE intake_requests
SET
  subject_id    = NULL,
  contact_id    = NULL,
  answers       = NULL,
  submitted_at  = NULL,
  submission_rev = NULL,
  property_id   = NULL,
  -- ‏הצד חוזר לברירת המחדל: הקישור אינו „של מוכר” רק כי מוכר מילא
  -- ‏אותו פעם אחת, והבא בתור בוחר צד בעצמו.
  side          = 'buyer',
  status        = CASE WHEN status = 'revoked' THEN 'revoked' ELSE 'sent' END,
  updated_at    = now()
WHERE subject = 'open'
  AND channel <> 'open_fill'
  AND (
    subject_id IS NOT NULL
    OR contact_id IS NOT NULL
    OR answers IS NOT NULL
    OR submitted_at IS NOT NULL
    OR property_id IS NOT NULL
  );
