-- החיבור שייך לסוכן שחיבר אותו, לא למשרד כולו (docs/12).
--
-- כל סוכן מחבר את המספר שלו, ולכן ליד שנוצר מהקו נוחת אצלו. בלי
-- העמודה הזו לא הייתה דרך לדעת של מי הקו, וכל הלידים היו נופלים
-- למאגר המשרד — כלומר סוכן שחיבר את המספר הפרטי שלו היה מזין
-- לידים לעמיתיו.
ALTER TABLE whatsapp_business_connections ADD COLUMN user_id CHAR(26);

-- שורות שנוצרו לפני ההפרדה משויכות לבעל המשרד: הוא מי שחיבר אותן
-- בפועל דרך מסך ההגדרות, שהיה פתוח לו בלבד. `ORDER BY` מבטיח
-- בחירה יציבה גם כשיש כמה בעלים.
UPDATE whatsapp_business_connections c
SET user_id = (
  SELECT u.id FROM users u
  WHERE u.tenant_id = c.tenant_id
  ORDER BY (u.role = 'owner') DESC, u.created_at ASC
  LIMIT 1
)
WHERE c.user_id IS NULL;

-- שורה בלי סוכן אינה ניתנת לניתוב ולכן אינה חוקית מכאן והלאה.
DELETE FROM whatsapp_business_connections WHERE user_id IS NULL;

ALTER TABLE whatsapp_business_connections ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE whatsapp_business_connections
  ADD CONSTRAINT whatsapp_business_connections_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX whatsapp_business_connections_user_id_idx
  ON whatsapp_business_connections(user_id);
