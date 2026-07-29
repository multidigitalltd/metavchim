-- מסך "מה חדש" (docs/09 שלב 2): סימון העדכון האחרון שהמשתמש ראה,
-- כדי שהבאנר יופיע רק על חדשות שטרם נראו — פר משתמש, בכל מכשיר.
ALTER TABLE users ADD COLUMN last_seen_announcement VARCHAR(60);
