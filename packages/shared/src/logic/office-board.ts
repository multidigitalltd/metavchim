import {
  jerusalemMonthStart,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
} from "./israel-time.js";

/**
 * ‎**„המשרד שלנו” — טבלת התחרות של סוכנות.**
 *
 * ## ‏מה זה, ומה זה לא
 *
 * ‏זה **לא** דוח הסוכנים. הדוח עונה על „מה קרה”: מונים, ממוצעים,
 * ‏אחוזי המרה. המסך הזה עונה על שאלה אחרת לגמרי — „מי מוביל
 * ‏החודש” — והוא נועד לבעל סוכנות שרוצה לתלות את התוצאה על הקיר
 * ‏ולשלוח אותה לצוות.
 *
 * ‎**ולכן הוא מדרג.** דירוג הוא החלטה מוצרית עם מחיר: הוא מניע את
 * ‏מי שבראש ומייאש את מי שבתחתית. שלוש הכרעות מרככות אותו:
 *
 * 1. **הניקוד גלוי** — הנוסחה מודפסת מעל הטבלה, מאותו קבוע שמחשב
 *    ‏אותה. דירוג שלא מבינים איך נוצר הוא דירוג שלא סומכים עליו.
 * 2. **התנועה נמדדת מול החודש הקודם של אותו סוכן**, ולא מול
 *    ‏השכן. „עלייה של שני מקומות” היא הישג גם במקום השישי.
 * 3. **מי שהתחיל החודש אינו מדורג בשפת התנועה** — „ירידה” על מי
 *    ‏שאין לו חודש קודם היא שקר, ו„זקוק לדחיפה” בחודש הראשון היא
 *    ‏קבלת פנים גרועה.
 *
 * ## ‏והניסוח נייטרלי מגדרית
 *
 * ‏„עלה” / „עלתה” דורש לדעת את המגדר של אדם אמיתי, ושם פרטי אינו
 * ‏אומר אותו. כל התוויות כאן בצורה שאינה מטה — „עלייה של שני
 * ‏מקומות”, „ללא שינוי” — ולכן הן נכונות לכל מי שבטבלה.
 */

/** ‏התקופה שהטבלה מודדת. */
export const BOARD_PERIODS = ["month", "quarter", "year"] as const;
export type BoardPeriod = (typeof BOARD_PERIODS)[number];

export const BOARD_PERIOD_LABELS: Record<BoardPeriod, string> = {
  month: "החודש",
  quarter: "רבעון",
  year: "שנה",
};

/**
 * ‎**הנוסחה — מקור אחד לחישוב ולכיתוב שמעל הטבלה.**
 *
 * ‏המסך מדפיס „ניקוד = לידים ×1 · נכסים ×3 · פגישות ×2 · עסקאות
 * ‏×10”, והמספרים האלה הם **אלה**. כיתוב שנכתב ביד היה מסכים ביום
 * ‏שנכתב ומשקר ביום שמישהו שינה משקל — וזה בדיוק הרגע שבו סוכן
 * ‏סופר את הנקודות שלו ביד ומגלה שהמערכת לא מסכימה איתו.
 *
 * ‎**שיחות אינן בניקוד.** הן בטבלה כי הן מעידות על פעילות, אבל
 * ‏ניקוד עליהן היה הופך חיוג לאסטרטגיה: מי שמחייג מאה פעם ליום
 * ‏ולא מגייס דבר היה עולה על מי שגייס שלושה נכסים.
 */
export const BOARD_WEIGHTS = {
  leads: 1,
  properties: 3,
  viewings: 2,
  deals: 10,
} as const;

export type BoardMetric = keyof typeof BOARD_WEIGHTS;

export const BOARD_METRIC_LABELS: Record<BoardMetric | "calls", string> = {
  calls: "שיחות",
  leads: "לידים",
  properties: "נכסים",
  viewings: "פגישות",
  deals: "עסקאות",
};

/** ‏הכיתוב מעל הטבלה — נגזר מהמשקלים, ואינו נכתב ביד. */
export function boardFormulaText(): string {
  const parts = (Object.keys(BOARD_WEIGHTS) as BoardMetric[]).map(
    (metric) => `${BOARD_METRIC_LABELS[metric]} ×${BOARD_WEIGHTS[metric]}`,
  );
  return `ניקוד = ${parts.join(" · ")}`;
}

