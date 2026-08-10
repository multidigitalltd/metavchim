-- גישת תמיכה בהסכמה — המודל של "המשתמש לוחץ, התמיכה נכנסת".
--
-- אין למנהל הפלטפורמה דלת קבועה לנתוני המשרדים. הדלת נפתחת רק
-- כשבעל המשרד לוחץ עליה בעצמו, והיא נסגרת מעצמה אחרי שעה. שני
-- השדות יושבים על הדייר כי הם *ההסכמה שלו*, לא הגדרת פלטפורמה.
ALTER TABLE tenants ADD COLUMN support_access_until TIMESTAMP(3);
ALTER TABLE tenants ADD COLUMN support_access_granted_by CHAR(26);

-- Session של תמיכה מסומן בכתובת של איש התמיכה שנכנס. הסימון הוא מה
-- שמאפשר לאכוף את החלון בכל בקשה: ביטול ההסכמה הורג את ה-Session
-- מיד, לא בפקיעה הבאה.
ALTER TABLE sessions ADD COLUMN support_admin_email VARCHAR(254);
