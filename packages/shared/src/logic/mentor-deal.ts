/**
 * העסקה הקרובה ביותר — קונה אחד, מכשול אחד (docs/14 §7.6).
 *
 * המנטור עובד במדדים; מתווך סוגר עסקאות עם אנשים. פעם בשבוע המנטור
 * מסתכל על הקונים של המתווך עצמו ומצביע על אחד: מי שראה נכס פעמיים
 * ולא הציע, או אמר „מעוניין” — ואין לו צעד הבא קבוע — ושואל מה חסר לו.
 * **שיפוט, לא תזכורת**: המערכת כבר מזכירה סיור בלי מעקב; כאן השאלה
 * היא „מה עוצר את העסקה”, והצעד הוא לשאול, לא להציע עוד נכס.
 *
 * הלוגיקה טהורה: ה-API מביא מועמדים (הקונים של המתווך עם הסיורים
 * וההצעות של 30 הימים האחרונים), וכאן בוחרים אחד ומנסחים.
 */

export const CLOSEST_DEAL_WINDOW_DAYS = 30;
/** סיור אחד הוא התחלה; שניים בלי הצעה הם קונה שמתלבט */
export const CLOSEST_DEAL_MIN_VIEWINGS = 2;
/** אחרי שלושה שבועות בלי סיור — הקונה מתקרר, והציון יורד */
const STALE_DAYS = 21;

export interface DealCandidate {
  buyerId: string;
  /** שם הקונה — של המתווך עצמו, בהרשאתו */
  name: string;
  /** סיורים שהתקיימו ב-30 הימים האחרונים */
  viewings: number;
  /** על כמה נכסים שונים — מבין הסיורים שנרשם בהם נכס */
  distinctProperties: number;
  /**
   * סיורים שנרשמו בלי נכס. עליהם אי אפשר לומר „אותו נכס” או „כמה
   * נכסים” — וכשיש כאלה, הניסוח נשאר על מה שידוע: סייר ולא הציע.
   */
  unknownProperties: number;
  lastViewingAt: Date | null;
  /** הנכס של הסיור האחרון — „הרצל 12, תל אביב” */
  lastProperty: string | null;
  /** הצעות שהקונה ענה עליהן „מעוניין” */
  interestedOffers: number;
  /** הצעות שנשלחו ונפתחו ולא נענו */
  pendingOffers: number;
  /** very_hot | hot | interested | not_ripe */
  maturity: string;
  /**
   * כבר נקבע צעד הבא — סיור, פגישה או שיחה עתידיים, או משימה פתוחה על
   * הקונה. קונה כזה אינו תקוע, ולכן אינו „העסקה הקרובה ביותר”: השאלה
   * „מה הצעד שעוד לא נקבע” הייתה שקר.
   */
  hasNextStep: boolean;
}

export interface MentorClosestDeal {
  buyerId: string;
  name: string;
  /** מה ראינו — עובדה: „2 סיורים (הרצל 12) בשבועיים האחרונים, בלי הצעה” */
  reason: string;
  /** מה לשאול — שאלה אחת שפותחת את המכשול */
  question: string;
  /** הצעד: לשאול, לא להציע עוד נכס */
  step: string;
  score: number;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function dealScore(c: DealCandidate, now: Date): number {
  const maturity = c.maturity === "very_hot" ? 3 : c.maturity === "hot" ? 1 : 0;
  const stale =
    c.lastViewingAt !== null && daysBetween(c.lastViewingAt, now) > STALE_DAYS
      ? 2
      : 0;
  return (
    c.viewings * 2 + c.interestedOffers * 3 + c.pendingOffers + maturity - stale
  );
}

function viewingsWord(n: number): string {
  return n === 1 ? "סיור אחד" : n === 2 ? "שני סיורים" : `${n} סיורים`;
}

/** הקונה הכי קרוב לסגירה — או `null` כשאין מי שעומד בסף. */
export function closestDeal(
  candidates: readonly DealCandidate[],
  now: Date,
): MentorClosestDeal | null {
  const eligible = candidates.filter(
    (c) =>
      !c.hasNextStep &&
      (c.viewings >= CLOSEST_DEAL_MIN_VIEWINGS || c.interestedOffers > 0),
  );
  if (eligible.length === 0) return null;
  const best = [...eligible].sort(
    (a, b) =>
      dealScore(b, now) - dealScore(a, now) ||
      (b.lastViewingAt?.getTime() ?? 0) - (a.lastViewingAt?.getTime() ?? 0) ||
      a.buyerId.localeCompare(b.buyerId),
  )[0]!;

  // „אותו נכס” / „כמה נכסים” נאמרים רק כשכל הסיורים נרשמו עם נכס
  const known = best.unknownProperties === 0;
  const where =
    best.lastProperty === null || best.lastProperty === ""
      ? ""
      : known && best.distinctProperties === 1
        ? ` ב${best.lastProperty}`
        : ` (האחרון ב${best.lastProperty})`;
  const parts: string[] = [];
  if (best.viewings > 0)
    parts.push(
      `${viewingsWord(best.viewings)}${where} ב-${CLOSEST_DEAL_WINDOW_DAYS} הימים האחרונים`,
    );
  if (best.interestedOffers > 0)
    parts.push(
      best.interestedOffers === 1
        ? "ענה „מעוניין” על הצעה"
        : `ענה „מעוניין” על ${best.interestedOffers} הצעות`,
    );
  const noOffer = best.interestedOffers === 0 && best.pendingOffers === 0;
  const reason = `${parts.join(", ")}${noOffer ? ", ובלי הצעה על השולחן" : ""}`;

  const question =
    best.interestedOffers > 0
      ? "אמר שמעוניין — מה הצעד הבא שעוד לא נקבע, ומי עוד צריך להגיד כן?"
      : known && best.distinctProperties === 1
        ? "ראה את אותו נכס פעמיים ולא הציע — מה עוצר? מחיר, מימון, או מישהו שמחליט איתו?"
        : known && best.distinctProperties > 1
          ? "ראה כמה נכסים ולא הציע על אף אחד — מה באמת מחפש, ומה חסר במה שראה?"
          : // סיור בלי נכס רשום — לא ידוע אם אותו נכס או כמה; לא ממציאים
            "סייר ולא הציע — מה עוצר? מחיר, מימון, או מישהו שמחליט איתו?";
  const step =
    "טלפון אחד היום — לשאול, לא להציע עוד נכס. ואז לקבוע צעד: סיור עם מי שמחליט, יועץ משכנתאות, או הצעה בכתב.";
  return {
    buyerId: best.buyerId,
    name: best.name,
    reason,
    question,
    step,
    score: dealScore(best, now),
  };
}

/** שורה אחת — לבוקר של יום שני ולפרומפט. */
export function closestDealLine(deal: MentorClosestDeal): string {
  return `העסקה הקרובה ביותר: ${deal.name} — ${deal.reason}. ${deal.question}`;
}
