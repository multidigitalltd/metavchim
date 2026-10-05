/**
 * ‎**כרטיס שמצורף לשיחה עם המנטור** (docs/14 §7.7).
 *
 * ## ‏מה זה פותר
 *
 * ‏המנטור עובד במדדים, והמתווך עובד עם קונה מסוים ועם נכס מסוים.
 * ‏„איך אני משפר המרה” הוא דיון; „הקונה הזה ראה פעמיים ולא הציע”
 * ‏הוא מה שבאמת עומד על השולחן. עד כה הפער הזה נסגר פעם בשבוע
 * ‏בלבד, ומהצד של הקוד: `closestDeal` בוחר קונה אחד ומציג אותו.
 * ‏כאן המתווך הוא שבוחר.
 *
 * ## ‏הגבול, ולמה הוא נשמר גם כאן
 *
 * ‏כלל 6 בפרומפט אומר שאין למנטור גישה ללקוחות, לידים או נכסים
 * ‏ספציפיים, ושאלה כזו מופנית לסוכן האישי שמחזיק את ההרשאות.
 * ‎`closestDeal` הוא חריג מתועד לכלל הזה — ‏„הקונה הזה נבחר על ידי
 * ‏הקוד מהנתונים של המתווך עצמו… פרטים אחרים עליו אין לכם”.
 *
 * ‏הצירוף כאן נשען על אותו חריג בדיוק, ובאותו היקף:
 *
 * 1. ‎**רק כרטיס של המתווך עצמו.** השרת מסנן `owner_user_id`, כמו
 *    ‎`closestDeal` — לא „מה שמותר לי לראות” אלא „מה ששלי”. כרטיס
 *    ‏של עמית אינו „אסור”, הוא פשוט אינו נמצא.
 * 2. ‎**עובדות, לא זהות.** מה שנשלח הוא מצב הכרטיס: שלב, סיורים,
 *    ‏הצעות, כמה ימים בלי מגע. **לא** טלפון, לא דוא״ל, ולא בעל
 *    ‏הנכס — מי שמצורף הוא הקונה או הנכס, לא האנשים שמסביבם.
 * 3. ‎**השם כפי ש-`closestDeal` כבר שולח אותו**, ולא כלל צמצום
 *    ‏חדש. כלל שחל כאן ולא בשורה השבועית הוא חוסר עקביות ולא
 *    ‏הגנה — ובשני המקומות מדובר בכרטיס שהמתווך פותח ממילא.
 *
 * ‏הלוגיקה כאן טהורה: ה-API אוסף את העובדות, וכאן הן הופכות
 * ‏לשורות שהמודל קורא.
 */

import {
  hebrewCount,
  HEBREW_DAYS,
  HEBREW_OFFERS,
  HEBREW_VIEWINGS,
} from "./hebrew-count.js";

export const MENTOR_SUBJECT_KINDS = ["buyer", "property"] as const;
export type MentorSubjectKind = (typeof MENTOR_SUBJECT_KINDS)[number];

export function isMentorSubjectKind(value: unknown): value is MentorSubjectKind {
  return (
    typeof value === "string" &&
    (MENTOR_SUBJECT_KINDS as readonly string[]).includes(value)
  );
}

/** ‏קונה של המתווך — מה שצריך כדי לייעץ עליו, ולא יותר. */
export interface MentorBuyerSubject {
  kind: "buyer";
  id: string;
  /** ‏שם הקונה — של המתווך עצמו, בהרשאתו */
  name: string;
  /** ‏השלב שהמשרד נתן לו, או ריק */
  stage: string | null;
  /** very_hot | hot | interested | not_ripe */
  maturity: string;
  /** ‏סיורים שהתקיימו ב-30 הימים האחרונים */
  viewings: number;
  /** ‏הצעות שנשלחו ב-30 הימים האחרונים */
  offers: number;
  /** ‏מתוכן, כמה ענה עליהן „מעוניין” */
  interestedOffers: number;
  /** ‏ימים מאז המגע האחרון — `null` כשלא היה מגע מתועד */
  daysSinceTouch: number | null;
  /** ‏ימים מאז שהכרטיס נפתח */
  ageDays: number;
  /** ‏צעד הבא כבר קבוע (סיור, פגישה או משימה פתוחה) */
  hasNextStep: boolean;
}

/** ‏נכס של המשרד — מלאי, ולכן הכתובת עצמה אינה סוד. בעל הנכס כן. */
export interface MentorPropertySubject {
  kind: "property";
  id: string;
  /** „‏הרצל 12, תל אביב” — הנכס, לא מי שמחזיק בו */
  label: string;
  /** ‏מחיר מבוקש בשקלים, או `null` */
  price: number | null;
  rooms: number | null;
  /** ‏מ״ר */
  size: number | null;
  /**
   * ‏ימים מאז שנפתח הכרטיס. **לא „ימים בשוק”** — למסד אין מועד
   * ‏פרסום, ולקרוא לזה כך היה להצהיר על נתון שאין.
   */
  ageDays: number;
  /** ‏סיורים שהתקיימו ב-30 הימים האחרונים */
  viewings: number;
  /** ‏הצעות שנשלחו ב-30 הימים האחרונים */
  offers: number;
  /** ‏מתוכן, כמה ענו „מעוניין” */
  interestedOffers: number;
}

