-- הנכס שהשיחה נוגעת לו, כצילום ברגע השיחה.
--
-- לא ממולא בדיעבד מ-`leads.property_id` **במכוון**: שיוך הליד לנכס
-- משתנה אחרי מעשה, ומילוי אחורה היה מייצר בדיוק את הטענה השגויה
-- שהעמודה נועדה למנוע — שיחה שנספרת בנכס שלא היה קשור אליה כשהיא
-- קרתה. NULL פירושו "לא ידוע", והדוח לבעל הנכס אינו טוען דבר עליה.
ALTER TABLE "calls" ADD COLUMN "property_id" CHAR(26);

CREATE INDEX "calls_tenant_id_property_id_occurred_at_idx"
  ON "calls" ("tenant_id", "property_id", "occurred_at" DESC);
