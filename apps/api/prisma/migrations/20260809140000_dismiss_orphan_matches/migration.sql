-- התאמות שנשארו מצביעות על נכס מחוק.
--
-- מחיקה רכה של נכס הורידה עד כה רק התאמות במצב `suggested`. התאמה
-- שכבר הגיעה למצב `offered` שרדה, והרשימות מסננות `dismissed` בלבד —
-- כלומר היא המשיכה להופיע במסך ובמונה שלידו, מצביעה על נכס שאינו
-- קיים. מכאן והלאה המחיקה הרכה מסמנת את כולן; זו השלמה חד-פעמית
-- למה שכבר נוצר.
--
-- `dismissed` ולא DELETE: להתאמה במצב `offered` יש הצעה שנשלחה
-- (`offers.match_id`), ומחיקתה הייתה מייתמת רשומה היסטורית.
UPDATE matches m
SET status = 'dismissed'
FROM properties p
WHERE m.property_id = p.id
  AND m.tenant_id = p.tenant_id
  AND p.deleted_at IS NOT NULL
  AND m.status <> 'dismissed';

-- אותו דבר לקונה מחוק. אין כרגע נתיב שמוחק קונה, ולכן זה לא אמור
-- לגעת בשורות — אבל הכלל צריך לחול על שני צידי ההתאמה, ולא רק על
-- הצד שבמקרה יש לו מחיקה.
UPDATE matches m
SET status = 'dismissed'
FROM buyers b
WHERE m.buyer_id = b.id
  AND m.tenant_id = b.tenant_id
  AND b.deleted_at IS NOT NULL
  AND m.status <> 'dismissed';
