/**
 * מה מחכה ברשת — **ומה שלכם לא נמצא שם.**
 *
 * הרשת הייתה חד-כיוונית: רק קונים התפרסמו. משרד יכול היה לומר "יש
 * לי קונה, למי יש נכס" ולא "יש לי נכס, למי יש קונה", ולכן משרד עם
 * נכס תקוע ומשרד עם קונה מתאים לא נפגשו אלא במקרה.
 *
 * אבל גם אחרי שהכיוון השני נפתח נשארת בעיה שקטה יותר: **לראות את
 * הרשת אינו דורש שיתוף; להיראות בה כן.** סוכן פותח את הפיד, רואה
 * שבעה נכסים ושנים-עשר ביקושים, ולא יודע שהנכס שלו — שמתאים לשלושה
 * מהם — אינו מפורסם, ולכן אף אחד מהם לא יפנה אליו.
 *
 * הוא לא יודע כי אין מקום שאומר לו. המודול הזה מחשב בדיוק את זה:
 * מה מהמאגר שלי מתאים למשהו שכבר ברשת, ואינו משותף.
 *
 * ## למה כאן ולא בשאילתה
 *
 * ההחלטה "מה נחשב הזדמנות שהוחמצה" היא כלל מוצר ולא שאילתה: היא
 * מערבת סף ניקוד, מה נחשב "משותף", וכמה פריטים שווה להציג לפני
 * שהתזכורת הופכת לרעש. כלל כזה צריך להיות במקום אחד שאפשר לבדוק.
 */

/**
 * סף ההצגה.
 *
 * זהה לסף שההתאמות ברשת כבר משתמשות בו. שני ספים שונים היו מייצרים
 * את הסתירה הגרועה מכולן: הודעה שאומרת "יש התאמה" ורשימה שמציגה
 * אפס — כי כל אחת מהן מדדה אחרת.
 */
export const REACH_MIN_SCORE = 70;

/**
 * כמה פריטים להציג בהצעה לפני שהיא נחתכת ל"ועוד N".
 *
 * שלושה: מספיק כדי להאמין שההצעה אמיתית, מעט מספיק כדי שהיא תישאר
 * שורה ולא מסך. מי שרוצה את הרשימה המלאה נכנס לרשימת הנכסים.
 */
export const REACH_PREVIEW = 3;

/** פריט שלי שמישהו ברשת מחפש, ואינו מפורסם. */
export interface ReachItem {
  id: string;
  /** מה שמוצג ברשימה — כותרת הנכס או שם הקונה. */
  title: string;
  /** כמה פריטים ברשת מתאימים לו. תמיד ≥ 1, אחרת הוא אינו כאן. */
  matches: number;
  /** הניקוד הגבוה ביותר מבין ההתאמות — מה שקובע את הסדר. */
  bestScore: number;
}

export interface ReachSummary {
  /** נכסים שלי שביקוש ברשת מחפש, ואינם מפורסמים. */
  properties: ReachItem[];
  /** קונים שלי שנכס ברשת מתאים להם, ואינם משותפים. */
  buyers: ReachItem[];
  /** האם יש בכלל מה להציע. `false` = לא מציגים את ההצעה. */
  any: boolean;
}

/**
 * קלט גולמי: פריט אחד שלי, וניקודי ההתאמה שלו מול הרשת.
 *
 * `shared` מגיע מהקורא ולא נגזר כאן — "משותף" מוגדר בטבלה אחרת לכל
 * צד (`shared_demands` לקונה, `shared_listings` לנכס), וחישוב שלו
 * כאן היה מחייב את המודול הטהור להכיר את המסד.
 */
export interface ReachCandidate {
  id: string;
  title: string;
  shared: boolean;
  /** ניקודי ההתאמה מול פריטי הרשת. ריק = אין למי להיראות. */
  scores: readonly number[];
}

/**
 * מיון ההזדמנויות שהוחמצו.
 *
 * פריט נכנס רק אם הוא **גם** אינו משותף **וגם** יש לו התאמה מעל
 * הסף. פריט משותף אינו הזדמנות שהוחמצה — הוא כבר נראה; ופריט בלי
 * התאמה אינו הזדמנות בכלל, ולהציע לפרסם אותו זו בקשה להאמין
 * להבטחה ריקה.
 *
 * המיון לפי הניקוד הגבוה ביותר ולא לפי מספר ההתאמות: נכס אחד עם
 * התאמה של 95% שווה יותר משלוש התאמות של 71%, ומי שרואה שורה אחת
 * צריך לראות את הטובה ביותר.
 */
export function rankReach(candidates: readonly ReachCandidate[]): ReachItem[] {
  return candidates
    .filter((c) => !c.shared)
    .map((c) => {
      const hits = c.scores.filter((s) => s >= REACH_MIN_SCORE);
      return {
        id: c.id,
        title: c.title,
        matches: hits.length,
        bestScore: hits.length === 0 ? 0 : Math.max(...hits),
      };
    })
    .filter((item) => item.matches > 0)
    .sort((a, b) => b.bestScore - a.bestScore || b.matches - a.matches);
}

export function summarizeReach(input: {
  properties: readonly ReachCandidate[];
  buyers: readonly ReachCandidate[];
}): ReachSummary {
  const properties = rankReach(input.properties);
  const buyers = rankReach(input.buyers);
  return {
    properties,
    buyers,
    any: properties.length > 0 || buyers.length > 0,
  };
}

/**
 * המשפט שמופיע בראש האזור.
 *
 * מספר ולא תיאור: "3 נכסים ו-2 קונים" הוא עובדה שאפשר לבדוק,
 * ו"יש לכם הזדמנויות" הוא סיסמה. מתווך שקורא מספר יודע אם שווה לו
 * ללחוץ.
 *
 * מחזיר `null` כשאין מה לומר — כדי שהקורא לא יצטרך לנחש אם להציג
 * את הרכיב, ובעיקר כדי שלא תופיע שורה שמכריזה על אפס.
 */
export function describeReach(summary: ReachSummary): string | null {
  if (!summary.any) return null;
  const parts: string[] = [];
  if (summary.properties.length > 0) {
    parts.push(
      summary.properties.length === 1
        ? "נכס אחד שלכם"
        : `${summary.properties.length} מהנכסים שלכם`,
    );
  }
  if (summary.buyers.length > 0) {
    parts.push(
      summary.buyers.length === 1
        ? "קונה אחד שלכם"
        : `${summary.buyers.length} מהקונים שלכם`,
    );
  }
  const subject = parts.join(" ו-");
  const verb =
    summary.properties.length + summary.buyers.length === 1
      ? "מתאים"
      : "מתאימים";
  return `${subject} ${verb} למשהו שכבר ברשת — ואינם מפורסמים בה`;
}
