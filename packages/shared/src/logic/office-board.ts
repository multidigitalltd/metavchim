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
 * ‎`null` בתור `previousRank` = לא היה בתקופה הקודמת, ואז אין
 * ‏תנועה למדוד: „חודש ראשון” ולא „ירידה”.
 */
export type BoardMovement =
  | { kind: "new" }
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
): BoardMovement {
  if (previousRank === null) return { kind: "new" };
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

export function movementLabel(movement: BoardMovement): string {
  switch (movement.kind) {
    case "new":
      return "חודש ראשון";
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
 * ‎**אחוז מול היעד החודשי.**
 *
 * ‎`goal` הוא היעד שהסוכן קבע לעצמו במנטור. `null` = לא קבע, ואז
 * ‏אין אחוז להציג — עמודה ריקה עדיפה על „0%” שנראה ככישלון.
 *
 * ‏התקרה היא 100 בכוונה: הפס אינו יכול לגלוש מחוץ לתא, ומי שעבר
 * ‏את היעד רואה זאת במספרים עצמם.
 */
export function goalPercent(score: number, goal: number | null): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.min(100, Math.round((score / goal) * 100));
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

/** ‏מגמה מול התקופה הקודמת — הפרש מוחלט ואחוז, כשיש ממה. */
export function delta(now: number, before: number): { diff: number; percent: number | null } {
  return {
    diff: now - before,
    percent: before === 0 ? null : Math.round(((now - before) / before) * 100),
  };
}
