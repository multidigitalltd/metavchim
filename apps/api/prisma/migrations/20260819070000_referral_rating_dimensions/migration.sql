-- דירוג הפניה רב-ממדי.
--
-- ציון יחיד לא אמר למשרד הקולט **מה** היה חלש ולא אמר למפנה **מה
-- לתקן**, והוא ערבב דברים שאין ביניהם קשר: הפניה יכולה להיות
-- מדויקת להפליא ופשוט לא להסתדר, ומשרד שמדרג נמוך כי הלקוח בחר
-- אחרת מעניש את המפנה על משהו שאינו בשליטתו.

-- הציון בכל ממד בנפרד. JSONB ולא עמודות: הממדים שונים בין הצדדים
-- (הקולט מדרג ארבעה, המפנה שלושה), ועמודות נפרדות היו טבלה שרובה
-- NULL. האימות נעשה ב-Zod לפני הכתיבה.
ALTER TABLE "lead_referral_ratings" ADD COLUMN "scores" JSONB NOT NULL DEFAULT '{}';

-- הציון הכולל בעשיריות (45 = 4.5).
--
-- שלם ולא עשרוני: הוא נצבר ב-`referral_reputation.rating_sum`
-- בדלתאות, וצבירת עשרוניים אינה מדויקת. עיגול לשלם היה מאבד חצי
-- כוכב בכל דירוג — על מוניטין שקובע אם משרד מקבל עבודה, זה יותר
-- מדי.
ALTER TABLE "lead_referral_ratings" ADD COLUMN "score_tenths" SMALLINT;
UPDATE "lead_referral_ratings" SET "score_tenths" = "score" * 10;
ALTER TABLE "lead_referral_ratings" ALTER COLUMN "score_tenths" SET NOT NULL;

-- הממד היחיד שהיה קיים נשמר תחת מפתח מפורש, כדי שדירוג היסטורי
-- לא ייראה כאילו לא דורג בו דבר.
UPDATE "lead_referral_ratings"
   SET "scores" = jsonb_build_object('overall', "score")
 WHERE "scores" = '{}'::jsonb;

ALTER TABLE "lead_referral_ratings" DROP COLUMN "score";

-- הצבירה עוברת לאותה יחידה **באותה מיגרציה**. פיצול לשתיים היה
-- משאיר חלון שבו הסכום בשלמים והדלתאות בעשיריות — כלומר מוניטין
-- שגוי פי עשרה, בלי שום שגיאה.
UPDATE "referral_reputation" SET "rating_sum" = "rating_sum" * 10;
