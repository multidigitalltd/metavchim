/**
 * סיכום שיחה מתוך התמלול.
 *
 * ⚠️ הבהרה שקובעת את הציפייה: זו **חילוץ**, לא סיכום של מודל שפה.
 * אין במערכת ספק LLM מחובר, ולכן הפונקציה מוצאת בטקסט את העובדות
 * שמתווך רושם בפנקס אחרי שיחה — תקציב, חדרים, אזור, ומועד חזרה —
 * ובונה מהן שורה. היא לא מנסחת מחדש ולא "מבינה" את השיחה.
 *
 * ההחלטה הזו מכוונת ולא זמנית: סיכום שנשמע חכם אבל ממציא פרט אחד
 * גרוע ממשפט יבש שכולו נכון — כי המתווך יסתמך עליו מול הלקוח. כשיחובר
 * ספק LLM אפשר יהיה להוסיף שכבה מעליו; הבסיס הזה יישאר כרשת ביטחון.
 *
 * אותה משפחה של extract-property ו-extract-person, ובאותה תבנית:
 * לוגיקה טהורה ובדוקה, שהעובד קורא לה ולא ממציא לעצמו כללים.
 */
import { parseHebrewDateTime } from "./parse-hebrew-datetime.js";
import { jerusalemWallToUtc, toJerusalemWall } from "./recurrence.js";

/*
 * ‎`type` ולא `interface`, ובכוונה: `interface` אינו מקבל חתימת
 * אינדקס משתמעת, ולכן אינו נחשב `InputJsonValue` של Prisma —
 * והכתיבה לעמודת JSON הייתה מחייבת הטלה שמכבה את הבדיקה בדיוק
 * במקום שבו הנתון עובר גבול.
 */
export type CallHighlights = {
  /** תקציב שנאמר, בשקלים. */
  budget?: number;
  rooms?: number;
  city?: string;
  /** מתי סוכם לחזור — כפי שנאמר, לא כתאריך. */
  callback?: string;
};

export interface CallSummary {
  /** שורה אחת לרשימת השיחות. */
  summary: string;
  highlights: CallHighlights;
  /**
   * תוצאה מוצעת לשיחה — **הצעה בלבד**, המתווך מאשר.
   * null = לא זוהה איתות ברור, ואז עדיף לא לנחש.
   */
  suggestedOutcome: "interested" | "not_fit" | "callback" | null;
}

/** ערים שכיחות — לזיהוי אזור ההתעניינות בלי מאגר חיצוני. */
const CITY_PATTERN =
  /(תל אביב|ירושלים|חיפה|באר שבע|ראשון לציון|פתח תקווה|נתניה|בני ברק|רמת גן|אשדוד|חולון|בת ים|רחובות|הרצליה|כפר סבא|רעננה|מודיעין|בית שמש|אשקלון|לוד|רמלה|גבעתיים|קרית גת|נהריה|עכו|טבריה|אילת|צפת|ביתר עילית|אלעד|רכסים)/u;

/**
 * תקציב. תומך ב"2.4 מיליון", "מיליון וחצי", "800 אלף" ו-"1,500,000".
 * מחזיר שקלים שלמים.
 */
function extractBudget(text: string): number | undefined {
  const million = /(\d+(?:\.\d+)?)\s*מיליון/u.exec(text);
  if (million?.[1]) {
    const base = Number(million[1]) * 1_000_000;
    // "2 מיליון וחצי" — החצי מתייחס למיליון, לא לספרה שלפניו
    return /מיליון\s+וחצי/u.test(text) ? base + 500_000 : base;
  }
  if (/מיליון\s+וחצי/u.test(text)) return 1_500_000;
  const thousand = /(\d+(?:\.\d+)?)\s*אלף/u.exec(text);
  if (thousand?.[1]) return Number(thousand[1]) * 1_000;
  const plain = /(\d{1,3}(?:,\d{3})+)/u.exec(text);
  if (plain?.[1]) return Number(plain[1].replace(/,/gu, ""));
  return undefined;
}

function extractRooms(text: string): number | undefined {
  const m = /(\d+(?:\.5)?)\s*חדרים/u.exec(text);
  return m?.[1] ? Number(m[1]) : undefined;
}

function extractCallback(text: string): string | undefined {
  const m =
    /(?:נחזור|אחזור|לחזור|נדבר|ניפגש|נקבע)[^.,;]{0,40}?(מחר|מחרתיים|היום|בערב|בבוקר|ביום ראשון|ביום שני|ביום שלישי|ביום רביעי|ביום חמישי|בשבוע הבא|בעוד יומיים|בעוד שבוע)/u.exec(
      text,
    );
  return m?.[1];
}

