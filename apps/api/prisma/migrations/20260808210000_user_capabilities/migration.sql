-- חריגי הרשאה לכל משתמש — השכבה שמעל התפקיד.
--
-- התפקיד קובע את נקודת הפתיחה; כאן מנהל המשרד מכוונן אותה למשתמש
-- בודד. למה חריגים ולא תפקידים נוספים: משרד שרוצה "סוכן שגם מוציא
-- דוחות" או "מתמחה שחסום מנכסים לחודש" היה מחייב תפקיד חדש בכל
-- צירוף, והרשימה הייתה מתפוצצת.
--
-- שורה אחת לכל (משתמש, יכולת) — effect קובע האם היא מוסיפה או
-- מסירה. אין מצב שבו קיימים גם grant וגם deny לאותה יכולת, ולכן
-- אין צורך בכלל הכרעה בין השניים.
CREATE TABLE user_capabilities (
  id          CHAR(26)     PRIMARY KEY,
  tenant_id   CHAR(26)     NOT NULL,
  user_id     CHAR(26)     NOT NULL,
  capability  VARCHAR(40)  NOT NULL,
  -- 'grant' = הוספה מעבר לתפקיד, 'deny' = חסימה
  effect      VARCHAR(10)  NOT NULL,
  -- NULL = לצמיתות. אחרת החריג פג מהתאריך הזה.
  --
  -- התפוגה נאכפת בקריאה ולא בעבודת ניקוי: job שנתקע היה משאיר
  -- משתמש חסום לנצח בלי שאיש ידע למה. שורה שפגה נשארת בטבלה כתיעוד
  -- של מה שהיה, ופשוט מפסיקה להשפיע.
  expires_at  TIMESTAMP(3),
  -- למה נחסם — מוצג למנהל במסך ההרשאות
  reason      VARCHAR(200),
  created_by  CHAR(26),
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_capabilities_effect_check CHECK (effect IN ('grant', 'deny'))
);

-- שורה אחת לכל צמד: שינוי חוזר הוא upsert, לא ערימת שורות סותרות
CREATE UNIQUE INDEX user_capabilities_user_capability_key
  ON user_capabilities (user_id, capability);

-- שאילתת הפתיחה של כל בקשה: כל החריגים של משתמש אחד
CREATE INDEX user_capabilities_tenant_user_idx
  ON user_capabilities (tenant_id, user_id);

ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_capabilities
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
