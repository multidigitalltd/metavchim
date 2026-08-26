-- הצעות מנוי בלינק — עסקה שנסגרה בשיחה והופכת לתשלום בלחיצה.
--
-- הטבלה **מחוץ ל-RLS**, כמו plans, coupons ו-payments: היא נקראת גם
-- בזרימת התשלום שמגיעה בלי הקשר דייר (הוובהוק של קארדקום מפעיל את
-- ההצעה), ואין בה מידע על לקוחות הקצה של המשרד — רק מזהה דייר,
-- מסלול וסכום. הבידוד נאכף בשכבת האפליקציה, מפורשות בכל שאילתה.

CREATE TABLE subscription_offers (
  id              CHAR(26)     PRIMARY KEY,
  -- הסוד שבלינק. אקראי וארוך מכדי לנחש — הוא ההרשאה לראות את ההצעה
  token           VARCHAR(64)  NOT NULL UNIQUE,
  -- custom = הצעה אישית למשרד; plan_link = לינק מכירה לחבילה קיימת
  kind            VARCHAR(20)  NOT NULL,
  -- ההצעה נעולה למשרד הזה; NULL = כל משרד מחובר (לינק מכירה)
  tenant_id       CHAR(26),
  plan_code       VARCHAR(20)  NOT NULL,
  -- monthly | yearly
  billing_cycle   VARCHAR(10)  NOT NULL DEFAULT 'monthly',
  -- המחיר הסופי למחזור, באגורות. NULL = מחיר המסלול / המחיר המוסכם
  price_agorot    INTEGER,
  -- שורות התוספת [{label, amountAgorot}] — לתצוגה ולתיעוד
  line_items      JSONB        NOT NULL DEFAULT '[]',
  -- תכונות שנפתחות למשרד עם התשלום, מעבר למסלול
  feature_grants  TEXT[]       NOT NULL DEFAULT '{}',
  -- הערה חופשית שמוצגת ללקוח בדף ההצעה
  note            VARCHAR(500) NOT NULL DEFAULT '',
  -- NULL = בלי הגבלת מימושים; הצעה אישית נוצרת עם 1
  max_redemptions INTEGER,
  redemptions     INTEGER      NOT NULL DEFAULT 0,
  expires_at      TIMESTAMP(3),
  -- ביטול ולא מחיקה — התשלומים שמימשו את ההצעה מפנים אליה לתמיד
  revoked_at      TIMESTAMP(3),
  created_by      CHAR(26),
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "מה ההצעות שפתוחות למשרד הזה" — מסך הפלטפורמה מסנן לפי משרד
CREATE INDEX subscription_offers_tenant_id_idx ON subscription_offers (tenant_id);
-- הרשימה במסך הפלטפורמה — החדשות קודם
CREATE INDEX subscription_offers_created_at_idx ON subscription_offers (created_at);

-- ההצעה שהתשלום מממש. ריק בתשלום רגיל; מלא, הוא מה שמפעיל בהצלחה
-- גם את המחיר המוסכם ואת התכונות שההצעה הבטיחה.
ALTER TABLE payments ADD COLUMN offer_id CHAR(26);
