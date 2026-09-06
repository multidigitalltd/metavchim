-- ‎**„מי הסוכן של הלקוח הזה” סורק עכשיו לפי כרטיס, ולא לפי משרד.**
--
-- ‏שער ההרשאה על התראות השיחה שואל „לאיזה נכס הלקוח הזה קשור” בכל
-- ‏שיחה נכנסת, ב-`OR` על שתי העמודות האלה. בלי אינדקס זו סריקת כל
-- ‏נכסי המשרד — זניח במשרד קטן, לא זניח במרכזייה עמוסה (ביקורת
-- ‏Codex). שני אינדקסים ולא אחד: `OR` על שתי עמודות אינו יכול
-- ‏לנצל אינדקס מורכב.
--
-- ‏`tenant_id` ראשון כמו בשאר האינדקסים כאן — כל שאילתה נושאת אותו,
-- ‏והוא מה שהופך את האינדקס לשימושי גם בסינון הרגיל.
CREATE INDEX IF NOT EXISTS "properties_tenant_owner_contact_idx"
  ON "properties" ("tenant_id", "owner_contact_id");

CREATE INDEX IF NOT EXISTS "properties_tenant_occupant_contact_idx"
  ON "properties" ("tenant_id", "occupant_contact_id");