/**
 * ‎**מי רואה את „המשרד שלנו” — הכרעה של המשרד, לא של התפקיד.**
 *
 * ## ‏למה זה לא יכולת
 *
 * ‏המסך נפתח ל-`users.manage` בלבד, וזו הייתה הכרעה נכונה
 * ‏ליום שבו נולד: טבלה שמדרגת אנשים בשמם אינה נתון שנחשף
 * ‏בברירת מחדל. אבל התכלית שלה הפוכה — להיתלות על הקיר
 * ‏ולהישלח לצוות — ובמשרד שרוצה תחרות גלויה הסגירה היא
 * ‏בדיוק מה שמרוקן אותה מתוכן.
 *
 * ‏לכן זו אינה יכולת של תפקיד אלא **הגדרה של משרד**: בעל
 * ‏הסוכנות מחליט אם הצוות רואה את הטבלה, וההחלטה חלה על כל
 * ‏המשרד בבת אחת. יכולת הייתה מחייבת אותו להעניק ולשלול אותה
 * ‏לכל סוכן בנפרד, וזה אינו „להציג את העמוד לסוכנים”.
 *
 * ## ‏ולמה הכלל יושב כאן
 *
 * ‏שלושה מקומות שואלים אותה שאלה: השרת לפני שהוא מחזיר את
 * ‏הטבלה, הכפתור בראש המסך, והעמוד עצמו. שלושה עותקים
 * ‏של אותו תנאי הם שלושה מקומות שבהם אפשר לשכוח את הדגל —
 * ‏והשכחה בשרת היא דליפה, לא תקלת תצוגה.
 */
export function canSeeOfficeBoard(input: {
  /** ‏המשתמש מנהל את הצוות (`users.manage`) — רואה תמיד. */
  managesTeam: boolean;
  /** ‏המשרד פתח את הטבלה לסוכנים. */
  openToAgents: boolean;
}): boolean {
  return input.managesTeam || input.openToAgents;
}

/**
 * ‎**שם המפתח ב-`tenant.settings`, פעם אחת.**
 *
 * ‏ארבעה קוראים נוגעים במסמך ההגדרות עם המפתח הזה (הקריאה
 * ‏בהגדרות, הכתיבה, ה-Session והשער של הטבלה), ומחרוזת
 * ‏שמועתקת בארבעה מקומות היא מחרוזת שתשתנה בשלושה.
 */
export const BOARD_VISIBILITY_KEY = "boardVisibleToAgents";

/**
 * ‏האם המשרד פתח את הטבלה לסוכנים.
 *
 * ‎**חסר = סגור.** זו ההתנהגות שהייתה עד היום, ולכן אף משרד
 * ‏קיים אינו מגלה בוקר אחד שכל הסוכנים רואים את הדירוג של
 * ‏כולם. חשיפה של נתונים על אנשים דורשת מעשה מפורש, גם כשהיא
 * ‏בתוך אותו משרד.
 */
export function boardOpenToAgents(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return settings?.[BOARD_VISIBILITY_KEY] === true;
}

/** ‏המונים של סוכן אחד בתקופה. */
export interface BoardCounts {
  calls: number;
  leads: number;
  properties: number;
  viewings: number;
  deals: number;
}

export function boardScore(counts: BoardCounts): number {
  return (
    counts.leads * BOARD_WEIGHTS.leads +
    counts.properties * BOARD_WEIGHTS.properties +
    counts.viewings * BOARD_WEIGHTS.viewings +
    counts.deals * BOARD_WEIGHTS.deals
  );
}

/**
 * ‎**התנועה מול התקופה הקודמת — של אותו סוכן.**
 *
 * ‎`null` בתור `previousRank` = לא היה מדורג בתקופה הקודמת, ואז
 * ‏אין תנועה למדוד. אבל **אין די בזה כדי לומר „חודש ראשון”**:
 * ‏סוכן ותיק שהיה חודש בחופשה מקבל אף הוא `null`, ו„חודש ראשון”
 * ‏עליו הוא פשוט שקר (ביקורת Codex). לכן שני מצבים נפרדים, וההפרדה
 * ‏ביניהם נעשית מתאריך ההצטרפות ולא מהניקוד.
 */
