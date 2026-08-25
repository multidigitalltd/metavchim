/**
 * בלעדיות — **תקופה שהחוק מגביל, ושהמערכת עד היום שכחה.**
 *
 * `properties.exclusive_until` קיים בסכמה מהיום הראשון, נכתב, נקרא
 * למיפוי — ומעולם לא הוצג ולא נבדק. הסכם הבלעדיות אמנם נחתם דרך
 * המערכת, אבל התקופה עצמה נשמרה כטקסט חופשי בתוך גוף המסמך
 * (`תקופת_בלעדיות`). כלומר: המשרד חתם על בלעדיות, והמערכת לא ידעה
 * מתי היא נגמרת.
 *
 * זו לא החמצה של נוחות. בלעדיות שפגה בלי שאיש שם לב היא נכס שעובר
 * למתחרה, ובלעדיות שנוסחה מעבר לתקרה החוקית אינה ניתנת לאכיפה.
 *
 * ## מה החוק אומר
 *
 * חוק המתווכים במקרקעין, תשנ"ו-1996, סעיף 9:
 *
 * | כלל | מקור |
 * |---|---|
 * | תקופת בלעדיות בדירה — עד 6 חודשים מיום ההזמנה | 9(ב)(2) |
 * | תקופת בלעדיות במקרקעין שאינם דירה — עד שנה | 9(ב)(1) |
 * | בלעדיות בדירה בלי תקופה נקובה — 30 יום | 9(ג) |
 * | לא בוצעו פעולות השיווק עד תום **שליש** מהתקופה — הבלעדיות מסתיימת שם | 9(ב2) |
 *
 * ותקנות המתווכים במקרקעין (פעולות שיווק), תשס"ה-2004: על המתווך
 * לבצע **שתי פעולות שיווק לפחות** מתוך רשימה סגורה של שש, או פעולה
 * מוסכמת אחרת (הפריט השביעי) לפי מה שסוכם עם הלקוח.
 *
 * ## למה כלל השליש הוא הלב של הקובץ הזה
 *
 * שאר הכללים הם תאריך יעד, וסוכן יכול לזכור תאריך. כלל השליש הוא
 * **תנאי מתלה שקוף**: הבלעדיות פוקעת בשקט, בלי הודעה ובלי אירוע,
 * חודשיים לפני מה שכתוב בהסכם — ורק מפני שאיש לא תיעד שתי פעולות.
 * המשרד מגלה את זה כשהמוכר מוכר לבד, ואז מאוחר.
 *
 * לכן החישוב כאן אינו מציג "תוקף עד", אלא **`effectiveEndsAt`** —
 * המועד שבו הבלעדיות באמת נגמרת בהינתן מה שתועד עד עכשיו.
 *
 * ## מה הקובץ הזה אינו
 *
 * הוא אינו ייעוץ משפטי ואינו מכריע במחלוקת. הוא מחשב מועדים וסופר
 * פעולות מתועדות, כדי שהמשרד יראה את מה שהוא ממילא אחראי לו.
 * הכרעה על תוקף בלעדיות שנויה במחלוקת נעשית מחוץ למערכת.
 */

import { addMonths } from "./credit-expiry.js";
import { formatJerusalemDate } from "./israel-time.js";

/**
 * סוג הנכס לעניין סעיף 9 — **ולא סוג הנכס במערכת.**
 *
 * לחוק יש שתי מדרגות בלבד: דירה וכל היתר. `property.type` שלנו
 * מפורט יותר (דירה, פנטהאוז, מגרש, חנות), ומיפוי אוטומטי ממנו היה
 * מכריע שאלה משפטית בלי שאיש שאל. הבחירה נשארת אצל הסוכן, עם
 * ברירת מחדל שנגזרת מסוג הנכס.
 */
export type ExclusivitySubject = "apartment" | "other";

/** התקרה החוקית לתקופה, בחודשים. סעיף 9(ב). */
export const MAX_EXCLUSIVITY_MONTHS: Record<ExclusivitySubject, number> = {
  apartment: 6,
  other: 12,
};

