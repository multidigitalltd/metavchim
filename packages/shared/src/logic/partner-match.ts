import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import {
  budgetBandAgorot,
  DEFAULT_MATCH_WEIGHTS,
  scoreMatch,
  type MatchWeights,
} from "./matching.js";
import { formatIsraeliNumber } from "./israel-time.js";
import { isSharedTabuProperty, sharedTabuFit } from "./shared-tabu.js";

/**
 * ‎**שידוך שותפים — שני קונים על נכס אחד.**
 *
 * ‏נכס בטאבו משותף כבר רשום כחלקים בלתי מסוימים, ולכן שני קונים
 * ‏יכולים לקחת בו חלקים בלי לפצל דבר. זו העסקה שמתווך מנוסה בונה
 * ‏בראש כשהוא רואה שני לקוחות שאינם מגיעים לבד — והמערכת לא ידעה
 * ‏לראות אותה, כי המנוע שואל תמיד „קונה אחד מול נכס אחד”.
 *
 * ## ‏שלושה כללים שמגדירים מה בכלל שותפות
 *
 * ‎**א. אף אחד מהשניים אינו מגיע לבד.** אחרת אין מה להציע: מי
 * ‏שיכול לרכוש לבדו כבר מופיע ברשימת ההתאמות הרגילה, ושליחת שותף
 * ‏אליו היא רעש. הגבול הוא בדיוק רצועת התקציב של המנוע, ולכן
 * ‏שתי הרשימות **זרות זו לזו**: כל קונה מופיע באחת מהן ולא בשתיהן.
 *
 * ‎**ב. שניהם אישרו מראש טאבו משותף.** „טרם נשאל” אינו נכנס. הצעת
 * ‏נכס למי שלא נשאל היא שיחה; צירופו לשותפות עם אדם אחר היא ייחוס
 * ‏החלטה משפטית שמעולם לא קיבל.
 *
 * ‎**ג. כל אחד מהם מתאים לנכס בכל **שאר** הקריטריונים.** לא „בערך”
 * ‏ולא „מספיק קרוב”: אותו מנוע, אותם כללים, כשקריטריון התקציב
 * ‏מוסר משני הצדדים. זו הנקודה היחידה שבה מותר לוותר על התקציב,
 * ‏כי הוא בדיוק מה שהשותפות באה לפתור.
 *
 * ‎**מדוע לספק את התקציב ולא לחשב תקציב משותף.** תקציב משותף היה
 * ‏עותק שני של רצועת הגמישות, של הרצפה ושל ההבחנה בין מכירה
 * ‏לשכירות — כלל אחד בשני ניסוחים, שהיום מסכימים ובעוד שינוי אחד
 * ‏לא יסכימו. במקום זה המועמד נמדד עם תקציב **שווה למחיר הנכס**:
 * ‏זו האמת בשידוך — הצמד מכסה את המחיר בהגדרה — והמנוע עונה עליה
 * ‏בכלים שלו, כולל הכיסוי המלא שהיא מזכה בו.
 */

/** קונה מועמד לשותפות — הדרישות בלבד; מי הוא, ומה מותר לראות עליו, נשאר בשרת. */
export interface PartnerCandidate {
  buyerId: string;
  requirements: BuyerRequirements;
  /**
   * ‎**מי האדם שמאחורי הכרטיס — כדי שלא נשדך אותו לעצמו** (ביקורת Codex, P1).
   *
   * ‏למערכת מותר שיהיו שני כרטיסי קונה על אותו איש קשר: שתי
   * ‏דרישות שונות של אותו אדם („דירה להשקעה” ו„דירה למגורים”),
   * ‏או שארית של מיזוג כרטיסים. שני כרטיסים כאלה **אינם שני
   * ‏אנשים**, ושותפות ביניהם היא הכפלה של כוח הקנייה של אדם אחד
   * ‏— הצעה שנראית מצוינת על המסך ומתפוגגת בשיחה הראשונה.
   *
   * ‏המפתח אינו „מזהה איש הקשר” בשמו, כי המנוע אינו יודע דבר על
   * ‏אנשי קשר ואינו אמור לדעת: הוא מקבל **מפתח זהות** מהשרת, ומי
   * ‏שקורא לו מחליט מה מגדיר „אותו אדם”. חסר = הכרטיס עומד בפני
   * ‏עצמו, וזו ברירת המחדל הבטוחה למי שאין לו מידע כזה.
   */
  partnerKey?: string;
}

