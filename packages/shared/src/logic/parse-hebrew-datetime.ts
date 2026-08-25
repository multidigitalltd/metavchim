/**
 * פענוח תאריך ושעה מעברית מדוברת — "מחר בעשר", "יום שלישי ב-4",
 * "11 באוגוסט בשעה 5", "בעוד שעתיים". מנוע חוקים דטרמיניסטי.
 *
 * `now` מוזרק תמיד (ולא נלקח מהשעון הפנימי) כדי שהפענוח יהיה ניתן
 * לבדיקה ועקבי בין השרת לדפדפן.
 *
 * **הכול נעשה בשעון ירושלים.** החישוב רץ על שעת-קיר ירושלמית ומומר
 * לרגע אחד בסוף. קודם הוא השתמש ב-`setHours` על שעון התהליך: ה-API
 * רץ ב-UTC, ולכן "בשעה 5" נשמר כ-05:00 UTC והוצג למתווך כ-08:00 —
 * כל פגישה שנקבעה בקול נקבעה שלוש שעות מאוחר מדי. `toJerusalemWall`
 * ו-`jerusalemWallToUtc` כבר קיימות ומכוסות בבדיקות; העתק שלישי של
 * אריתמטיקת אזורי זמן היה בדיוק מה שמייצר את הפער הזה שוב.
 */
import { jerusalemWallToUtc, toJerusalemWall } from "./recurrence.js";

export interface ParsedDateTime {
  /** התאריך שזוהה; undefined = לא זוהה ויש לבקש מהמתווך */
  date?: Date;
  /** האם השעה נאמרה במפורש (אחרת נבחרה ברירת מחדל 10:00) */
  timeExplicit: boolean;
  evidence?: string;
}

