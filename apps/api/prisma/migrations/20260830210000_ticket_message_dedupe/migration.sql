-- ‎**מסירה חוזרת של תשובת לקוח כפלה את ההודעה על הפנייה.**
--
-- שרשור מייל היה מוגן מהיום הראשון: `support_messages.provider_message_id`
-- ייחודי, ומסירה שנייה נדחית ב-P2002. פנייה מהכפתור שקיבלה תשובה במייל
-- עוברת במסלול אחר (`appendToTicket`), ושם לא הייתה עמודה כזו בכלל —
-- כלומר כל מסירה חוזרת של הספק (הוא מוסר שוב על כל תשובה שאינה 2xx)
-- כתבה את אותה הודעה פעם נוספת על הפנייה, ומרגע שנוספה התראה למנהלים
-- גם שלחה מייל נוסף על כל אחת (ביקורת Codex).
--
-- אותה צורה בדיוק כמו בטבלת ההודעות של השרשורים: `UNIQUE` שמתיר NULL.
-- ב-Postgres שורות עם NULL אינן מתנגשות באינדקס ייחודי, ולכן הודעות
-- שאין להן מזהה ספק (נכתבות מהשולחן) נשמרות כרגיל.
ALTER TABLE "support_ticket_messages"
  ADD COLUMN "provider_message_id" VARCHAR(200);

CREATE UNIQUE INDEX "support_ticket_messages_provider_message_id_key"
  ON "support_ticket_messages" ("provider_message_id");