/**
 * איתות התוצאה.
 *
 * הסדר חשוב: שלילה נבדקת **לפני** חיוב, כי "לא מתאים לי" מכיל
 * "מתאים". בלי זה שיחה שנגמרה בסירוב הייתה מסומנת כהתעניינות —
 * והמתווך היה רודף אחרי ליד מת.
 */
function detectOutcome(text: string): CallSummary["suggestedOutcome"] {
  if (/(לא מתאים|לא מעוניין|לא רלוונטי|לא בא בחשבון|תודה אבל לא|ויתרנו|מצאנו כבר)/u.test(text)) {
    return "not_fit";
  }
  if (/(מעוניין|מתאים לי|בוא נתקדם|רוצה לראות|נשמע טוב|קבעו לי סיור)/u.test(text)) {
    return "interested";
  }
  if (/(נחזור|אחזור|לחזור אלי|תתקשר|נדבר|אחשוב|אתייעץ|נחליט)/u.test(text)) return "callback";
  return null;
}

/** ראש התמלול, לשורת סיכום כשלא זוהה שום פרט. */
function firstSentence(text: string, max = 120): string {
  const clean = text.trim().replace(/\s+/gu, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

const OUTCOME_TEXT: Record<NonNullable<CallSummary["suggestedOutcome"]>, string> = {
  interested: "הביע עניין",
  not_fit: "לא מתאים לו",
  callback: "ביקש שנחזור",
};

export function summarizeCall(transcript: string): CallSummary {
  const text = transcript.trim();
  if (text === "") {
    return { summary: "", highlights: {}, suggestedOutcome: null };
  }

  const highlights: CallHighlights = {};
  const budget = extractBudget(text);
  if (budget !== undefined) highlights.budget = budget;
  const rooms = extractRooms(text);
  if (rooms !== undefined) highlights.rooms = rooms;
  const city = CITY_PATTERN.exec(text)?.[1];
  if (city !== undefined) highlights.city = city;
  const callback = extractCallback(text);
  if (callback !== undefined) highlights.callback = callback;

  const suggestedOutcome = detectOutcome(text);

  const parts: string[] = [];
  if (suggestedOutcome) parts.push(OUTCOME_TEXT[suggestedOutcome]);
  if (highlights.rooms !== undefined) parts.push(`${highlights.rooms} חדרים`);
  if (highlights.city !== undefined) parts.push(highlights.city);
  if (highlights.budget !== undefined) {
    parts.push(
      highlights.budget >= 1_000_000
        ? `עד ${(highlights.budget / 1_000_000).toFixed(highlights.budget % 1_000_000 === 0 ? 0 : 1)} מיליון ₪`
        : `עד ${Math.round(highlights.budget / 1000)} אלף ₪`,
    );
  }
  if (highlights.callback !== undefined) parts.push(`לחזור ${highlights.callback}`);

  // לא זוהה כלום — עדיף ראש התמלול מאשר שורה ריקה שנראית כמו תקלה
  return {
    summary: parts.length > 0 ? parts.join(" · ") : firstSentence(text),
    highlights,
    suggestedOutcome,
  };
}

/* ==================== משימת המשך מהשיחה ==================== */

/**
 * ההמשך שהשיחה מחייבת.
 *
 * זה החלק שהיה חסר: התמלול כבר נכתב לציר הזמן, אבל **שום דבר במערכת
 * לא זכר שהובטח לחזור ביום ראשון.** ההבטחה נאמרה בשיחה, נשמרה כטקסט,
 * ומתה שם — והלקוח הוא זה שגילה.
 *
 * שלושה כללים קובעים מתי נוצרת משימה:
 *
 * 1. **נאמר מועד חזרה** — זו המשימה, במועד שנאמר.
 * 2. **הובע עניין בלי מועד** — מחר בבוקר, כי עניין מתקרר.
 * 3. **"לא מתאים"** — *אין* משימה. משימה שרודפת אחרי מי שאמר לא
 *    מלמדת את הסוכן לסגור משימות בלי לקרוא אותן, ואז גם האמיתיות
 *    נסגרות ככה.
 *
 * הכותרת לעולם אינה נושאת שם לקוח: המשימה מקושרת לכרטיס, והשם נקרא
 * משם. אותו כלל שחל על ההתראות ועל העוזר.
 */
export interface CallFollowUp {
  title: string;
  dueAt: Date;
  priority: "high" | "normal";
  /** מה בשיחה הצדיק את המשימה — מוצג לסוכן, כדי שלא תיראה שרירותית. */
  reason: string;
}

/** ניסוחי מועד שהמנתח הכללי אינו מכיר, כמספר ימים קדימה. */
const RELATIVE_DAYS: [pattern: RegExp, days: number][] = [
  [/בשבוע הבא/u, 7],
  [/בעוד שבוע/u, 7],
  [/בעוד יומיים/u, 2],
];

/** 10:00 בשעון ישראל ביום שמספר הימים קדימה — כמו ברירת המחדל של המנתח. */
function atTenOnDayOffset(now: Date, days: number): Date {
  const wall = toJerusalemWall(now);
  wall.setDate(wall.getDate() + days);  // נושא-שעת-קיר
  wall.setHours(10, 0, 0, 0);  // נושא-שעת-קיר
  return jerusalemWallToUtc(wall);
}

export function followUpFromCall(summary: CallSummary, now: Date): CallFollowUp | null {
  if (summary.suggestedOutcome === "not_fit") return null;

  const callback = summary.highlights.callback;
  if (callback !== undefined) {
    const relative = RELATIVE_DAYS.find(([pattern]) => pattern.test(callback));
    const dueAt = relative
      ? atTenOnDayOffset(now, relative[1])
      : parseHebrewDateTime(callback, now).date;
    if (dueAt !== undefined) {
      return {
        title: "לחזור ללקוח כפי שסוכם בשיחה",
        dueAt,
        // הבטחה ללקוח היא התחייבות, ולא "אם יהיה זמן"
        priority: "high",
        reason: `בשיחה נאמר: לחזור ${callback}`,
      };
    }
  }

  if (summary.suggestedOutcome === "interested") {
    return {
      title: "הלקוח הביע עניין — להמשיך טיפול",
      dueAt: atTenOnDayOffset(now, 1),
      priority: "high",
      reason: "בשיחה זוהה עניין ולא נקבע מועד חזרה",
    };
  }

  /*
   * "אחזור אליך" בלי מועד ובלי עניין מפורש — משימה רכה למחר. זה
   * המקרה השכיח ביותר בשיחה אמיתית, ובלי משימה הוא נשכח בדיוק כמו
   * השאר.
   */
  if (summary.suggestedOutcome === "callback") {
    return {
      title: "לחזור ללקוח אחרי השיחה",
      dueAt: atTenOnDayOffset(now, 1),
      priority: "normal",
      reason: "בשיחה סוכם לחזור, בלי מועד מדויק",
    };
  }

  return null;
}

/**
 * קריאת `calls.highlights` מהמסד — **בלי לסמוך על מה שכתוב שם.**
 *
 * העמודה היא JSONB, כלומר `unknown` בזמן ריצה: שורות שנכתבו
 * בגרסה קודמת, ייבוא, או תיקון ידני יכולים להחזיר כל צורה. הטלה
 * (`as CallHighlights`) הייתה מעבירה מחרוזת במקום מספר עד למסך,
 * ושם היא הופכת ל-„NaN חדרים” או לתקציב שנראה תקין ואינו.
 *
 * אותו נימוק כמו ב-`resolveMatchWeights`: ערך פסול נופל לבדו,
 * ואינו מפיל את שאר השדות איתו. שיחה שבה זוהה רק אזור תחזיר את
 * האזור, גם אם התקציב שנשמר לצידו מקולקל.
 */
export function parseCallHighlights(value: unknown): CallHighlights {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: CallHighlights = {};
  const positive = (raw: unknown): number | undefined =>
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
  const budget = positive(source["budget"]);
  if (budget !== undefined) out.budget = budget;
  const rooms = positive(source["rooms"]);
  if (rooms !== undefined) out.rooms = rooms;
  const city = source["city"];
  if (typeof city === "string" && city.trim() !== "") out.city = city.trim();
  const callback = source["callback"];
  if (typeof callback === "string" && callback.trim() !== "") out.callback = callback.trim();
  return out;
}

/** תוויות בעברית לשדות שחולצו — למסך, במקום אחד. */
export const CALL_HIGHLIGHT_LABELS: Record<keyof CallHighlights, string> = {
  budget: "תקציב",
  rooms: "חדרים",
  city: "אזור",
  callback: "לחזור",
};