const WEEKDAYS: [RegExp, number][] = [
  [/יום ראשון|ביום ראשון|ראשון/u, 0],
  [/יום שני|ביום שני|שני/u, 1],
  [/יום שלישי|ביום שלישי|שלישי/u, 2],
  [/יום רביעי|ביום רביעי|רביעי/u, 3],
  [/יום חמישי|ביום חמישי|חמישי/u, 4],
  [/יום שישי|ביום שישי|שישי/u, 5],
  [/שבת|מוצ["״]ש/u, 6],
];

const HOUR_WORDS: Record<string, number> = {
  אחת: 1, שתיים: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6,
  שבע: 7, שמונה: 8, תשע: 9, עשר: 10, "אחת עשרה": 11, "שתים עשרה": 12,
};

/* ==================== „עוד שעה” ==================== */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * יחידות זמן יחסיות. הזוגי בעברית הוא **מילה ולא מספר**, ולכן
 * „שעתיים” ו„יומיים” נושאים את הכמות בתוכם.
 */
interface RelativeUnit {
  pattern: RegExp;
  ms: number;
  /**
   * הכמות הגדולה ביותר שאדם אומר ביחידה הזו.
   *
   * הגבול הוא **לפי יחידה** ולא סכום אחד: „עוד 900 שעות” הן כחודש
   * וחצי, כלומר הן עוברות כל תקרת משך סבירה — אבל איש אינו אומר
   * אותן, וזה תמלול שגוי או הקלדה. „עוד 45 ימים” הוא אותו משך
   * בדיוק והוא לגיטימי לגמרי. מה שמבדיל ביניהם הוא היחידה.
   */
  max: number;
}

const RELATIVE_UNITS: RelativeUnit[] = [
  // הזוגי בעברית הוא מילה ולא מספר — היחידה נושאת את הכמות
  { pattern: /^שעתיים$/u, ms: 2 * HOUR_MS, max: 1 },
  { pattern: /^יומיים$/u, ms: 2 * DAY_MS, max: 1 },
  { pattern: /^שבועיים$/u, ms: 14 * DAY_MS, max: 1 },
  /*
   * הרבים בעברית אינו סיומת שאפשר לסמן ב-`?`: „שעות” אינו „שעה”
   * ועוד אות. כל צורה נכתבת במלואה — קיצור כאן היה מזהה את הרבים
   * ומפספס בדיוק את היחיד, שהוא הצורה השכיחה בשיחה.
   */
  { pattern: /^דקה$|^דקות$/u, ms: MINUTE_MS, max: 180 },
  { pattern: /^שעה$|^שעות$/u, ms: HOUR_MS, max: 48 },
  { pattern: /^יום$|^ימים$/u, ms: DAY_MS, max: 60 },
  { pattern: /^שבוע$|^שבועות$/u, ms: 7 * DAY_MS, max: 8 },
];

/**
 * כמויות שנאמרות במילה. „רבע שעה” ו„חצי שעה” הן הצורות השכיחות
 * ביותר בשיחה, ושתיהן שברים — ולכן הן חלק מאותה טבלה.
 */
const QUANTITY_WORDS: Record<string, number> = {
  רבע: 0.25, חצי: 0.5,
  אחת: 1, אחד: 1, שתי: 2, שתיים: 2, שני: 2, שלוש: 3, שלושה: 3,
  ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7,
  שמונה: 8, שמונת: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
  עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50,
};

function unitOf(word: string): RelativeUnit | undefined {
  return RELATIVE_UNITS.find((unit) => unit.pattern.test(word));
}

function quantityOf(word: string): number | undefined {
  if (/^\d+$/u.test(word)) return Number(word);
  return QUANTITY_WORDS[word];
}

/**
 * „עוד שעה”, „בעוד עשרים דקות”, „תוך יומיים” ⟵ היסט במילישניות.
 *
 * ## למה זה נכתב מחדש
 *
 * הצורה הקודמת דרשה את המילה `בעוד` בדיוק, וכיסתה שעות בלבד. מתווך
 * שענה לסוכן „תזכיר לי להתקשר אליו **עוד שעה**” — בלי בי"ת, כפי
 * שאומרים — לא נענה כלל, ו„עוד שעה” הופיע במסך תחת „נאמר ולא שויך
 * לשדה” (דיווח מהשטח, עם צילום). ביטוי הזמן הבסיסי ביותר בעברית
 * נפל בדיוק בגלל אות אחת.
 *
 * ## למה חישוב על הרגע ולא על שעון הקיר
 *
 * „בעוד שעתיים” הוא אריתמטיקה על **הרגע**: ביום מעבר שעון הוא בדיוק
 * שעתיים, גם אם שעון הקיר קפץ.
 */
export function parseRelativeOffset(text: string): { ms: number; evidence: string } | null {
  const trigger = /(?<lead>ב?עוד|תוך)\s+(?<rest>\S+)(?:\s+(?<tail>\S+))?/u.exec(text);
  const lead = trigger?.groups?.["lead"];
  const first = trigger?.groups?.["rest"];
  if (lead === undefined || first === undefined) return null;

  // „שעתיים”, „שעה” — היחידה עומדת לבדה ונושאת את הכמות שלה
  const alone = unitOf(first);
  if (alone !== undefined) return { ms: alone.ms, evidence: `${lead} ${first}` };

  // „עשרים דקות”, „רבע שעה”, „3 ימים”
  const second = trigger?.groups?.["tail"];
  const quantity = quantityOf(first);
  if (quantity === undefined || second === undefined) return null;
  const unit = unitOf(second);
  if (unit === undefined || quantity > unit.max) return null;
  const ms = Math.round(quantity * unit.ms);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return { ms, evidence: `${lead} ${first} ${second}` };
}

/** שמות החודשים הלועזיים כפי שאומרים אותם. */
const MONTH_NAMES: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6,
  יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};

/**
 * "11 **לשמיני**" — החודש בצורה סודרת, כפי שמדברים בעברית.
 *
 * דורש מספר יום לפניו, ולכן "יום שלישי" אינו נתפס כאן בטעות: בלי
 * הספרה זו סתם מילה, ועם הספרה זה כמעט תמיד תאריך.
 */
const ORDINAL_MONTHS: Record<string, number> = {
  ראשון: 1, שני: 2, שלישי: 3, רביעי: 4, חמישי: 5, שישי: 6,
  שביעי: 7, שמיני: 8, תשיעי: 9, עשירי: 10, "אחד עשר": 11, "שנים עשר": 12,
};

/** כמה ימים יש בחודש — כולל פברואר של שנה מעוברת. */
function daysInMonth(year: number, month: number): number {
  // היום ה-0 של החודש הבא הוא היום האחרון של החודש המבוקש
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** שעה מהטקסט: "בעשר", "ב-16:30", "בשעה 4", "ב-9 בבוקר" */
function parseTime(text: string): { hour: number; minute: number; evidence: string } | undefined {
  let hour: number | undefined;
  let minute = 0;
  let evidence: string | undefined;

  // פורמט מספרי: 16:30 / 9:00
  const hhmm = /(?:בשעה\s*|ב-?\s*)?(?<h>[01]?\d|2[0-3]):(?<m>[0-5]\d)/u.exec(text);
  if (hhmm?.groups?.["h"] !== undefined && hhmm.groups["m"] !== undefined) {
    hour = Number(hhmm.groups["h"]);
    minute = Number(hhmm.groups["m"]);
    evidence = hhmm[0];
  } else {
    // שעה עגולה במספר: "בשעה 4", "ב-16"
    const numeric = /(?:בשעה\s*|ב-\s*)(?<h>[01]?\d|2[0-3])(?!\d)/u.exec(text);
    // שעה במילים: "בעשר", "בשמונה וחצי"
    const wordMatch =
      /ב?(?<word>אחת עשרה|שתים עשרה|אחת|שתיים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר)(?<half>\s*וחצי)?/u.exec(
        text,
      );
    if (numeric?.groups?.["h"] !== undefined) {
      hour = Number(numeric.groups["h"]);
      evidence = numeric[0];
    } else if (wordMatch?.groups?.["word"] !== undefined) {
      hour = HOUR_WORDS[wordMatch.groups["word"]];
      evidence = wordMatch[0];
      if (wordMatch.groups["half"]) minute = 30;
    }
    if (hour !== undefined && /\s*וחצי/u.test(text) && minute === 0) minute = 30;
  }

  if (hour === undefined) return undefined;

  /*
   * הכרעת בוקר/ערב — **גם על 5:00 ולא רק על "5"**.
   *
   * קודם הענף של hh:mm חזר מיד ודילג על ההכרעה, ולכן "בשעה 5" נתן
   * 17:00 בזמן ש"בשעה 5:00" נתן 05:00. אותו משפט, אותה כוונה, שתי
   * תוצאות — ואחת מהן היא פגישה בחמש לפנות בוקר.
   */
  if (/בערב|בלילה|אחרי הצהריים|אחה["״]צ/u.test(text) && hour < 12) hour += 12;
  else if (!/בבוקר|בצהריים/u.test(text) && hour >= 1 && hour <= 7) hour += 12; // "ב-4" ⇒ 16:00

  return { hour, minute, evidence: evidence ?? "" };
}

/**
 * תאריך מפורש: "11 באוגוסט", "11 לשמיני", "בתאריך 11.8".
 *
 * הצורה המספרית דורשת "בתאריך" או שנה מלאה בכוונה: "3.5 חדרים"
 * בתוך אותו משפט היה נקרא כ-3 במאי, וניחוש כזה גרוע מלא לזהות
 * תאריך בכלל — המתווך לפחות רואה שדה ריק ומשלים אותו.
 */
function parseExplicitDate(
  text: string,
): { day: number; month: number; year?: number; evidence: string } | undefined {
  const monthNames = Object.keys(MONTH_NAMES).join("|");
  const byName = new RegExp(`(?<d>[0-3]?\\d)\\s*[בל]?(?<mon>${monthNames})`, "u").exec(text);
  if (byName?.groups?.["d"] && byName.groups["mon"]) {
    return {
      day: Number(byName.groups["d"]),
      month: MONTH_NAMES[byName.groups["mon"]]!,
      evidence: byName[0],
    };
  }

  const ordinals = Object.keys(ORDINAL_MONTHS).join("|");
  /*
   * ‎`(?![א-ת])`‎ ולא ‎`\b`‎: גבול המילה של JavaScript מוגדר מול ‎`\w`‎,
   * שהוא ASCII בלבד — אחרי אות עברית הוא לעולם אינו מתקיים, והביטוי
   * כולו לא היה תופס דבר. תקלה שקטה: הביטוי נראה נכון לגמרי.
   */
  const byOrdinal = new RegExp(`(?<d>[0-3]?\\d)\\s*[בל](?<mon>${ordinals})(?![א-ת])`, "u").exec(
    text,
  );
  if (byOrdinal?.groups?.["d"] && byOrdinal.groups["mon"]) {
    return {
      day: Number(byOrdinal.groups["d"]),
      month: ORDINAL_MONTHS[byOrdinal.groups["mon"]]!,
      evidence: byOrdinal[0],
    };
  }

  const numeric =
    /(?:בתאריך\s*|ה-)(?<d>[0-3]?\d)[./](?<m>[01]?\d)(?:[./](?<y>\d{4}))?|(?<d2>[0-3]?\d)[./](?<m2>[01]?\d)[./](?<y2>\d{4})/u.exec(
      text,
    );
  const day = numeric?.groups?.["d"] ?? numeric?.groups?.["d2"];
  const month = numeric?.groups?.["m"] ?? numeric?.groups?.["m2"];
  if (day !== undefined && month !== undefined) {
    const year = numeric?.groups?.["y"] ?? numeric?.groups?.["y2"];
    return {
      day: Number(day),
      month: Number(month),
      ...(year ? { year: Number(year) } : {}),
      evidence: numeric![0],
    };
  }
  return undefined;
}

export function parseHebrewDateTime(transcript: string, now: Date): ParsedDateTime {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const time = parseTime(text);
  const evidenceParts: string[] = [];

  /*
   * "בעוד שעתיים" הוא אריתמטיקה על **הרגע** ולא על שעון הקיר, ולכן
   * הוא מחושב לפני המעבר לשעון ירושלמי: ביום מעבר שעון "בעוד שעתיים"
   * הוא בדיוק שעתיים, גם אם שעון הקיר קפץ.
   */
  const relative = /מחר|מחרתיים|היום/u.test(text) ? null : parseRelativeOffset(text);
  if (relative !== null) {
    const at = new Date(now.getTime() + relative.ms);
    at.setSeconds(0, 0);
    return { date: at, timeExplicit: true, evidence: relative.evidence };
  }

  // מכאן והלאה החישוב הוא בשעון קיר ירושלמי, והמרה אחת בסוף
  const base = toJerusalemWall(now);
  base.setSeconds(0, 0);

  let wall: Date | undefined;

  /*
   * **תאריך מפורש גובר על מילה יחסית.**
   *
   * תמלול אמיתי מכיל את שניהם ("היום 11 לשמיני"), כי הדובר תיקן את
   * עצמו או שהתמלול שגה. "11 לשמיני" הוא המידע הספציפי; "היום" הוא
   * מילת מילוי שיכולה להיות שריד. בחירה ב"היום" קבעה את הפגישה
   * ליום הלא נכון בלי שום סימן לכך במסך.
   */
  const explicit = parseExplicitDate(text);
  if (explicit) {
    /*
     * בלי שנה מפורשת: תאריך שכבר חלף שייך לשנה הבאה. ההשוואה היא
     * **בין ימי לוח** ולא בין רגעים.
     *
     * קודם היא הפחיתה יממה כדי לא לגלגל תאריך שהוא היום עצמו אחרי
     * שהשעה כבר עברה — ובדיוק בגלל זה "9 באוגוסט" שנאמר ב-10 באוגוסט
     * נפל בין הכיסאות: הוא בדיוק יממה אחורה, לא עמד בתנאי, ונשמר
     * כפגישה בעבר. נתיב הפגישות מקבל זמנים בעבר, ולכן זה נשמר בשקט
     * (ביקורת Codex).
     */
    const year = explicit.year ?? base.getFullYear();
    const beforeToday =
      explicit.month < base.getMonth() + 1 ||
      (explicit.month === base.getMonth() + 1 && explicit.day < base.getDate());
    const chosenYear = explicit.year === undefined && beforeToday ? year + 1 : year;

    /*
     * **תאריך לא חוקי נדחה ולא מנורמל.**
     *
     * ‎`setFullYear`‎ מגלגל בשקט: "31 בפברואר" הופך ל-3 במרץ, ו"10.19"
     * לחודש שאינו קיים. התוצאה הוצגה כתאריך שזוהה בהצלחה, כלומר
     * המתווך אישר פגישה ביום שאיש לא אמר. שדה ריק עדיף — הוא לפחות
     * נראה כמו משהו שצריך למלא (ביקורת Codex).
     */
    if (
      explicit.month >= 1 &&
      explicit.month <= 12 &&
      explicit.day >= 1 &&
      explicit.day <= daysInMonth(chosenYear, explicit.month)
    ) {
      wall = new Date(base);
      wall.setFullYear(chosenYear, explicit.month - 1, explicit.day);
      evidenceParts.push(explicit.evidence);
    }
  }

  if (wall === undefined) {
    if (/מחרתיים/u.test(text)) {
      wall = new Date(base);
      wall.setDate(wall.getDate() + 2);
      evidenceParts.push("מחרתיים");
    } else if (/מחר/u.test(text)) {
      wall = new Date(base);
      wall.setDate(wall.getDate() + 1);
      evidenceParts.push("מחר");
    } else if (/היום/u.test(text)) {
      wall = new Date(base);
      evidenceParts.push("היום");
    } else {
      // --- יום בשבוע: הקרוב שעוד לא עבר ---
      for (const [pattern, weekday] of WEEKDAYS) {
        const match = pattern.exec(text);
        if (!match) continue;
        wall = new Date(base);
        const diff = (weekday - base.getDay() + 7) % 7;
        wall.setDate(wall.getDate() + (diff === 0 ? 7 : diff));
        evidenceParts.push(match[0]);
        break;
      }
    }
  }

  if (wall === undefined) return { timeExplicit: false };

  if (time) {
    wall.setHours(time.hour, time.minute, 0, 0);
    if (time.evidence) evidenceParts.push(time.evidence);
  } else {
    wall.setHours(10, 0, 0, 0); // ברירת מחדל — המתווך רואה ומתקן
  }

  return {
    date: jerusalemWallToUtc(wall),
    timeExplicit: time !== undefined,
    evidence: evidenceParts.join(" "),
  };
}

/** סוג הפגישה מהטקסט — סיור בנכס הוא ברירת המחדל של מתווך. */
export function parseAppointmentKind(transcript: string): "viewing" | "meeting" | "call" {
  if (/שיחה|טלפון|לדבר/u.test(transcript)) return "call";
  if (/סיור|ביקור|להראות|לראות את הדירה|לראות את הנכס/u.test(transcript)) return "viewing";
  return "meeting";
}