export type BoardMovement =
  | { kind: "new" }
  /** ‏היה כאן, ולא היה בדירוג של התקופה הקודמת */
  | { kind: "unranked" }
  | { kind: "up"; places: number }
  | { kind: "down"; places: number }
  | { kind: "same" }
  /** ‏בתחתית הטבלה ובלי שיפור — הצורה הרכה ביותר שעוד אומרת משהו */
  | { kind: "behind" };

export function boardMovement(
  rank: number,
  previousRank: number | null,
  /** ‏כמה יש בטבלה — כדי לדעת מה „התחתית” */
  total: number,
  /** ‏האם התקופה הזו היא הראשונה של הסוכן במשרד */
  isFirstPeriod: boolean,
): BoardMovement {
  if (previousRank === null) return isFirstPeriod ? { kind: "new" } : { kind: "unranked" };
  if (previousRank > rank) return { kind: "up", places: previousRank - rank };
  if (previousRank < rank) return { kind: "down", places: rank - previousRank };
  /*
   * ‏אותו מקום, ובשליש התחתון: „ללא שינוי” שם נכון אך חסר תועלת.
   * ‏הסף הוא **שליש** ולא „המקום האחרון”: בטבלה של אחד-עשר, רק
   * ‏האחרון היה מקבל אמירה, ובטבלה של שלושה — שליש היא שורה אחת.
   */
  if (total >= 6 && rank > Math.ceil((total * 2) / 3)) return { kind: "behind" };
  return { kind: "same" };
}

/**
 * ‏„חודש ראשון” נכון רק בלשונית החודש. ברבעון ובשנה הוא היה
 * ‏אומר דבר שאינו נכון על אותה שורה בדיוק (ביקורת Codex).
 */
const FIRST_PERIOD_LABEL: Record<BoardPeriod, string> = {
  month: "חודש ראשון",
  quarter: "רבעון ראשון",
  year: "שנה ראשונה",
};

export function movementLabel(movement: BoardMovement, period: BoardPeriod): string {
  switch (movement.kind) {
    case "new":
      return FIRST_PERIOD_LABEL[period];
    case "unranked":
      return "לא היה בדירוג";
    case "up":
      return movement.places === 1 ? "עלייה של מקום" : `עלייה של ${movement.places} מקומות`;
    case "down":
      return movement.places === 1 ? "ירידה של מקום" : `ירידה של ${movement.places} מקומות`;
    case "behind":
      return "מתחת לקצב";
    case "same":
      return "ללא שינוי";
  }
}

/**
 * ‎**„הכי הרבה X” — ומה שמופיע מתחתיו.**
 *
 * ‏המרחק מהשני הוא מה שהופך את הכרטיס למידע ולא לתואר: „41 לידים”
 * ‏לבדו אינו אומר אם זה מרוץ צמוד או פער של חודש.
 *
 * ‎`null` כשאין למי להעניק — מונה אפס אינו „הכי הרבה”, וכרטיס
 * ‏שמכריז על מוביל עם אפס הוא לעג.
 */
export interface Superlative {
  metric: BoardMetric | "calls";
  name: string;
  value: number;
  /** ‏הפער מהשני; `null` כשאין שני. */
  lead: number | null;
}

export function superlative(
  metric: BoardMetric | "calls",
  rows: readonly { name: string; counts: BoardCounts }[],
): Superlative | null {
  const sorted = [...rows].sort((a, b) => b.counts[metric] - a.counts[metric]);
  const first = sorted[0];
  if (first === undefined || first.counts[metric] === 0) return null;
  const second = sorted[1];
  return {
    metric,
    name: first.name,
    value: first.counts[metric],
    lead: second === undefined ? null : first.counts[metric] - second.counts[metric],
  };
}

export function superlativeNote(item: Superlative): string {
  if (item.lead === null) return "היחיד בטבלה";
  if (item.lead === 0) return "שוויון עם הבא אחריו";
  return `+${item.lead} מהשני`;
}

