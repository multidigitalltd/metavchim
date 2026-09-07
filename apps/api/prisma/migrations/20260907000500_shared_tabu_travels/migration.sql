-- ‎**העובדה על הרישום המשותף נוסעת בין משרדים** (ביקורת Codex, P1 ×2).
--
-- ‏עד שהתכונה הפכה לדגל, היא נשאה את עצמה דרך `property_type`
-- ‏(`shared_tabu`) — ולכן הגיעה לרשת יחד עם הסוג. מרגע שהיא דגל,
-- ‏נכס עם סוג רגיל איבד אותה בפרסום, והצד השני קיבל אותו כרגיל:
-- ‏מוצע לקונה שסירב למושאע, ובלי שהמשרד המקבל רואה את מצב הרישום.
--
-- ‏ובכיוון השני, החמור יותר: `refuses` של קונה **לא נסע כלל**,
-- ‏והמשרד המקבל קרא „טרם נשאל” — כלומר ההתאמה הותרה על סירוב מפורש.
ALTER TABLE "shared_listings"
  ADD COLUMN IF NOT EXISTS "shared_tabu" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "shared_demands"
  ADD COLUMN IF NOT EXISTS "shared_tabu_stance" VARCHAR(10);

-- ‏מילוי לאחור מהצורה הישנה: פרסום שנשא את הסוג הוותיק אכן משותף.
UPDATE "shared_listings"
   SET "shared_tabu" = true
 WHERE "property_type" = 'shared_tabu';

-- ‏ואותו כלל בביקוש: מי שביקש את הסוג הוותיק הסכים לו.
UPDATE "shared_demands"
   SET "shared_tabu_stance" = 'accepts'
 WHERE "shared_tabu_stance" IS NULL
   AND 'shared_tabu' = ANY("property_types");
