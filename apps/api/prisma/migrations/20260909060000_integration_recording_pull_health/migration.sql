-- ‏אבחון משיכת ההקלטות, על שורת החיבור עצמה.
--
-- ‏„הוובהוק מגיע” ו„ההקלטה נמשכת” הם שני חיבורים נפרדים לאותו ספק,
-- ‏ומשרד יכול להיות תקין באחד ושבור בשני. עד כה השני נראה רק על
-- ‏שיחה בודדת — כלומר כדי לאבחן היה צריך גישה לשיחות של המשרד.
-- ‏כאן זה יושב על `integrations`, הטבלה שהיא ממילא הגדרת החיבור,
-- ‏ולכן שולחן החיבורים מציג אותו בלי לגעת בשום נתון של לקוח.
--
-- ‏שלושת השדות מקבילים אחד-לאחד ל-`last_event_*` שכבר כאן.
ALTER TABLE "integrations"
  ADD COLUMN "last_pull_at" TIMESTAMP(3),
  ADD COLUMN "last_pull_ok" BOOLEAN,
  ADD COLUMN "last_pull_issue" VARCHAR(40),
  ADD COLUMN "pull_fail_streak" INTEGER NOT NULL DEFAULT 0;
