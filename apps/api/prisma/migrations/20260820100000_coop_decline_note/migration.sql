-- סיבת "לא מתאים" — מה שהמשרד הדוחה כותב למשרד שהציע.
-- דחייה בלי מילה משאירה את המציע לנחש; דחייה עם סיבה היא פידבק
-- שמלמד אותו מה כן להציע בפעם הבאה (בקשת המשתמש).
ALTER TABLE coop_offers ADD COLUMN decline_note VARCHAR(300);
ALTER TABLE coop_interests ADD COLUMN decline_note VARCHAR(300);