export type MentorSubject = MentorBuyerSubject | MentorPropertySubject;

/** ‏שורה קצרה לרשימה ולכותרת שבמסך — בלי הכללים שנוסעים למודל. */
export function mentorSubjectTitle(subject: MentorSubject): string {
  return subject.kind === "buyer" ? subject.name : subject.label;
}

/**
 * ‎**העובדות — בלי מסקנה.**
 *
 * ‏מה עוצר את העסקה הוא מה שהמנטור אמור לומר, ולכן אינו נכתב כאן.
 * ‏שורה שכבר פוסקת („הקונה מתקרר”) הייתה הופכת את המודל למי
 * ‏שמנסח מחדש מסקנה שהקוד הגיע אליה — וזה בדיוק ההפך מהתכלית.
 */
export function mentorSubjectFacts(subject: MentorSubject): string[] {
  const facts: string[] = [];
  if (subject.kind === "buyer") {
    if (subject.stage !== null && subject.stage !== "") {
      facts.push(`שלב: ${subject.stage}`);
    }
    facts.push(`בשלות: ${subject.maturity}`);
    facts.push(`בכרטיס ${hebrewCount(subject.ageDays, HEBREW_DAYS)}`);
    facts.push(
      subject.viewings === 0
        ? "בלי סיורים ב-30 הימים האחרונים"
        : `${hebrewCount(subject.viewings, HEBREW_VIEWINGS)} ב-30 הימים האחרונים`,
    );
    facts.push(
      subject.offers === 0
        ? "בלי הצעות ב-30 הימים האחרונים"
        : subject.interestedOffers === 0
          ? `${hebrewCount(subject.offers, HEBREW_OFFERS)} בלי „מעוניין”`
          : `${hebrewCount(subject.offers, HEBREW_OFFERS)}, מתוכן ${subject.interestedOffers} „מעוניין”`,
    );
    if (subject.daysSinceTouch !== null) {
      facts.push(
        subject.daysSinceTouch === 0
          ? "מגע אחרון היום"
          : `${hebrewCount(subject.daysSinceTouch, HEBREW_DAYS)} מאז המגע האחרון`,
      );
    }
    facts.push(subject.hasNextStep ? "צעד הבא כבר קבוע" : "בלי צעד הבא קבוע");
    return facts;
  }
  if (subject.price !== null) facts.push(`מחיר מבוקש: ${subject.price} ₪`);
  if (subject.rooms !== null) facts.push(`${subject.rooms} חדרים`);
  if (subject.size !== null) facts.push(`${subject.size} מ״ר`);
  facts.push(`בכרטיס ${hebrewCount(subject.ageDays, HEBREW_DAYS)}`);
  facts.push(
    subject.viewings === 0
      ? "בלי סיורים ב-30 הימים האחרונים"
      : `${hebrewCount(subject.viewings, HEBREW_VIEWINGS)} ב-30 הימים האחרונים`,
  );
  facts.push(
    subject.offers === 0
      ? "בלי הצעות ב-30 הימים האחרונים"
      : subject.interestedOffers === 0
        ? `${hebrewCount(subject.offers, HEBREW_OFFERS)} בלי „מעוניין”`
        : `${hebrewCount(subject.offers, HEBREW_OFFERS)}, מתוכן ${subject.interestedOffers} „מעוניין”`,
  );
  return facts;
}

/**
 * ‎**הבלוק שנוסע לפרומפט — עובדות ואז הגבול, תמיד יחד.**
 *
 * ‏משפט ההיתר אינו נספח: בלעדיו כלל 6 (אין גישה ללקוחות ספציפיים)
 * ‏סותר את מה שנשלח, והמודל מקבל שתי הוראות מנוגדות. ומשפט
 * ‏הסייג — „פרטים אחרים… אין לכם” — הוא מה שמונע מהמודל להמציא
 * ‏טלפון או כתובת כשיישאל, שהיא הדרך שבה מודל מדליף מה שלא קיבל.
 */
export function mentorSubjectLines(subject: MentorSubject): string[] {
  const facts = mentorSubjectFacts(subject).join("; ");
  if (subject.kind === "buyer") {
    return [
      `הכרטיס שצורף לשיחה — קונה בשם ${subject.name}: ${facts}.`,
      "הקונה הזה צורף על ידי המתווך מהכרטיסים שלו עצמו, ולכן, בניגוד לכלל 6, מותר לדבר עליו בשמו: מה לשאול אותו ומה הצעד הבא. פרטים אחרים עליו — טלפון, דוא״ל, כתובת — אין לכם, ואין להמציא אותם.",
    ];
  }
  return [
    `הנכס שצורף לשיחה — ${subject.label}: ${facts}.`,
    "הנכס הזה צורף על ידי המתווך מהמלאי של המשרד, ולכן, בניגוד לכלל 6, מותר לדבר עליו: איך לקדם אותו ומה לבדוק. פרטי בעל הנכס אינם כאן, ואין להמציא אותם.",
  ];
}
