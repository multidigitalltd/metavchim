-- פניות לתמיכה: כפתור בכל מסך, לשונית ייעודית בניהול המשרד, ותור
-- אחד שהתמיכה עובדת ממנו.

CREATE TABLE "support_tickets" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "user_name" VARCHAR(120) NOT NULL,
    "user_email" VARCHAR(254) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "area" VARCHAR(40) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "screenshot_key" VARCHAR(300),
    "reply" VARCHAR(2000),
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- המשרד קורא את שלו לפי סדר כרונולוגי הפוך
CREATE INDEX "support_tickets_tenant_id_created_at_idx"
  ON "support_tickets"("tenant_id", "created_at" DESC);
-- התמיכה עובדת לפי תור: הפתוחות קודם
CREATE INDEX "support_tickets_status_created_at_idx"
  ON "support_tickets"("status", "created_at" DESC);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;

-- המשרד: הפניות שלו בלבד, ורק בשמו
CREATE POLICY tenant_isolation ON support_tickets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- התמיכה קוראת וכותבת חוצה-דיירים.
--
-- זו הפוליסה היחידה במערכת שחוצה דיירים על טבלה שיש בה תוכן של
-- לקוחות, והיא מכוונת: פנייה שהתמיכה לא יכולה לקרוא היא פנייה שאין
-- בה טעם. הגבול נשמר בשני מקומות — הדגל `app.support_desk` נדלק אך
-- ורק ב-`withSupportDesk`, וכל נתיב שקורא לו חסום מאחורי
-- PlatformAdminGuard. הפוליסה מוגבלת לטבלה הזו בלבד; מזהה הדייר
-- אינו נגזר ממנה לשום קריאה אחרת.
CREATE POLICY support_desk ON support_tickets
  USING (current_setting('app.support_desk', true) = 'on')
  WITH CHECK (current_setting('app.support_desk', true) = 'on');
