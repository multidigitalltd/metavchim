-- מוניטין ההפניות, מפורק לממדים.
--
-- ממוצע אחד מסתיר את ההבדל בין משרד שסוטה מעט בכל ממד לבין משרד
-- שמדייק לחלוטין ברצינות ובזמינות ומנפח בשיטתיות את התקציב. השני
-- אומר משהו שאי אפשר לסמוך עליו דווקא בשדה שקובע אם הליד שווה את
-- המחיר, ומי שעומד לשלם עמלת הפניה זכאי לראות את זה.
CREATE TABLE "referral_reputation_dimensions" (
    "tenant_id" CHAR(26) NOT NULL,
    "dimension" VARCHAR(20) NOT NULL,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_reputation_dimensions_pkey"
      PRIMARY KEY ("tenant_id", "dimension")
);

/*
 * מילוי לאחור מהאישורים הקיימים — **חובה, לא נחמדות.**
 *
 * הפיתוי היה להתחיל ריק ולתת לפירוט להיבנות מאישורים חדשים בלבד.
 * זה שובר את החשבונאות: הקולט רשאי לתקן אישור, והתיקון מוריד
 * מהצבירה את מה שהאישור הקודם תרם. אישור שקדם לטבלה הזו מעולם לא
 * תרם לה — ולכן תיקון שלו היה מחסיר מספרים שלא הוכנסו, כלומר מונה
 * שלילי וסכום שלילי שמזהמים את הממוצע לצמיתות (ביקורת Codex).
 *
 * המילוי אפשרי ונכון כאן משום שכל האישורים הקיימים נולדו **אחרי**
 * 20260819090000, שמחקה את כולם ואיפסה את המונים. כלומר כולם כבר
 * על סקאלת הדיוק, ואין סכנה של ערבוב שתי סקאלות.
 *
 * הנוסחה זהה ל-`dimensionAccuracies`: ‎5 − |הצהרה − אישור|‎ לכל ממד
 * ששני הצדדים דירגו, בעשיריות. `jsonb_typeof` על שני הצדדים הוא
 * מה שמממש את "שני הצדדים דירגו" — מפתח חסר מחזיר NULL ונופל מה-
 * WHERE, ומפתח שאינו מספר לא ייכנס ל-`::int`.
 *
 * רשימת הממדים כתובה במפורש ולא נגזרת מהנתונים: שורה תחת מפתח
 * שאינו בקטלוג לא הייתה מתעדכנת לעולם (הקוד עובר על הקטלוג בלבד)
 * ונשארת קפואה על המסך. כאן זו קביעה על נתוני עבר, ולכן העתק
 * היסטורי של הקטלוג הוא בדיוק הדבר הנכון.
 *
 * לפני הפעלת ה-RLS בכוונה — המיגרציות רצות עם הבעלים, ו-FORCE ROW
 * LEVEL SECURITY חל גם עליו.
 */
INSERT INTO "referral_reputation_dimensions"
  ("tenant_id", "dimension", "rating_count", "rating_sum", "updated_at")
SELECT
  r."seller_tenant_id",
  d."key",
  COUNT(*),
  SUM(
    LEAST(5, GREATEST(1,
      5 - ABS(
        (s."client_scores" ->> d."key")::int - (r."scores" ->> d."key")::int
      )
    ))
  ) * 10,
  now()
FROM "lead_referral_ratings" r
JOIN "shared_leads" s ON s."id" = r."shared_lead_id"
CROSS JOIN LATERAL jsonb_each(r."scores") AS d("key", "value")
WHERE d."key" IN ('seriousness', 'budget', 'urgency', 'reachability')
  AND jsonb_typeof(s."client_scores" -> d."key") = 'number'
  AND jsonb_typeof(r."scores" -> d."key") = 'number'
GROUP BY r."seller_tenant_id", d."key";

/*
 * אותה מדיניות בדיוק כמו `referral_reputation`, ומאותו נימוק:
 * הטבלה מכילה מספרים בלבד — לא שם לקוח, לא הערה ולא מזהה הפניה —
 * ולכן חשיפתה לרשת היא חשיפת המוניטין שהלוח קיים כדי להציג.
 *
 * הכתיבה נשארת נעולה למשרד עצמו. העדכון בפועל מגיע מהקשר המשרד
 * המפנה בתוך טרנזקציית האישור, בדיוק כמו הצבירה המצרפית.
 */
ALTER TABLE referral_reputation_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_reputation_dimensions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referral_reputation_dimensions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY network_read ON referral_reputation_dimensions FOR SELECT
  USING (current_setting('app.network_read', true) = 'on');
