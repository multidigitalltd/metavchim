-- „עדכנו אותי כשזה עולה” — רישום עניין בפיצ'ר שטרם הושק.
--
-- מסך „בקרוב” עם כפתור הרשמה שאינו רושם דבר מבטיח הודעה שאין למי
-- לשלוח ביום ההשקה. הטבלה הזו היא מה שהופך את ההבטחה לניתנת
-- לקיום.
--
-- גנרית ולא טבלה לפיצ'ר: זה הפיצ'ר השלישי שמוצג כ„בקרוב”, ולכל
-- אחד תגיע אותה בקשה. שם הפיצ'ר נבדק מול רשימה סגורה בשרת, כדי
-- שהעמודה לא תהפוך למזבלה של מחרוזות חופשיות.

CREATE TABLE "feature_signups" (
    "id"         CHAR(26)    NOT NULL,
    "tenant_id"  CHAR(26)    NOT NULL,
    "user_id"    CHAR(26)    NOT NULL,
    "feature"    VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_signups_tenant_id_user_id_feature_key"
  ON "feature_signups"("tenant_id", "user_id", "feature");
CREATE INDEX "feature_signups_tenant_id_feature_idx"
  ON "feature_signups"("tenant_id", "feature");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE feature_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_signups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feature_signups
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON feature_signups TO metavchim_app;
