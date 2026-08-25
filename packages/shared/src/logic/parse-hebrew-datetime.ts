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
 * יחידת זמן יחסית — **שתי צורות, ולא אחת.**
 *
 * ‎`solo` היא הצורה שעומדת לבדה ונושאת כמות מוגדרת: „שעה” היא אחת,
 * „שעתיים” הן שתיים. ‎`counted` היא הצורה שבאה **אחרי** כמות.
 *
 * ההפרדה אינה קוסמטית. טבלה אחת שכללה גם את הרבים אמרה ש„תזכיר לי
 * עוד **שעות**” הוא שעה אחת בדיוק — כלומר המציאה מועד מדויק ממשפט
 * מעורפל, וזה גרוע משדה ריק (ביקורת Codex). רבים בלי מספר אינו
 * זמן, והוא נדחה.
 */
interface RelativeUnit {
  /** עומדת לבדה — יחיד וזוגי בלבד */
  solo?: RegExp;
  /**
   * כמה יחידות שוות הצורה שעומדת לבדה. „שעה” אחת, „שעתיים” שתיים.
   *
   * ‎`ms` הוא **תמיד יחידה אחת**, גם בזוגי. זה מה שמאפשר לחשב „שעה
   * וחצי” ו„שעתיים וחצי” באותה נוסחה: החצי הוא חצי יחידה, לא חצי
   * מהצורה שנאמרה.
   */
  soloCount?: number;
  /** באה אחרי כמות — יחיד ורבים */
  counted?: RegExp;
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
  /**
   * היחידה המשתמעת ממספר עירום — „בעוד 2” הן שעתיים.
   *
   * הצורה הישנה הייתה ‎`בעוד\s+(שעה|שעתיים|\d+)`‎, כלומר ספרה אחרי
   * „בעוד” הובנה כשעות בלי לומר „שעות”. השכתוב דרש יחידה מפורשת
   * אחרי כמות והפיל אותה בשקט (ביקורת Codex). זו נסיגה בצורה
   * שאנשים באמת כותבים, ולכן היא נשמרת במפורש.
   */
  bare?: true;
}