/**
 * בלעדיות בדירה שלא נקבעה בה תקופה — 30 יום. סעיף 9(ג).
 *
 * למקרקעין שאינם דירה אין כאן מקבילה **בכוונה**: לא אימתנו נוסח
 * מפורש לברירת מחדל כזו, ומספר שנכתב בניחוש בקוד שמחשב מועד משפטי
 * גרוע מהיעדרו. לכן שם התקופה היא שדה חובה.
 */
export const DEFAULT_APARTMENT_EXCLUSIVITY_DAYS = 30;

/** שתי פעולות שיווק לפחות — תקנות פעולות שיווק. */
export const MIN_MARKETING_ACTIONS = 2;

/** גיוס מתווכים אחרים נחשב פעולה מחמישה ומעלה — פריט (6) בתקנות. */
export const MIN_BROKERS_FOR_NETWORK_ACTION = 5;

/**
 * שבע פעולות השיווק, בסדר שבו הן מופיעות בתקנות.
 *
 * הסדר אינו קוסמטי: פריטים (1)–(6) הם הרשימה הסגורה שממנה נדרשות
 * שתיים, ופריט (7) הוא "פעולה אחרת שהוסכמה" — שנספר רק כשהוסכם
 * עליו במפורש. ראו `qualifyingActions`.
 */
export const MARKETING_ACTION_KINDS = [
  "signage",
  "client_database",
  "daily_newspaper",
  "local_newspaper",
  "viewing_invitation",
  "broker_network",
  "agreed_other",
] as const;

export type MarketingActionKind = (typeof MARKETING_ACTION_KINDS)[number];

export const MARKETING_ACTION_LABEL: Record<MarketingActionKind, string> = {
  signage: "שילוט על הנכס או בקרבתו",
  client_database: "פרסום בקרב מאגר הלקוחות — דיוור, מסרון או אתר",
  daily_newspaper: "פרסום בעיתון יומי נפוץ",
  local_newspaper: "פרסום במקומון או בעיתון לקהל יעד",
  viewing_invitation: "הזמנת רוכשים או מתווכים לביקור בנכס",
  broker_network: `שיתוף ${MIN_BROKERS_FOR_NETWORK_ACTION} מתווכים אחרים לפחות`,
  agreed_other: "פעולה אחרת שהוסכמה עם הלקוח",
};

/** פריט (7) עומד בפני עצמו רק בהסכמה — ולכן הוא מסומן בנפרד. */
export const LISTED_MARKETING_ACTIONS: readonly MarketingActionKind[] =
  MARKETING_ACTION_KINDS.filter((kind) => kind !== "agreed_other");

/**
 * מה שהמערכת יודעת לתעד בעצמה — ולמה זה חשוב.
 *
 * פעולת שיווק שדורשת מהסוכן לזכור לתעד אותה, לא תתועד. שלוש
 * מהפעולות כבר קורות בתוך המערכת ומשאירות עקבות: הצעה שנשלחה
 * לקונים מהמאגר, סיור שנקבע ביומן, ונכס שהוצע למשרדים אחרים ברשת.
 * את השאר (שילוט, עיתון) המערכת אינה יכולה לדעת, והן נרשמות ידנית
 * עם אסמכתה.
 */
export const AUTO_MARKETING_SOURCES = {
  offer_sent: "client_database",
  viewing_scheduled: "viewing_invitation",
  network_offer: "broker_network",
} as const satisfies Record<string, MarketingActionKind>;

export type AutoMarketingSource = keyof typeof AUTO_MARKETING_SOURCES;

/** תקופת בלעדיות אחת, כפי שהיא נשמרת. */
export interface ExclusivityPeriod {
  subject: ExclusivitySubject;
  startsAt: Date;
  endsAt: Date;
  /**
   * האם סוכם על פעולת שיווק מותאמת (פריט 7). ראו `qualifyingActions`.
   */
  agreedCustomAction: boolean;
}

