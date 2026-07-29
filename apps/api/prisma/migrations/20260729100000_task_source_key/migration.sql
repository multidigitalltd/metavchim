-- מפתח אידמפוטנטיות למשימות שנוצרות מאירועים: מבחין בין מקורות שונים
-- (למשל שני נכסים שירדו משיווק לאותו קונה) ומונע כפילות בניסיון חוזר.
ALTER TABLE tasks ADD COLUMN source_key VARCHAR(120);
CREATE INDEX tasks_tenant_entity_source_idx ON tasks (tenant_id, entity_id, source_key);