/**
 * ‎**היעד של המנטור — מדד מול אותו מדד.**
 *
 * ## ‏מה היה כאן, ולמה זה היה שגוי
 *
 * ‏קודם העמודה חילקה את **הניקוד המשוקלל** ביעד של המנטור. אבל
 * ‏יעד במנטור הוא תמיד על מדד מסוים — „100 שיחות”, „2 עסקאות” —
 * ‏והניקוד הוא סכום של חמישה מדדים שונים במשקלים שונים. „2 עסקאות”
 * ‏מול ניקוד 47 אינו יחס שאומר משהו, והמספר שהתקבל נראה כמו אחוז
 * ‏והיה רעש (ביקורת Codex).
 *
 * ‏ובאותה נשימה: לסוכן יכולים להיות כמה יעדים חודשיים פעילים
 * ‏במקביל, ומפה שנבנית מהם שומרת את האחרון שנקרא — כלומר העמודה
 * ‏הייתה משתנה לפי סדר שאין לו משמעות.
 *
 * ## ‏מה כאן במקום
 *
 * ‏רק יעדים שהטבלה **יודעת למדוד**, כל אחד מול המונה שלו. כשיש
 * ‏כמה — נבחר זה שהכי רחוק מהיעד, כי זה מה ששווה להסתכל עליו
 * ‏בטבלת ביצועים; הבחירה דטרמיניסטית, והמדד מוצג בשמו כדי
 * ‏שהאחוז יהיה קריא.
 */
export const BOARD_GOAL_METRIC: Readonly<Record<string, BoardMetric | "calls">> = {
  deals_closed: "deals",
  viewings_held: "viewings",
  new_properties: "properties",
  calls_made: "calls",
};
/*
 * ‎**מה במכוון אינו כאן.** `leads_answered` הוא לידים ש**נענו**,
 * ‏והטבלה סופרת לידים ש**נכנסו** — שני מספרים שונים, והשוואה
 * ‏ביניהם הייתה חוזרת על אותה טעות בדיוק בלבוש אחר. `new_buyers`
 * ‏אינו מדד של הטבלה כלל.
 */

export interface BoardGoal {
  metric: BoardMetric | "calls";
  /** ‏שם המדד בעברית — בלעדיו האחוז אינו קריא */
  label: string;
  target: number;
  actual: number;
  /** ‏מוגבל ל-100: הפס אינו גולש מהתא, והמספרים מראים את העודף */
  percent: number;
}

export function boardGoal(
  counts: BoardCounts,
  goals: readonly { metric: string; target: number }[],
): BoardGoal | null {
  let pick: BoardGoal | null = null;
  for (const goal of goals) {
    /*
     * ‎`Object.hasOwn` לפני הקריאה: אינדוקס רגיל על `Record<string,…>`
     * ‏מוצא גם את `constructor` שיורש מ-`Object.prototype`, ומחזיר
     * ‏פונקציה במקום `undefined`. אותה משפחה בדיוק של התקלה
     * ‏ש-Codex מצא ב-`updateOfficePolicy` — ו**הבדיקה כאן מצאה
     * ‏אותה שוב**, בקוד שנכתב אחריה.
     */
    if (!Object.hasOwn(BOARD_GOAL_METRIC, goal.metric)) continue;
    const metric = BOARD_GOAL_METRIC[goal.metric];
    if (metric === undefined || goal.target <= 0) continue;
    const actual = counts[metric];
    const candidate: BoardGoal = {
      metric,
      label: BOARD_METRIC_LABELS[metric],
      target: goal.target,
      actual,
      percent: Math.min(100, Math.round((actual / goal.target) * 100)),
    };
    /* ‏הרחוק ביותר מהיעד; שוויון נשבר לטובת הראשון שנקרא */
    if (pick === null || candidate.percent < pick.percent) pick = candidate;
  }
  return pick;
}

