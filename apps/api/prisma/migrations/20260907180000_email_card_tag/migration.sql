-- ‏תג הכרטיס על ההודעה — נכתב רק כשהוא עובדה, ולכן NULL הוא ערך
-- ‏תקין ונפוץ: מייל נכנס שאינו תשובה לשליחה מהמערכת אינו שייך
-- ‏לכרטיס, ואין מה לנחש עליו.
ALTER TABLE "email_messages" ADD COLUMN "card_kind" VARCHAR(10);
ALTER TABLE "email_messages" ADD COLUMN "card_id" CHAR(26);

-- ‏ועל הטוקן — כדי שהתשובה תירש את התג של השליחה שהיא עונה עליה.
-- ‏בלי זה תשובה נכנסת אינה יודעת דבר, והתיוג היה חל על הצד היוצא
-- ‏בלבד — כלומר דווקא לא על ההודעה שהסוכן צריך להבין.
ALTER TABLE "email_reply_tokens" ADD COLUMN "card_kind" VARCHAR(10);
ALTER TABLE "email_reply_tokens" ADD COLUMN "card_id" CHAR(26);

-- ‏„כל ההודעות של הכרטיס הזה” — הצד השני של התיבה. חלקי, כי רובן
-- ‏המכריע של השורות אינן מתויגות ואין טעם לשמור אותן באינדקס.
CREATE INDEX "email_messages_card_idx"
  ON "email_messages" ("tenant_id", "card_kind", "card_id", "created_at" DESC)
  WHERE "card_kind" IS NOT NULL;

-- ‏השימוש החוזר בטוקן מחפש לפי (משרד, לקוח, שולח) — והתג נכנס
-- ‏לחיפוש הזה. אינדקס תואם, כדי שהתוספת לא תהפוך אותו לסריקה.
CREATE INDEX "email_reply_tokens_card_idx"
  ON "email_reply_tokens" ("tenant_id", "contact_id", "card_kind", "card_id");