/** חלקו של שותף אחד בעסקה. */
export interface PartnerShare {
  buyerId: string;
  /** ‏התקציב שהצהיר — הבסיס לחלוקה, ולכן מוצג לצדה */
  budgetMaxAgorot: number;
  /** ‏חלקו במחיר. שני החלקים מסתכמים **בדיוק** במחיר. */
  shareAgorot: number;
  /** ‏הציון האישי שלו על הנכס, 0–100, בלי קריטריון התקציב */
  score: number;
}

export interface PartnerPair {
  partners: readonly [PartnerShare, PartnerShare];
  combinedBudgetAgorot: number;
  /** ‏כמה התקציב המשותף עודף על המחיר. אפס = בדיוק, וזה הצמד ההדוק ביותר. */
  headroomAgorot: number;
  /** ‏ציון הצמד, 0–100 — ראו `pairScore` */
  score: number;
  explanation: string;
}

/**
 * ‏תקרת המועמדים שנשקלים.
 *
 * ‏העלות היא קריאה ל-`scoreMatch` לכל מועמד (ליניארי), והצימוד
 * ‏עצמו הוא אריתמטיקה על צמדים (ריבועי אך זול). 60 מועמדים הם
 * ‏1,770 צמדים — זניח — ובכל זאת יש תקרה: משרד עם אלפי קונים היה
 * ‏מריץ אלפי ניקודים בכל פתיחת כרטיס נכס.
 *
 * ‏החיתוך הוא **לפי סדר הקלט**, ולכן הוא באחריות הקורא: השרת
 * ‏שולח את הקונים בסדר שהוא בוחר, והוא זה שיודע מי „הפעילים
 * ‏ביותר”. מיון כאן היה דורש לנקד את כולם — כלומר בדיוק את העלות
 * ‏שהתקרה נועדה למנוע.
 */
export const PARTNER_CANDIDATE_MAX = 60;

/** ‏כמה צמדים מוחזרים. רשימה ארוכה של שותפויות אינה נקראת. */
export const PARTNER_PAIR_LIMIT = 10;

/**
 * ‎**ציון הצמד הוא החלש מבין השניים, ולא הממוצע.**
 *
 * ‏ממוצע מאפשר להתאמה מושלמת לגרור אחריה מישהו שהנכס אינו מתאים
 * ‏לו — והתוצאה על המסך היא „92%” על צמד שאחד מחבריו לא היה נוסע
 * ‏לראות את הדירה. שותפות דורשת ששניהם ירצו; לכן החוליה החלשה היא
 * ‏הציון.
 */
export function pairScore(a: number, b: number): number {
  return Math.min(a, b);
}

/**
 * ‏חלוקת המחיר בין שני שותפים, יחסית לתקציב שהצהירו.
 *
 * ‏העיגול נעשה **כלפי מטה על הקטן**: השארית נופלת על בעל התקציב
 * ‏הגדול. חלוקה שמעגלת כלפי מעלה על הצד החלש מבקשת ממנו אגורות
 * ‏שלא הצהיר עליהן, וזה בדיוק הצד שהמספר קריטי עבורו.
 */
export function splitShares(
  priceAgorot: number,
  lowerBudget: number,
  higherBudget: number,
): { lower: number; higher: number } {
  const combined = lowerBudget + higherBudget;
  if (combined <= 0) return { lower: 0, higher: priceAgorot };
  const lower = Math.min(lowerBudget, Math.floor((priceAgorot * lowerBudget) / combined));
  return { lower, higher: priceAgorot - lower };
}