/** פעולת שיווק מתועדת. */
export interface MarketingAction {
  kind: MarketingActionKind;
  performedAt: Date;
  /** כמה מתווכים נחשפו — רלוונטי רק ל-`broker_network`. */
  brokerCount?: number;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** המועד המאוחר ביותר שהחוק מתיר לתקופה שהתחילה ב-`startsAt`. */
export function maxExclusivityEnd(subject: ExclusivitySubject, startsAt: Date): Date {
  return addMonths(startsAt, MAX_EXCLUSIVITY_MONTHS[subject]);
}

/**
 * ברירת המחדל כשלא נקבעה תקופה — או `null` כשאין כזו בחוק.
 *
 * `null` אינו "בלי הגבלה": הוא אומר שהמערכת אינה יודעת, ולכן הטופס
 * ידרוש תאריך מפורש.
 */
export function defaultExclusivityEnd(subject: ExclusivitySubject, startsAt: Date): Date | null {
  if (subject !== "apartment") return null;
  return addDays(startsAt, DEFAULT_APARTMENT_EXCLUSIVITY_DAYS);
}

/**
 * מועד השליש — 9(ב2).
 *
 * מחושב מהתקופה בפועל ולא ממספר קבוע: שליש מ-30 יום הוא 10 ימים,
 * ושליש מחצי שנה הוא חודשיים. אותו כלל, שני מועדים שונים לגמרי.
 */
export function thirdDate(startsAt: Date, endsAt: Date): Date {
  const span = endsAt.getTime() - startsAt.getTime();
  return new Date(startsAt.getTime() + Math.round(span / 3));
}

/**
 * הסיבה לדחות תקופה שהוזנה, או `null` כשהיא תקינה.
 *
 * הבדיקה מגינה על המשרד ולא עליו: סעיף בלעדיות שחורג מהתקרה אינו
 * מקנה יותר זמן, הוא רק הופך את הסעיף לבעייתי מול הלקוח.
 */
export function exclusivityRejectionReason(input: {
  subject: ExclusivitySubject;
  startsAt: Date;
  endsAt: Date;
}): string | null {
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    return "תאריכים לא תקינים";
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    return "מועד הסיום חייב להיות אחרי מועד ההתחלה";
  }
  const max = maxExclusivityEnd(input.subject, input.startsAt);
  if (input.endsAt.getTime() > max.getTime()) {
    const months = MAX_EXCLUSIVITY_MONTHS[input.subject];
    const what = input.subject === "apartment" ? "בדירה" : "במקרקעין שאינם דירה";
    return `תקופת בלעדיות ${what} אינה עולה על ${months} חודשים (חוק המתווכים, סעיף 9(ב))`;
  }
  return null;
}

/**
 * כמה פעולות שיווק **נספרות** מתוך המתועדות, עד מועד נתון.
 *
 * שלוש הפחתות, כל אחת מהתקנות:
 *
 * 1. רק פעולות שבוצעו **לפני** המועד. פעולה שנעשתה אחרי מועד השליש
 *    אינה מצילה בלעדיות שכבר פקעה בו.
 * 2. שתי פעולות מאותו סוג הן פעולה אחת. "שתי פעולות" ברשימה של שש
 *    היא דרישה לגיוון, ולא לספירת מודעות.
 * 3. פריט (7) נספר רק כשסוכם עליו.
 *
 * **שיתוף מתווכים נצבר.** התקנה מדברת על "הזמנתם של חמישה מתווכים
 * אחרים לפחות" — מספר מצטבר, לא אירוע יחיד. במערכת כל הצעה יוצאת
 * למשרד אחד, ולכן ספירה פר-פעולה הייתה פוסלת גם מי ששלח לשמונה.
 */
export function qualifyingActions(
  period: Pick<ExclusivityPeriod, "agreedCustomAction">,
  actions: readonly MarketingAction[],
  until: Date,
): MarketingActionKind[] {
  const kinds = new Set<MarketingActionKind>();
  let brokersReached = 0;
  for (const action of actions) {
    if (action.performedAt.getTime() > until.getTime()) continue;
    if (action.kind === "agreed_other" && !period.agreedCustomAction) continue;
    if (action.kind === "broker_network") {
      brokersReached += action.brokerCount ?? 1;
      continue;
    }
    kinds.add(action.kind);
  }
  if (brokersReached >= MIN_BROKERS_FOR_NETWORK_ACTION) kinds.add("broker_network");
  return MARKETING_ACTION_KINDS.filter((kind) => kinds.has(kind));
}

