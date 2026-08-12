-- הסכם חתום שורד את מחיקת הלקוח.
--
-- מסמך חתום אינו נמחק בשום מקרה — הוא ראיה משפטית ובסיס הזכאות
-- לדמי התיווך. מחיקת לקוח מנתקת אותו מהכרטיס (contact_id = NULL)
-- במקום למחוק אותו, ולכן העמודה חייבת להיות nullable.
ALTER TABLE "agreements" ALTER COLUMN "contact_id" DROP NOT NULL;