interface ScoredCandidate {
  buyerId: string;
  partnerKey: string;
  budgetMaxAgorot: number;
  score: number;
}

/**
 * ‏צמדי שותפים אפשריים לנכס, מהחזק לחלש.
 *
 * ‏מחזיר רשימה ריקה — ולא שגיאה — לכל נכס שאינו שדה המשחק: נכס
 * ‏שאינו רשום במשותף, שאינו למכירה, או בלי מחיר. „אין שותפויות”
 * ‏היא תשובה תקינה, והמסך שמציג אותה אינו צריך לדעת מדוע.
 */
export function partnerPairs(
  property: PropertyFields,
  candidates: readonly PartnerCandidate[],
  options: { limit?: number; now?: Date; weights?: MatchWeights } = {},
): PartnerPair[] {
  const price = property.priceAgorot;
  /*
   * ‎**רק מכירה.** שותפות כאן היא בעלות משותפת ברישום; שני שוכרים
   * באותה דירה הם שותפים לדירה ולא לנכס, ואין להם מה לחלק בטאבו.
   */
  if (!isSharedTabuProperty(property) || property.dealType !== "sale" || price === undefined) {
    return [];
  }
  const now = options.now ?? new Date();
  /*
   * ‎**המשקלים הם ברירת המחדל ולא של המשרד — כמו בשוק השת״פ.**
   * הצמד נשען על ציון של שני אנשים, ומשרד שכייל את המשקלים היה
   * מדרג שותפויות בסולם שאין לו משמעות משותפת.
   */
  const weights = options.weights ?? DEFAULT_MATCH_WEIGHTS;
  const band = budgetBandAgorot(price, "sale");

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    const req = candidate.requirements;
    const budget = req.budgetMaxAgorot;
    /*
     * ‏בלי תקציב מוצהר אין מה לחבר. „לא ידוע” אינו „אפס”, ולכן
     * המועמד אינו נפסל אלא פשוט אינו מועמד לשותפות — הוא ממשיך
     * להופיע בהתאמות הרגילות כמו כל קונה בלי תקציב.
     */
    if (budget === undefined) continue;
    if (req.dealType !== "sale") continue;
    if (!sharedTabuFit(true, req.sharedTabu).partnerable) continue;
    /* מי שמגיע לבד — ולו בתוך רצועת הגמישות — כבר ברשימה הרגילה */
    if (price <= budget + band) continue;
    /*
     * ‎**התקציב **נענה** על ידי הצמד — ולכן הוא מסופק, לא נמחק**
     * ‏(ביקורת Codex, P2).
     *
     * ‏מחיקת שני הקצוות הייתה הניסוח הראשון, והיא יצרה ציון שקרי:
     * ‏`scoreMatch` מודד כיסוי מול **משקל הליבה המלא**, שהתקציב
     * ‏הוא 0.25 ממנו. קריטריון שנמחק אינו נבחן, ולכן צמד מושלם
     * ‏בכל השאר קיבל תקרה של `0.5 / 0.75` — 67%, לנצח. הרשימה
     * ‏הייתה מדורגת נכון ומוצגת שקר.
     *
     * ‏והתיקון אינו נרמול ידני אלא **תיאור נכון של המצב**: בשידוך
     * ‏שותפים המחיר מכוסה בהגדרה — `combined >= price` נאכף למטה —
     * ‏ולכן התקציב של המועמד לצורך הניקוד הזה **הוא מחיר הנכס**.
     * ‏הקריטריון נבחן, מקבל „בתקציב”, והכיסוי מלא.
     *
     * ‏הרצפה נמחקת: „מתחת לרף שהוגדר” היא הסתייגות על קונה שחיפש
     * ‏יקר יותר, ואין לה משמעות כשהתקרה היא המחיר עצמו.
     */
    const fit = scoreMatch(
      property,
      { ...req, budgetMinAgorot: undefined, budgetMaxAgorot: price },
      weights,
      now,
    );
    if (fit.excluded || fit.insufficientData) continue;
    scored.push({
      buyerId: candidate.buyerId,
      partnerKey: candidate.partnerKey ?? candidate.buyerId,
      budgetMaxAgorot: budget,
      score: fit.score,
    });
    if (scored.length >= PARTNER_CANDIDATE_MAX) break;
  }

  const pairs: PartnerPair[] = [];
  for (let i = 0; i < scored.length; i += 1) {
    for (let j = i + 1; j < scored.length; j += 1) {
      const a = scored[i]!;
      const b = scored[j]!;
      /* ‏שני כרטיסים של אותו אדם אינם שותפות — ראו `partnerKey` */
      if (a.partnerKey === b.partnerKey) continue;
      const combined = a.budgetMaxAgorot + b.budgetMaxAgorot;
      /*
       * ‎**כיסוי מלא, בלי רצועת גמישות.** הרצועה קיימת כדי לתאר
       * קונה שסימן מספר עגול; שותפות שנשענת עליה היא שותפות
       * שחסר לה כסף, ומתווך שיצא לשיחה על סמכה יגלה זאת בסופה.
       */
      if (combined < price) continue;
      /*
       * ‏הקטן ראשון — ובתקציבים שווים, המזהה מכריע.
       *
       * ‏בלי שובר השוויון הצמד היה מסודר לפי סדר הקלט, ואותם
       * ‏שלושה קונים בסדר אחר היו מחזירים רשימה אחרת. „אותם
       * ‏נתונים, אותה תשובה” אינו ניקיון אלא תנאי לבדיקה: רשימה
       * ‏שמשתנה עם סדר השאילתה אי אפשר להשוות לכלום.
       */
      const [lower, higher] =
        a.budgetMaxAgorot < b.budgetMaxAgorot
          ? [a, b]
          : a.budgetMaxAgorot > b.budgetMaxAgorot
            ? [b, a]
            : a.buyerId <= b.buyerId
              ? [a, b]
              : [b, a];
      const split = splitShares(price, lower.budgetMaxAgorot, higher.budgetMaxAgorot);
      const score = pairScore(a.score, b.score);
      pairs.push({
        partners: [
          {
            buyerId: lower.buyerId,
            budgetMaxAgorot: lower.budgetMaxAgorot,
            shareAgorot: split.lower,
            score: lower.score,
          },
          {
            buyerId: higher.buyerId,
            budgetMaxAgorot: higher.budgetMaxAgorot,
            shareAgorot: split.higher,
            score: higher.score,
          },
        ],
        combinedBudgetAgorot: combined,
        headroomAgorot: combined - price,
        score,
        explanation: explainPair(score, combined - price),
      });
    }
  }

  /*
   * ‏מיון: הציון קודם, ואז הצמד ההדוק יותר. שני צמדים באותו ציון
   * אינם שווים — זה שהתקציב המשותף שלו קרוב למחיר דורש פחות ויתור
   * משני הצדדים. המזהים סוגרים את הסדר כדי שאותם נתונים יחזירו
   * תמיד אותה רשימה.
   */
  pairs.sort(
    (x, y) =>
      y.score - x.score ||
      x.headroomAgorot - y.headroomAgorot ||
      x.partners[0].buyerId.localeCompare(y.partners[0].buyerId) ||
      x.partners[1].buyerId.localeCompare(y.partners[1].buyerId),
  );
  return pairs.slice(0, options.limit ?? PARTNER_PAIR_LIMIT);
}

function explainPair(score: number, headroomAgorot: number): string {
  const fit =
    headroomAgorot === 0
      ? "התקציב המשותף מכסה את המחיר במדויק"
      : /* ‏דרך `formatIsraeliNumber` — ראו ההסבר שם על שער `verify:timezone` */
        `התקציב המשותף מכסה את המחיר בעודף של ${formatIsraeliNumber(
          Math.round(headroomAgorot / 100),
        )} ₪`;
  return `${fit}. שניהם אישרו טאבו משותף, ולשניהם הנכס מתאים (${score}% לחלש מביניהם).`;
}
