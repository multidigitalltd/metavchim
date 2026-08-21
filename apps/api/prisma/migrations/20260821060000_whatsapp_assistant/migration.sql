-- הסוכן האישי בוואטסאפ: שורת שיחה אחת לכל מתווך — ההצעה שממתינה
-- ל"אשר", זיכרון התורות האחרונים, ומזהי ההודעות שכבר טופלו (Meta
-- שולח כפולים). ההצעה וההיסטוריה מכילות שמות ופרטים של לקוחות קצה,
-- ולכן הטבלה תחת RLS מלא כמו כל נתוני דייר.

-- CreateTable
CREATE TABLE "whatsapp_chats" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "pending" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "handled_ids" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_chats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_chats_tenant_id_user_id_key"
  ON "whatsapp_chats"("tenant_id", "user_id");

-- RLS — בידוד מלא בין משרדים, כמו כל טבלת נתוני-דייר
ALTER TABLE whatsapp_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_chats FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_chats
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
