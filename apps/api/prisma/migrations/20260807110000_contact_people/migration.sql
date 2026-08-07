-- כמה אנשי קשר וכמה טלפונים ללקוח אחד.
--
-- הבעיה: בעסקת נדל"ן ישראלית ממוצעת יש יותר מאדם אחד בצד הלקוח —
-- בעל ואישה שקונים יחד, בן שמטפל עבור ההורים, מיופה כוח. עד כה
-- כרטיס הצביע על איש קשר יחיד עם טלפון יחיד, ולכן הודעת וואטסאפ
-- מהנייד של האישה פתחה ליד חדש כאילו היא זרה.
--
-- העיקרון: contacts נשארת כמות שהיא — איש קשר אחד עם הטלפון הראשי
-- שלו, וה-unique על (tenant_id, phone_hash) נשאר מפתח זיהוי הכפילויות.
-- שתי הטבלאות כאן מוסיפות סביבו ולא משנות אותו, כי 68 מקומות בקוד
-- נשענים על הקשר הזה.

-- ---------- טלפונים נוספים לאותו אדם ----------
CREATE TABLE contact_phones (
  id              CHAR(26)     PRIMARY KEY,
  tenant_id       CHAR(26)     NOT NULL,
  contact_id      CHAR(26)     NOT NULL,
  -- מוצפן כמו כל PII (docs/04 §4)
  phone_encrypted TEXT         NOT NULL,
  -- אותו HMAC של הטלפון הראשי — כך חיפוש נכנס מוצא את האדם דרך
  -- כל אחד ממספריו, באותו מנגנון בדיוק
  phone_hash      CHAR(64)     NOT NULL,
  -- mobile | home | work | other
  label           VARCHAR(10)  NOT NULL DEFAULT 'mobile',
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_phones_contact_fk
    FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
);

-- אותו מספר לא יכול להשתייך לשני אנשים באותו משרד — אחרת הודעה
-- נכנסת הייתה מתאימה לשניים ואי אפשר להכריע לאיזה כרטיס היא שייכת
CREATE UNIQUE INDEX contact_phones_tenant_hash_key ON contact_phones (tenant_id, phone_hash);
CREATE INDEX contact_phones_contact_idx ON contact_phones (tenant_id, contact_id);

ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_phones FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contact_phones
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ---------- אנשים מקושרים לאותו כרטיס ----------
CREATE TABLE contact_links (
  id                 CHAR(26)     PRIMARY KEY,
  tenant_id          CHAR(26)     NOT NULL,
  -- איש הקשר הראשי שהכרטיס מצביע עליו
  contact_id         CHAR(26)     NOT NULL,
  -- האדם הנוסף; הוא contact מן המניין, עם טלפון וכרטיס משלו
  related_contact_id CHAR(26)     NOT NULL,
  -- spouse | partner | parent | child | attorney | other
  role               VARCHAR(20)  NOT NULL DEFAULT 'other',
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT contact_links_contact_fk
    FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CONSTRAINT contact_links_related_fk
    FOREIGN KEY (related_contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  -- אדם אינו מקושר לעצמו: קישור כזה היה מייצר לולאה בתצוגה
  CONSTRAINT contact_links_not_self CHECK (contact_id <> related_contact_id)
);

CREATE UNIQUE INDEX contact_links_pair_key
  ON contact_links (tenant_id, contact_id, related_contact_id);
CREATE INDEX contact_links_related_idx ON contact_links (tenant_id, related_contact_id);

ALTER TABLE contact_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contact_links
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
