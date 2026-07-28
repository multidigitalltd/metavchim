-- מספר וואטסאפ עסקי ייחודי בין משרדים (ביקורת Codex, PR #5):
-- שני משרדים עם אותו מספר = הודעות לקוחות מנותבות למשרד שגוי.
-- אינדקס ייחודי על הביטוי — אכיפה ברמת ה-DB, לא רק באפליקציה.
CREATE UNIQUE INDEX tenants_whatsapp_number_key
  ON tenants ((settings->>'whatsappNumber'))
  WHERE settings->>'whatsappNumber' IS NOT NULL;