/** ‏ראשי התיבות שבעיגול — שתי מילים ראשונות, אות מכל אחת. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter((w) => w !== "");
  if (words.length === 0) return "??";
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return letters.join('"') || "??";
}

/**
 * ‏כותרת התקופה — „אוגוסט 2026”, „רבעון 3 2026”, „2026”.
 *
 * ‏נגזרת מהשעון הישראלי ולא מ-`toLocaleString`: הסביבה בשרת היא
 * ‎UTC, ובשעתיים הראשונות של החודש היא הייתה מדווחת על הקודם.
 */
const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

export function periodTitle(period: BoardPeriod, now: Date): string {
  const [year, month] = jerusalemWallParts(now).date.split("-").map(Number) as [number, number];
  if (period === "year") return String(year);
  if (period === "quarter") return `רבעון ${Math.ceil(month / 3)} ${year}`;
  return `${MONTHS[month - 1] ?? ""} ${year}`;
}

/** ‏„מול יולי” — שם התקופה הקודמת, לשורת ההשוואה. */
export function previousPeriodTitle(period: BoardPeriod, now: Date): string {
  const [year, month] = jerusalemWallParts(now).date.split("-").map(Number) as [number, number];
  if (period === "year") return String(year - 1);
  if (period === "quarter") {
    const q = Math.ceil(month / 3);
    return q === 1 ? `רבעון 4 ${year - 1}` : `רבעון ${q - 1} ${year}`;
  }
  return month === 1 ? `דצמבר ${year - 1}` : `${MONTHS[month - 2] ?? ""} ${year}`;
}

/**
 * ‏תחילת התקופה בשעון ישראל — הגבול שכל השאילתות סופרות ממנו.
 *
 * ‎`jerusalemMonthStart` כבר עושה את החודש נכון; רבעון ושנה נגזרים
 * ‏ממנו באותו אופן, ולא מ-`new Date(year, ...)` שרץ בשעון השרת.
 */
export function periodStart(period: BoardPeriod, now: Date): Date {
  if (period === "month") return jerusalemMonthStart(now);
  const [year, month] = jerusalemWallParts(now).date.split("-").map(Number) as [number, number];
  /*
   * ‏החודש הראשון של התקופה נבנה מהמספר ולא בחיסור ימים: חיסור של
   * ‎„31 יום פעמיים” מדלג על פברואר ונוחת בחודש הלא נכון.
   */
  const first = period === "year" ? 1 : (Math.ceil(month / 3) - 1) * 3 + 1;
  return jerusalemWallIsoToUtc(`${year}-${String(first).padStart(2, "0")}-01T00:00:00.000`);
}

/**
 * ‎**סוף התקופה (לא כולל) — הגבול העליון שכל השאילתות עוצרות בו.**
 *
 * ‏בלעדיו החלון הנוכחי היה פתוח מלמעלה, ופגישה שנקבעה למרץ הבא
 * ‏הייתה נספרת כבר עכשיו: הפגישות מסוננות לפי `startsAt`, שהוא
 * ‏הזמן **העתידי** שנקבע ולא זמן ההתרחשות (ביקורת Codex). שאר
 * ‏המדדים נספרים לפי זמני יצירה ועדכון ולכן אינם יכולים להיות
 * ‏בעתיד — אבל חלון חסום לכולם הוא כלל אחד במקום ארבעה.
 */
export function periodEnd(period: BoardPeriod, now: Date): Date {
  const [year, month] = jerusalemWallParts(now).date.split("-").map(Number) as [number, number];
  if (period === "year") return jerusalemWallIsoToUtc(`${year + 1}-01-01T00:00:00.000`);
  const first =
    period === "quarter" ? (Math.ceil(month / 3) - 1) * 3 + 1 : month;
  const step = period === "quarter" ? 3 : 1;
  const next = first + step;
  const y = next > 12 ? year + 1 : year;
  const m = next > 12 ? next - 12 : next;
  return jerusalemWallIsoToUtc(`${y}-${String(m).padStart(2, "0")}-01T00:00:00.000`);
}

/** ‏מגמה מול התקופה הקודמת — הפרש מוחלט ואחוז, כשיש ממה. */
export function delta(now: number, before: number): { diff: number; percent: number | null } {
  return {
    diff: now - before,
    percent: before === 0 ? null : Math.round(((now - before) / before) * 100),
  };
}
