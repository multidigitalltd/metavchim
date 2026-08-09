-- משימות: עדיפות, ומי הטיל.
--
-- **מי הטיל** הופך למידע ברגע שאפשר להטיל על אחר. עד כה
-- assigned_to_user_id שימש גם כ"מי יצר" וגם כ"מי אחראי", כי הם היו
-- תמיד אותו אדם; משימה שמנהל מטיל על סוכן מפרידה ביניהם, והסוכן
-- שמקבל אותה צריך לדעת ממי היא הגיעה.
ALTER TABLE tasks ADD COLUMN created_by_user_id CHAR(26);

-- למשימות הקיימות: מי שהמשימה עליו הוא גם מי שיצר אותה. זה נכון
-- היסטורית — עד עכשיו לא הייתה דרך אחרת.
UPDATE tasks SET created_by_user_id = assigned_to_user_id WHERE created_by_user_id IS NULL;

-- low | normal | high. ברירת המחדל היא מה שכל המשימות הקיימות הן.
ALTER TABLE tasks ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'normal';

-- לוח המשרד שואל "מה פתוח, לפי מועד" בלי לסנן לפי סוכן, והאינדקס
-- הקיים מתחיל ב-assigned_to_user_id — כלומר לא משמש אותו.
CREATE INDEX tasks_tenant_status_due_idx ON tasks (tenant_id, status, due_at);