const RELATIVE_UNITS: RelativeUnit[] = [
  // הזוגי בעברית הוא מילה ולא מספר — ולכן הוא עומד לבדו בלבד
  { solo: /^שעתיים$/u, soloCount: 2, ms: HOUR_MS, max: 1 },
  { solo: /^יומיים$/u, soloCount: 2, ms: DAY_MS, max: 1 },
  { solo: /^שבועיים$/u, soloCount: 2, ms: 7 * DAY_MS, max: 1 },
  /*
   * הרבים בעברית אינו סיומת שאפשר לסמן ב-`?`: „שעות” אינו „שעה”
   * ועוד אות. כל צורה נכתבת במלואה — קיצור כאן היה מזהה את הרבים
   * ומפספס בדיוק את היחיד, שהוא הצורה השכיחה בשיחה.
   */
  { solo: /^דקה$/u, counted: /^דקה$|^דקות$/u, ms: MINUTE_MS, max: 180 },
  { solo: /^שעה$/u, counted: /^שעה$|^שעות$/u, ms: HOUR_MS, max: 48, bare: true },
  { solo: /^יום$/u, counted: /^יום$|^ימים$/u, ms: DAY_MS, max: 60 },
  { solo: /^שבוע$/u, counted: /^שבוע$|^שבועות$/u, ms: 7 * DAY_MS, max: 8 },
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

/** „עוד שעה” — יחידה שעומדת לבדה. רבים בלי מספר אינו נכנס לכאן. */
function soloUnit(word: string): RelativeUnit | undefined {
  return RELATIVE_UNITS.find((unit) => unit.solo?.test(word) === true);
}

/** „עוד שלוש שעות” — היחידה שאחרי הכמות. */
function countedUnit(word: string): RelativeUnit | undefined {
  return RELATIVE_UNITS.find((unit) => unit.counted?.test(word) === true);
}

/** „בעוד 2” — היחידה שמספר עירום מתכוון אליה. */
const BARE_UNIT = RELATIVE_UNITS.find((unit) => unit.bare === true)!;

/**
 * „שעה **וחצי**” — השבר שנגרר אחרי יחידה שעומדת לבדה.
 *
 * בלעדיו הענף קיבל „שעה” והתעלם מ„וחצי” — תזכורת אחרי שעה במקום
 * אחרי שעה וחצי (ביקורת Codex). זה גרוע במיוחד כאן: לפני התמיכה
 * בצורה בלי בי"ת המשפט לא ייצר תאריך כלל, כלומר שדה ריק וגלוי.
 * עכשיו הוא היה מייצר מועד סביר-למראה ומוקדם מדי, וזה כשל שאיש
 * אינו מבחין בו עד שהשיחה מתרחשת בזמן הלא נכון.
 */
const FRACTION_SUFFIX: Record<string, number | undefined> = {
  וחצי: 0.5,
  ורבע: 0.25,
};

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
/**
 * מילה אחת, בלי הפיסוק שנדבק אליה.
 *
 * ‎`\S+` בולע נקודה או פסיק — „עוד שעה**.**” נותן `שעה.`, והתבניות
 * העוגנות דוחות אותו. תמלול ותשובה בוואטסאפ מסתיימים בפיסוק כדבר
 * שבשגרה, וזו הייתה אפילו **נסיגה** מהצורה הקודמת: הביטוי הישן
 * התאים לתחילית, והמשך המילה לא עניין אותו (ביקורת Codex).
 *
 * **סימן מינוס אינו פיסוק.** „בעוד ‎-2‎ שעות” הפך ל„2” אחרי הניקוי,
 * עבר את בדיקת הגבול התחתון שנועדה לפסול אותו, ונקבעה תזכורת
 * שעתיים קדימה ממשפט שאומר את ההפך (ביקורת Codex). הסימן נשמר,
 * ולכן הכמות אינה נקראת כלל והביטוי נדחה.
 */
function bareWord(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (cleaned === "") return undefined;
  /*
   * הסימן נבדק **צמוד לספרה הראשונה** ולא בתחילת האסימון, ובכל
   * צורותיו. „‎(-2)‎” עטוף בסוגריים ו„‎−2‎” משתמש בסימן המינוס
   * הטיפוגרפי — שניהם נוקו לכדי „2” חיובי (ביקורת Codex).
   */
  const first = raw.search(/[\p{L}\p{N}]/u);
  const negative =
    first > 0 && /[-−–—‒]/u.test(raw[first - 1] ?? "") && /^\d/u.test(cleaned);
  return negative ? `-${cleaned}` : cleaned;
}

/**
 * מילת הפתיחה בלבד — **בגבול מילה, וכל המופעים.**
 *
 * המבט לאחור דוחה **אות או ספרה** בלבד, ולכן „מעודכן” ו„עודף” אינם
 * נקראים כ„עוד” — אבל פיסוק שלפני כן כן עובר. ‎`(?:^|\s)` דרש רווח
 * ממש, ולכן „תזכיר לי,עוד שעה” ו„עוד שעה” במרכאות לא נתפסו כלל
 * (ביקורת Codex). הדגל הגלובלי הוא מה שמאפשר לעבור על כל המופעים.
 *
 * ## וי"ו החיבור
 *
 * „ובעוד שעה תתקשר אליו” — הווי"ו היא אות, ולכן המבט לאחור פסל את
 * הביטוי כולו (ביקורת Codex). היא נבלעת בתבנית ואינה משנה את
 * משמעות הביטוי: „ובעוד שעה” הוא „בעוד שעה” עם חיבור למשפט הקודם.
 *
 * שאר התחיליות **אינן** כאן בכוונה. „ש” משעבדת את הפסוקית ומשנה
 * את מה שנאמר — „תזכיר לי שבעוד שבוע מסתיימת הבלעדיות” אומר מתי
 * הבלעדיות נגמרת, לא מתי להזכיר. וי"ו היא היחידה שאפשר להסיר בלי
 * לשנות דבר, ולכן היא היחידה שנבלעת.
 */
const RELATIVE_TRIGGER = /(?<![\p{L}\p{N}])ו?(ב?עוד|תוך)\s+/gu;

/**
 * מועמד אחד: מילת פתיחה, ומה שבא אחריה.
 *
 * ‎`consumed` הוא מספר התווים של `rest` שהביטוי בלע. הוא נדרש כדי
 * להסתיר את הביטוי מפענוח השעון — ראו `parseHebrewDateTime`.
 *
 * ‎`ms: null` הוא **לא** „זה אינו ביטוי זמן”. הוא „זה ביטוי זמן
 * שזוהה, ומשכו אינו סביר”. ההבחנה חשובה: „מחר בעוד תשע שבועות”
 * נדחה בגלל התקרה, ובלי לדעת את גבולותיו „תשע” נשארה בטקסט
 * ו‎`parseTime`‎ קראה אותה כ-09:00 (ביקורת Codex). ביטוי שאינו זמן
 * כלל מוחזר כ-`null`, ואותו אין מה להסתיר.
 */
function offsetAt(
  lead: string,
  rest: string,
): { ms: number | null; evidence: string; consumed: number } | null {
  /*
   * שלוש מילים ולא שתיים — „שלוש שעות **וחצי**” צריכה את השלישית.
   * התיקון הקודם כיסה רק את היחידה שעומדת לבדה („שעה וחצי”), והשבר
   * אחרי כמות נשאר נבלע (ביקורת Codex).
   */
  const words = [...rest.matchAll(/\S+/gu)].slice(0, 3);
  const firstWord = words[0];
  if (firstWord?.index === undefined) return null;
  const endOf = (word: RegExpExecArray | RegExpMatchArray): number =>
    (word.index ?? 0) + word[0].length;
  const first = bareWord(firstWord[0]);
  if (first === undefined) return null;

  /** השבר שנגרר אחרי היחידה, אם יש. אותו טיפול בכל הענפים. */
  const fractionAt = (
    word: RegExpMatchArray | undefined,
  ): { value: number; text: string; word: RegExpMatchArray } | undefined => {
    if (word === undefined) return undefined;
    const text = bareWord(word[0]);
    if (text === undefined) return undefined;
    const value = FRACTION_SUFFIX[text];
    return value === undefined ? undefined : { value, text, word };
  };

  /**
   * גבול תחתון וגבול עליון יחד — שניהם דוחים אל אותה תשובה.
   *
   * ‎`max` נשלח במפורש ואינו נלקח מהיחידה, כי הוא שומר על **כמות
   * שהדובר אמר** („עוד 900 שעות” הוא תמלול שגוי). צורה שעומדת לבדה
   * אינה אומרת כמות — „שעתיים” הן שתיים מעצם המילה — ולכן התקרה
   * שלה אינה חלה, והיחידות הזוגיות אף מצהירות `max: 1` שהיה פוסל
   * אותן על עצמן.
   */
  const bounded = (
    units: number,
    unit: RelativeUnit,
    max: number,
    evidence: string,
    consumed: number,
  ): { ms: number | null; evidence: string; consumed: number } => {
    const ms = Math.round(units * unit.ms);
    if (units > max || !Number.isFinite(ms) || ms <= 0) {
      return { ms: null, evidence, consumed };
    }
    return { ms, evidence, consumed };
  };

  // „שעתיים”, „שעה” — היחידה עומדת לבדה ונושאת את הכמות שלה
  const alone = soloUnit(first);
  if (alone !== undefined) {
    const whole = alone.soloCount ?? 1;
    const fraction = fractionAt(words[1]);
    if (fraction !== undefined) {
      return bounded(
        whole + fraction.value,
        alone,
        Number.POSITIVE_INFINITY,
        `${lead} ${first} ${fraction.text}`,
        endOf(fraction.word),
      );
    }
    return bounded(whole, alone, Number.POSITIVE_INFINITY, `${lead} ${first}`, endOf(firstWord));
  }

  const quantity = quantityOf(first);
  if (quantity === undefined) return null;

  const secondWord = words[1];
  const second = secondWord === undefined ? undefined : bareWord(secondWord[0]);
  const unit = second === undefined ? undefined : countedUnit(second);

  /*
   * „בעוד 2” — מספר עירום בלי יחידה, שעות. רק ספרות: „בעוד שלוש”
   * במילה מתחלף בשעון („בשלוש”) ואי אפשר להכריע בינו לבין היסט,
   * ולכן הוא נשאר מחוץ לתחום.
   */
  if (unit === undefined) {
    /*
     * **ורק אחרי „בעוד”.** „תזכיר לי לקנות עוד 2 תפוחים” אינו מועד,
     * והצורה הזו החזירה עליו שעתיים — תאריך יעד שאיש לא ביקש
     * (ביקורת Codex). התאימות נועדה ל„בעוד 2” בלבד, שהוא מה שהביטוי
     * הישן תמך בו; „עוד” סתם הוא ספירה של דברים לפחות באותה מידה
     * שהוא זמן.
     */
    if (lead !== "בעוד") return null;
    if (!/^\d+$/u.test(first)) return null;
    const fraction = fractionAt(secondWord);
    if (fraction !== undefined) {
      return bounded(
        quantity + fraction.value,
        BARE_UNIT,
        BARE_UNIT.max,
        `${lead} ${first} ${fraction.text}`,
        endOf(fraction.word),
      );
    }
    return bounded(quantity, BARE_UNIT, BARE_UNIT.max, `${lead} ${first}`, endOf(firstWord));
  }

  // „עשרים דקות”, „רבע שעה”, „3 ימים”, „שלוש שעות וחצי”
  const fraction = fractionAt(words[2]);
  if (fraction !== undefined) {
    return bounded(
      quantity + fraction.value,
      unit,
      unit.max,
      `${lead} ${first} ${second} ${fraction.text}`,
      endOf(fraction.word),
    );
  }
  return bounded(quantity, unit, unit.max, `${lead} ${first} ${second}`, endOf(secondWord!));
}

/**
 * ‎`start`/`end` הם גבולות הביטוי בטקסט המקורי — לא שחזור מהראיה.
 * „בעוד שלוש, שעות” מייצר ראיה מנוקה שאינה מחרוזת-משנה של המקור,
 * ומחיקה לפי טקסט הייתה נכשלת בשקט דווקא בקלט שבור.
 *
 * ‎`ms: null` = ביטוי זמן שזוהה ומשכו נדחה. אין ממנו תאריך, אבל יש
 * לו גבולות — והם מה שמונע מ„תשע” שב„בעוד תשע שבועות” להיקרא
 * כשעה על השעון.
 */
export interface RelativeOffset {
  ms: number | null;
  evidence: string;
  start: number;
  end: number;
  /**
   * גבולותיהם של **כל** ביטויי הזמן שזוהו במשפט, לא רק הנבחר.
   *
   * „מחר עוד שלוש שעות, לא, בעוד ארבע שעות”: מילת היום גוברת על
   * שניהם, ואם מסתירים רק את הנבחר — „שלוש” נשארת ונקראת כ-15:00.
   * מספר ששייך לביטוי זמן אינו שעון, גם כשהביטוי שלו לא נבחר.
   */
  masks: readonly { start: number; end: number }[];
}

/**
 * „לא”, „סליחה”, „בעצם” — סימני **תיקון עצמי.**
 *
 * „עוד שעה, לא, בעוד שעתיים” הוא דיבור רגיל לגמרי, והמועד הנכון בו
 * הוא האחרון. בלי הסימן הכלל ההפוך נכון: „תזכיר לי בעוד שעה לשלוח
 * את המסמך שצריך להגיע בעוד יומיים” — שם הראשון הוא מועד הפעולה
 * והשני שייך למשפט אחר לגמרי.
 *
 * לכן לא „הראשון תמיד” ולא „האחרון תמיד”, אלא: הראשון, אלא אם
 * הדובר אמר במפורש שהוא מתקן.
 *
 * ## תיקון אינו שלילה, ואינו תוכן המשפט
 *
 * הסימן חייב **לעמוד בפני עצמו**: בפתח הטקסט שאחרי הביטוי הראשון,
 * או אחרי פיסוק. „המסמך **לא צריך** להגיע בעוד יומיים” ממשיך
 * לפועל, ו„תזכיר לי בעוד שעה **לבקש סליחה** בעוד יומיים” הוא
 * מושא של „לבקש” — בשני המקרים הקריאה כתיקון העבירה את התזכורת
 * למועד שאינו מועד הפעולה (שתי ביקורות Codex).
 *
 * „אחרי פיסוק” ולא „בפתח בלבד”, כי התיקון בא גם אחרי פסוקית שלמה:
 * „בעוד שעה לשלוח את המסמך**, בעצם** בעוד שעתיים”. מה שמבדיל אינו
 * המרחק מהביטוי אלא הניתוק התחבירי, והפיסוק הוא העדות לו.
 *
 * ## ולמה „לא” נבדק אחרת מכולן
 *
 * „בעצם” ו„סליחה” הן תיקון מעצם עצמן. „לא” אינה: היא גם שוללת את
 * מה שבא **אחריה**. „תזכיר לי בעוד שעה, **לא בעוד שעתיים**” דוחה
 * את השעתיים במפורש — וקריאתה כתיקון קבעה את התזכורת בדיוק למה
 * שנדחה (ביקורת Codex). מה שמבדיל הוא הפיסוק: „לא**,** בעוד
 * שעתיים” הוא תיקון; „לא בעוד שעתיים” הוא שלילה.
 *
 * הכישלון הבטוח הוא להשאיר את הראשון. המסוכן הוא לבחור דווקא את מה
 * שהדובר פסל.
 */
const CORRECTION_MARKER = /(?:^|[^\s\p{L}\p{N}])\s*(לא|סליחה|בעצם|טעות|תיקון)(?![\p{L}\p{N}])/gu;

/**
 * הסימן הראשון שעומד בפני עצמו, ומה שנאמר אחריו.
 *
 * הלולאה אינה קישוט: „לא” שנפסלה כשלילה אינה אמורה להסתיר „בעצם”
 * שבא אחריה. `null` = אין תיקון, כלומר הביטוי הראשון עומד בעינו —
 * וזהו הכישלון הבטוח מבין השניים.
 */
function correctionAt(after: string): { rest: string } | null {
  for (const match of after.matchAll(CORRECTION_MARKER)) {
    const rest = after.slice(match.index + match[0].length);
    // „לא” שוללת את מה שאחריה; רק פיסוק מפריד הופך אותה לתיקון
    if (match[1] === "לא" && !/^\s*[^\s\p{L}\p{N}]/u.test(rest)) continue;
    return { rest };
  }
  return null;
}

/** האם הדובר תיקן את עצמו בין שני הביטויים. */
function isCorrection(between: string): boolean {
  return correctionAt(between) !== null;
}

export function parseRelativeOffset(text: string): RelativeOffset | null {
  /*
   * **כל המופעים, לא הראשון.**
   *
   * „תתקשר **עוד פעם** בעוד שעה” — המופע הראשון אינו זמן, וחיפוש
   * יחיד נעצר עליו ומחזיר `null`, בזמן ש„בעוד שעה” יושב מיד אחריו.
   * חזרה ותיקון עצמי הם דיבור רגיל לגמרי, והצורה הקודמת דווקא
   * שרדה אותם — היא חיפשה יחידה ולא מילה כלשהי (ביקורת Codex).
   */
  /*
   * ביטוי שנדחה בגלל משכו אינו עוצר את הסריקה: „עוד 900 שעות, לא,
   * בעוד שעה” עדיין אמור להגיע לשעה. הוא נזכר בצד, ומוחזר רק אם לא
   * נמצא אחריו ביטוי תקין — כי גם הוא צריך להיות מוסתר מהשעון.
   */
  const masks: { start: number; end: number }[] = [];
  let chosen: RelativeOffset | null = null;
  let rejected: RelativeOffset | null = null;
  /** סוף הביטוי הקודם — מילת התיקון חייבת לשבת בינו לבין הנוכחי. */
  let previousEnd: number | null = null;
  /**
   * האם בחירה קודמת בוטלה בתיקון.
   *
   * „אין בחירה עדיין” ו„הבחירה בוטלה” הם שני מצבים שונים, ו-`null`
   * לבדו אינו מבחין ביניהם: אחרי הביטול, ביטוי תקין **שאינו תיקון**
   * נבלע כאילו היה הראשון. „עוד שעה, לא, בעוד 900 שעות, והמסמך
   * צריך להגיע בעוד יומיים” היה קובע את התזכורת למועד המסמך
   * (ביקורת Codex) — משפט אחר לגמרי, שנבחר רק מפני שהמקום התפנה.
   */
  let invalidated = false;
  for (const match of text.matchAll(RELATIVE_TRIGGER)) {
    const lead = match[1];
    if (lead === undefined || match.index === undefined) continue;
    const restStart = match.index + match[0].length;
    const resolved = offsetAt(lead, text.slice(restStart));
    if (resolved === null) continue;
    const found: RelativeOffset = {
      ms: resolved.ms,
      evidence: resolved.evidence,
      start: match.index,
      end: restStart + resolved.consumed,
      masks,
    };
    masks.push({ start: found.start, end: found.end });
    const corrects = previousEnd !== null && isCorrection(text.slice(previousEnd, found.start));
    previousEnd = found.end;

    if (found.ms === null) {
      rejected ??= found;
      /*
       * **תיקון אל ביטוי פסול מבטל את מה שתוקן.**
       *
       * „עוד שעה, לא, בעוד 900 שעות” — הדובר חזר בו מהשעה. ענף
       * הדחייה יצא מהלולאה לפני בדיקת התיקון, ולכן השעה שנזנחה
       * נשארה ונקבעה תזכורת למה שבוטל במפורש (ביקורת Codex).
       * שדה ריק הוא התשובה הנכונה כאן: המתווך אמר משהו שאי אפשר
       * לחשב, ועדיף שיראה זאת מאשר שיקבל את מה שביטל.
       */
      if (corrects) {
        chosen = null;
        invalidated = true;
      } else if (chosen === null) {
        /*
         * **גם ביטוי פסול תופס את הבחירה.** „בעוד 900 שעות, והמסמך
         * צריך להגיע בעוד יומיים” — בלי זה המקום נשאר פנוי, והיסט
         * של משפט אחר נכנס אליו בלי שום תיקון (ביקורת Codex). מכאן
         * והלאה רק תיקון מפורש בוחר, בדיוק כמו אחרי ביטול.
         */
        invalidated = true;
      }
      continue;
    }
    /*
     * **הראשון, אלא אם הדובר תיקן את עצמו.**
     *
     * חיפוש שנעצר על הראשון הפך „עוד שעה, לא, בעוד שעתיים” לשעה
     * אחת — נסיגה, כי הביטוי הישן דרש `בעוד` ולכן דילג על הצורה
     * בלי בי"ת והגיע דווקא לתיקון (ביקורת Codex). „האחרון תמיד”
     * אינו התשובה: הוא היה שובר משפט שבו לביטוי השני יש נושא
     * משלו. מה שמכריע הוא מילת התיקון שביניהם.
     *
     * ואחרי ביטול — **רק תיקון מפורש מחייה את הבחירה.** מקום פנוי
     * אינו הזמנה לביטוי הבא שבמשפט.
     */
    if (corrects) {
      chosen = found;
      invalidated = false;
    } else if (chosen === null && !invalidated) {
      chosen = found;
    }
  }
  return chosen ?? rejected;
}

/** הסתרת ביטויי הזמן מהטקסט שממנו נקרא השעון — מהסוף להתחלה. */
function maskSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  return [...spans]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, span) => `${acc.slice(0, span.start)} ${acc.slice(span.end)}`, text);
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

