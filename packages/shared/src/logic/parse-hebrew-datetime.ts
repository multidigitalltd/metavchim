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
  const inHours = /בעוד\s+(?<n>שעה|שעתיים|\d+)\s*(?:שעות)?/u.exec(text);
  if (inHours?.groups?.["n"] !== undefined && !/מחר|מחרתיים|היום/u.test(text)) {
    const raw = inHours.groups["n"];
    const hours = raw === "שעה" ? 1 : raw === "שעתיים" ? 2 : Number(raw);
    if (!Number.isNaN(hours) && hours > 0 && hours <= 72) {
      const at = new Date(now.getTime() + hours * 60 * 60 * 1000);
      at.setSeconds(0, 0);
      return { date: at, timeExplicit: true, evidence: inHours[0] };
    }
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
    wall = new Date(base);
    const year = explicit.year ?? base.getFullYear();
    wall.setFullYear(year, explicit.month - 1, explicit.day);
    /*
     * בלי שנה מפורשת: תאריך שכבר חלף שייך לשנה הבאה. "11 לינואר"
     * שנאמר באוגוסט הוא ינואר הקרוב, לא זה שעבר.
     */
    if (explicit.year === undefined && wall.getTime() < base.getTime() - 86_400_000) {
      wall.setFullYear(year + 1);
    }
    evidenceParts.push(explicit.evidence);
  } else if (/מחרתיים/u.test(text)) {
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
