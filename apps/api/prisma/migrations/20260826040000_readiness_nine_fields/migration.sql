-- מוכנות הנכס עברה לתשעה שדות (SPEC-3b §4), והציון הוא `filled / 9`
-- בדיוק במקום ניקוד משוקלל. `readiness_score` נכתב רק בשמירת נכס,
-- ולכן בלי מילוי חוזר כאן היו נכסים קיימים נושאים ציון של נוסחה
-- שכבר אינה קיימת — ו-`AnalyticsService` סופר „נכסים לא שלמים”
-- **מהעמודה הזאת**, בזמן שהכרטיס והרשימה מחשבים מחדש בכל קריאה.
-- כלומר דוח המשרד היה חולק על המסכים עד שמישהו יערוך את הנכס
-- במקרה (ביקורת Codex).
--
-- הנוסחה כתובה כאן ב-SQL ולא נקראת מהקוד המשותף, וזו החלטה ולא
-- כפילות שנשכחה: מיגרציה היא **צילום של רגע**. היא מתארת את הכלל
-- כפי שהיה ביום שרץ, ואסור לה להשתנות אחריו — אחרת הרצה חוזרת על
-- מסד ותיק הייתה מייצרת מצב אחר מזה שהיא יצרה במקור.
--
-- תשעת השדות, לפי הסדר שבמסמך: מחיר · שטח · חדרים · קומה · מעלית ·
-- חניה · תמונות · תיאור · בעל הנכס. NULL בלבד הוא חוסר: `false`
-- („אין מעלית”) הוא תשובה מלאה, ותיאור ריק אינו תיאור.
UPDATE properties p
SET readiness_score = ROUND(
  (
    (p.price_agorot           IS NOT NULL)::int +
    (p.area_sqm               IS NOT NULL)::int +
    (p.rooms                  IS NOT NULL)::int +
    (p.floor                  IS NOT NULL)::int +
    (p.has_elevator           IS NOT NULL)::int +
    (p.has_parking            IS NOT NULL)::int +
    (EXISTS (SELECT 1 FROM property_media m WHERE m.property_id = p.id))::int +
    (COALESCE(p.marketing_description, '') <> '')::int +
    (p.owner_contact_id       IS NOT NULL)::int
  )::numeric * 100 / 9
);