export type ExclusivityPhase =
  /** לפני מועד השליש, ועדיין חסרות פעולות. */
  | "at_risk"
  /** הדרישה מולאה, התקופה רצה. */
  | "active"
  /** מועד השליש חלף בלי הפעולות — 9(ב2). */
  | "ended_by_third_rule"
  /** התקופה הגיעה לסופה. */
  | "expired";

export interface ExclusivityState {
  phase: ExclusivityPhase;
  /** מועד השליש שחושב מהתקופה. */
  thirdAt: Date;
  /**
   * מתי הבלעדיות **באמת** נגמרת — הסיום שבהסכם, או מועד השליש אם
   * הכלל חל. זה המספר שמוצג למשרד, ולא מה שכתוב בחוזה.
   */
  effectiveEndsAt: Date;
  /** ימים עד `effectiveEndsAt`. שלילי אחרי שהסתיימה. */
  daysLeft: number;
  /** ימים עד מועד השליש, כשהוא עוד לפנינו. */
  daysToThird: number | null;
  /** הפעולות שנספרו עד מועד השליש (או עד עכשיו, אם הוא טרם הגיע). */
  counted: MarketingActionKind[];
  /** כמה עוד חסרות כדי לעמוד בדרישה. */
  missing: number;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * מצב הבלעדיות עכשיו.
 *
 * הפונקציה מקבלת `now` במפורש ולא קוראת לשעון: מועד משפטי שנבדק
 * מול שעון פנימי אינו ניתן לבדיקה, וכאן בדיוק המקרים שצריך לבדוק.
 */
export function exclusivityState(
  period: ExclusivityPeriod,
  actions: readonly MarketingAction[],
  now: Date,
): ExclusivityState {
  const thirdAt = thirdDate(period.startsAt, period.endsAt);
  const thirdPassed = now.getTime() >= thirdAt.getTime();
  const counted = qualifyingActions(period, actions, thirdPassed ? thirdAt : now);
  const missing = Math.max(0, MIN_MARKETING_ACTIONS - counted.length);

  /*
   * הכלל נבחן פעם אחת, במועד השליש. אחריו הוא אינו מתהפך: בלעדיות
   * שפקעה שם אינה קמה לתחייה בפעולה מאוחרת, ובלעדיות ששרדה אינה
   * נבדקת שוב.
   */
  const endedByThirdRule = thirdPassed && missing > 0;
  const effectiveEndsAt = endedByThirdRule ? thirdAt : period.endsAt;
  const daysLeft = daysBetween(now, effectiveEndsAt);

  let phase: ExclusivityPhase;
  if (endedByThirdRule) phase = "ended_by_third_rule";
  else if (now.getTime() >= period.endsAt.getTime()) phase = "expired";
  else if (missing > 0) phase = "at_risk";
  else phase = "active";

  return {
    phase,
    thirdAt,
    effectiveEndsAt,
    daysLeft,
    daysToThird: thirdPassed ? null : daysBetween(now, thirdAt),
    counted,
    missing,
  };
}

/** כמה ימים לפני הסיום מתריעים. יורד — ההתראה הראשונה היא הרחוקה. */
export const EXCLUSIVITY_WARNING_DAYS: readonly number[] = [30, 7, 1];

/**
 * כמה ימים לפני מועד השליש מתריעים על פעולות חסרות.
 *
 * שבוע ולא יותר: שתי פעולות שיווק הן עבודה של שעה — מודעה ושלט —
 * והתראה שמגיעה חודש מראש נקראת כרעש. שבוע הוא גם מספיק לבצע וגם
 * קרוב מספיק כדי שייעשה בו משהו.
 */
export const EXCLUSIVITY_THIRD_WARNING_DAYS = 7;

/**
 * המשפט שהמשרד קורא. אחד, מדויק, ובלי לדרוש ממנו לפרש מספרים.
 */
export function describeExclusivity(state: ExclusivityState): string {
  switch (state.phase) {
    case "ended_by_third_rule":
      return `הבלעדיות הסתיימה במועד השליש — עד ${formatDate(state.thirdAt)} תועדו ${state.counted.length} פעולות שיווק מתוך ${MIN_MARKETING_ACTIONS} הנדרשות (סעיף 9(ב2)).`;
    case "expired":
      return `הבלעדיות הסתיימה ב-${formatDate(state.effectiveEndsAt)}.`;
    case "at_risk":
      return `חסרות ${state.missing} פעולות שיווק עד ${formatDate(state.thirdAt)} — בלעדיהן הבלעדיות מסתיימת שם ולא ב-${formatDate(state.effectiveEndsAt)}.`;
    case "active":
      return `הבלעדיות בתוקף עוד ${state.daysLeft} ימים, עד ${formatDate(state.effectiveEndsAt)}.`;
  }
}

/**
 * דוח השיווק לבעל הנכס.
 *
 * זו ההצדקה הישירה לכל התיעוד: התקנות דורשות פעולות שיווק, והמוכר
 * הוא מי ששואל "מה עשיתם בשבילי". עד היום התשובה הייתה זיכרון של
 * הסוכן; כאן היא רשימה עם תאריכים, שנבנתה מאליה תוך כדי העבודה.
 *
 * הדוח **אינו** כולל את מצב כלל השליש ואת הימים שנותרו: אלה נתונים
 * שהמשרד צריך לנהל לפיהם, ושליחתם למוכר רק מזמינה שיחה על תוקף
 * הבלעדיות במקום על השיווק.
 */
export function ownerReportText(input: {
  propertyTitle: string;
  officeName: string;
  period: Pick<ExclusivityPeriod, "startsAt" | "endsAt">;
  actions: readonly MarketingAction[];
  now: Date;
}): string {
  const done = input.actions
    .filter((a) => a.performedAt.getTime() <= input.now.getTime())
    .sort((a, b) => a.performedAt.getTime() - b.performedAt.getTime());

  const lines = [
    `דוח פעולות שיווק — ${input.propertyTitle}`,
    `${input.officeName} · תקופת הבלעדיות: מ-${formatDate(input.period.startsAt)} עד ${formatDate(input.period.endsAt)}`,
    "",
  ];

  if (done.length === 0) {
    lines.push("טרם בוצעו פעולות שיווק בתקופה זו.");
    return lines.join("\n");
  }

  for (const kind of MARKETING_ACTION_KINDS) {
    const ofKind = done.filter((a) => a.kind === kind);
    if (ofKind.length === 0) continue;
    const first = ofKind[0]!;
    const last = ofKind[ofKind.length - 1]!;
    const when =
      ofKind.length === 1
        ? formatDate(first.performedAt)
        : `${ofKind.length} פעמים, מ-${formatDate(first.performedAt)} עד ${formatDate(last.performedAt)}`;
    lines.push(`• ${MARKETING_ACTION_LABEL[kind]} — ${when}`);
  }
  return lines.join("\n");
}

/**
 * תאריך בשעון ישראל — ולא בשעון התהליך.
 *
 * כאן זה לא עניין של הצגה. פעולת שיווק שנרשמה ב-01:00 בלילה
 * בירושלים היא 22:00 של **אתמול** ב-UTC, והנוסח שיצא למוכר הקדים
 * אותה ביום שלם. בדוח שנועד להראות שעמדנו בתקנות — ושמועד השליש
 * נגזר ממנו — יום הוא ההבדל בין „בזמן” ל„באיחור”.
 *
 * ‎`formatJerusalemDate` היה קיים כאן לצדנו לאורך כל הזמן; המודול
 * הזה פשוט לא קרא לו והחזיק מעצב פרטי משלו על `getUTC*`.
 */
const formatDate = formatJerusalemDate;
