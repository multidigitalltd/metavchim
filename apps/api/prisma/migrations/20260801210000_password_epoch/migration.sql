-- "עידן הסיסמה": כל Session נושא את חותמת שינוי-הסיסמה שכנגדה אומת.
-- שינוי סיסמה (החלפה או איפוס) מקדם את החותמת במשתמש, וכל Session
-- שנושא חותמת ישנה נפסל בפענוח — כולל Session שנוצר במרוץ מול האיפוס
-- (התחברות שאימתה את הסיסמה הישנה לפני האיפוס אך יצרה Session אחריו).
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE sessions ADD COLUMN password_epoch TIMESTAMP(3);