/**
 * האם אחרי ההיסט בא תיקון אל **לוח השנה** — „עוד שעה, בעצם ביום
 * שלישי”.
 *
 * מילות היום (מחר/היום) גוברות על היסט מעצם נוכחותן, אבל יום בשבוע
 * או תאריך מפורש אינם יכולים לקבל אותו מעמד: „תזכיר לי בעוד שעה
 * לקבוע פגישה ליום שלישי” — שם ההיסט הוא מועד התזכורת ויום שלישי
 * שייך לפגישה. מה שמכריע הוא **מילת תיקון שצמוד אחריה לוח שנה**:
 * הדובר החליף את ההיסט ביום. בלעדיה ההיסט של המנוע הישן דווקא לא
 * נתפס כאן („עוד שעה” בלי בי"ת), ויום שלישי המתוקן כן — כלומר
 * ההרחבה של הצורה בלי בי"ת הייתה הופכת תיקון שעבד לתיקון שנבלע
 * (ביקורת Codex).
 */
function correctedToCalendar(text: string, offsetEnd: number): boolean {
  /*
   * **אותו כלל תיקון של הבחירה בין שני היסטים, ולא ניסוח שני.**
   *
   * גם כאן הסימן חייב לעמוד בפני עצמו: „תזכיר לי בעוד שעה לבקש
   * סליחה מחר בבוקר” אמר „סליחה” כמושא של „לבקש”, וחיפוש הסימן
   * בכל מה שאחרי ההיסט מצא אותו וביטל את השעה. זו בדיוק התקלה
   * ש-Codex מצא במסלול המקביל — היא הייתה חיה בשני המסלולים,
   * ולכן הכלל יושב עכשיו במקום אחד. „לא” והדרישה לפיסוק אחריה
   * נכללות בו.
   */
  const correction = correctionAt(text.slice(offsetEnd));
  if (correction === null) return false;
  // הלוח חייב להיות צמוד לסימן — אחרת יום שמופיע במקרה בהמשך המשפט
  // היה מוחק את ההיסט
  const tail = correction.rest.replace(/^[^\p{L}\p{N}]+/u, "");
  const calendarStart =
    /^(מחר|מחרתיים|היום|ב?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי)|ב?שבת|ב?מוצ["״]ש)/u;
  return calendarStart.test(tail) || parseExplicitDate(tail.slice(0, 30)) !== undefined;
}

/**
 * „לא מחר” — **יום שנשלל אינו יום.**
 *
 * מילות היום גוברות על היסט מעצם נוכחותן, וזה נכון כשהן נאמרו.
 * „תזכיר לי בעוד שעה, לא מחר” אומר את ההפך: הדובר פסל את מחר, וה
 * שלילה הזאת קבעה את התזכורת בדיוק ליום שנדחה (ביקורת Codex).
 *
 * ההסתרה היא ברווחים ולא במחיקה, כדי שהאינדקסים יישארו תקפים —
 * גבולות הביטויים היחסיים נמדדים על אותו טקסט.
 *
 * ‎`לא` בלי פיסוק בלבד: „לא**,** מחר” הוא תיקון **אל** מחר, והוא
 * נשאר.
 */
const NEGATED_CALENDAR =
  /(?<![\p{L}\p{N}])לא\s+(מחר|מחרתיים|היום|ב?יום\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|ב?שבת)(?![\p{L}\p{N}])/gu;

export function parseHebrewDateTime(transcript: string, now: Date): ParsedDateTime {
  const text = transcript
    .replace(/\s+/gu, " ")
    .trim()
    .replace(NEGATED_CALENDAR, (match) => " ".repeat(match.length));
  const relative = parseRelativeOffset(text);

  /*
   * "בעוד שעתיים" הוא אריתמטיקה על **הרגע** ולא על שעון הקיר, ולכן
   * הוא מחושב לפני המעבר לשעון ירושלמי: ביום מעבר שעון "בעוד שעתיים"
   * הוא בדיוק שעתיים, גם אם שעון הקיר קפץ.
   */
  if (
    relative !== null &&
    relative.ms !== null &&
    !/מחר|מחרתיים|היום/u.test(text) &&
    !correctedToCalendar(text, relative.end)
  ) {
    const at = new Date(now.getTime() + relative.ms);
    /*
     * עיגול **כלפי מעלה** לדקה השלמה.
     *
     * ‎`setSeconds(0, 0)` מקצץ, ולכן ב-10:00:59 „עוד דקה” היה הופך
     * ל-10:01:00 — שנייה אחת, לא דקה (ביקורת Codex). תזכורת שמגיעה
     * מוקדם מהמבוקש נראית כתקלה; מאוחר בשניות ספורות איש אינו מרגיש.
     */
    if (at.getSeconds() !== 0 || at.getMilliseconds() !== 0) at.setSeconds(60, 0);
    return { date: at, timeExplicit: true, evidence: relative.evidence };
  }

  /*
   * "מחר בעוד שלוש שעות" — היום המפורש גובר, אבל המספר שבביטוי
   * היחסי אינו שעה על השעון. בלי הסתרתו `parseTime` קרא „שלוש”
   * כ-15:00 והחזיר מחר ב-15:00 עם ראיה „מחר שלוש” — שעה שאיש לא
   * אמר, שנראית על המסך כהחלטה (ביקורת Codex). הביטוי יורד, ונשארת
   * ברירת המחדל המוצהרת.
   *
   * ההסתרה חלה גם על ביטוי שנדחה בגלל משכו: „מחר בעוד תשע שבועות”
   * אינו מייצר תאריך, אבל „תשע” שבו אינה 09:00 (ביקורת Codex).
   * מספר ששייך לביטוי זמן אינו הופך לשעון רק משום שהביטוי נפסל.
   */
  const clockText = relative === null ? text : maskSpans(text, relative.masks);
  const time = parseTime(clockText);
  const evidenceParts: string[] = [];

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
