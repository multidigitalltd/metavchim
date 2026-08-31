import { type EmailContent } from "./email-template.js";

/**
 * ‎**תזכורות ההפעלה — למי שנרשם ולא השאיר כרטיס תקף.**
 *
 * ## מה זה
 *
 * חשבון שנפתח, התחיל ניסיון, ולא הוזן בו אמצעי תשלום. בסוף הניסיון
 * הוא ננעל ממילא — אבל עד עכשיו הוא ננעל **בשקט**: המשתמש גילה את
 * זה בפעם הבאה שניסה להיכנס, בלי אזהרה ובלי הסבר. שלוש הודעות
 * מדורגות הופכות את זה למשהו שאפשר להיערך אליו.
 *
 * ## למה שלוש, ולמה בקצב הזה
 *
 * יומיים לפני — אזהרה שיש עוד זמן לפעול. ביום עצמו — מה בדיוק
 * נסגר. שבוע אחרי — הודעה אחרונה, ואז שקט. יותר מזה זה כבר לא
 * ‎„נודניק” אלא רדיפה, וזו הדרך המהירה ביותר להיקרא ספאם.
 *
 * ## ההומור, והגבול שלו
 *
 * ההודעה מדברת בגובה העיניים — היא נשלחת לאדם שהתעניין ולא הספיק,
 * לא לחייב שמתחמק. אבל **מה שנסגר נאמר בפירוש**: בדיחה שמטשטשת
 * את העובדה שרוב המערכת ננעלת היא בדיחה על חשבון מי שקורא אותה.
 */

/** מה שנשמר על שורת המנוי כדי לחייב שוב — ומה שחסר למי שלא הפעיל. */
export interface CardOnFile {
  cardTokenEncrypted: string | null;
  cardMonth: number | null;
  cardYear: number | null;
}

/**
 * ‎**כרטיס תקף — קיים, ולא פג.**
 *
 * שירותי החידוש בודקים רק **קיום** ונותנים לסולק לדחות כרטיס שפג.
 * זו הכרעה נכונה שם: החיוב הוא הרגע שבו באמת מתברר. כאן ההכרעה
 * הפוכה — אנחנו שואלים „האם יש למה לצפות”, ולכרטיס שפג התוקף אין
 * סיכוי להיגבות. מי שנשאר עם כזה **צריך** לקבל את התזכורת.
 *
 * הכרטיס תקף עד **סוף** חודש התפוגה, וזה הנוהג בענף: כרטיס 12/26
 * עובד לאורך כל דצמבר 2026.
 */
export function hasValidCard(card: CardOnFile | null | undefined, now: Date): boolean {
  if (!card) return false;
  const { cardTokenEncrypted, cardMonth, cardYear } = card;
  if (cardTokenEncrypted === null || cardTokenEncrypted === "") return false;
  if (cardMonth === null || cardYear === null) return false;
  if (!Number.isInteger(cardMonth) || cardMonth < 1 || cardMonth > 12) return false;
  /*
   * שנה דו-ספרתית היא מה שכתוב על הכרטיס, ויש סולקים שמחזירים אותה
   * כמות שהיא. `26` שנקרא כשנת 26 לספירה הופך כל כרטיס לפג-תוקף —
   * כלומר תזכורת „לא הפעלתם” למי שדווקא כן.
   */
  const year = cardYear < 100 ? 2000 + cardYear : cardYear;
  if (year < 2000 || year > 2100) return false;
  // תחילת החודש **שאחרי** חודש התפוגה — עד אליה הכרטיס בתוקף
  const expiresAt = Date.UTC(year, cardMonth, 1);
  return now.getTime() < expiresAt;
}

/** שלוש התזכורות, לפי הסדר. */
export const ACTIVATION_NUDGE_STAGES = ["heads_up", "closing", "last_call"] as const;
export type ActivationNudgeStage = (typeof ACTIVATION_NUDGE_STAGES)[number];

/**
 * מתי כל תזכורת נשלחת, ביחס למועד שבו החשבון ננעל.
 *
 * שלילי = לפני. `closing` ביום עצמו, `last_call` שבוע אחרי.
 */
export const ACTIVATION_NUDGE_OFFSET_DAYS: Record<ActivationNudgeStage, number> = {
  heads_up: -2,
  closing: 0,
  last_call: 7,
};

/**
 * ‎**תקרת פיגור — ולא בגלל נימוס.**
 *
 * ביום הפריסה הראשון יש במסד כל מי שנרשם אי פעם ולא שילם, חלקם
 * מלפני שנה. בלי התקרה כולם היו מקבלים „הניסיון שלכם נגמר” באותו
 * בוקר — גל דיוור לכתובות מתות, שהדרך הבטוחה ביותר לשרוף איתו את
 * מוניטין הדומיין אצל ספקי הדואר.
 *
 * זה בדיוק הלקח מ-`MAX_AGE_DAYS` בהזמנה לשיחת ההיכרות; הוא נלמד
 * שם, והוא חל כאן במלואו.
 */
export const ACTIVATION_NUDGE_MAX_LAG_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** מתי תזכורת מסוימת אמורה לצאת. */
export function activationNudgeDueAt(stage: ActivationNudgeStage, deadline: Date): Date {
  return new Date(deadline.getTime() + ACTIVATION_NUDGE_OFFSET_DAYS[stage] * DAY_MS);
}

/**
 * איזו תזכורת מגיעה עכשיו — או `null` כשאין.
 *
 * ‎**המאוחרת שבאלה שהגיע זמנן, ולא המוקדמת.** חשבון שפג לפני עשרה
 * ימים ומעולם לא קיבל דבר אינו אמור לקבל היום „הניסיון נגמר בעוד
 * יומיים” ומחר את הבא בתור. זה גם לא נכון וגם נשמע כמו מכונה
 * שהתעוררה. הוא מקבל את ההודעה שמתאימה למצב שלו **עכשיו**, והשלבים
 * שפספס לא נשלחים לעולם.
 */
export function dueActivationNudge(input: {
  /** המועד שבו החשבון ננעל — סוף הניסיון או סוף התקופה ששולמה. */
  deadline: Date;
  /** מה כבר נשלח למשרד הזה. */
  sent: readonly ActivationNudgeStage[];
  now: Date;
}): ActivationNudgeStage | null {
  const already = new Set(input.sent);
  const ordered = [...ACTIVATION_NUDGE_STAGES].reverse();
  for (const stage of ordered) {
    const dueAt = activationNudgeDueAt(stage, input.deadline);
    if (input.now.getTime() < dueAt.getTime()) continue;
    // חלון: תזכורת שאיחרה יותר מדי אינה נשלחת בדיעבד
    if (input.now.getTime() > dueAt.getTime() + ACTIVATION_NUDGE_MAX_LAG_DAYS * DAY_MS) return null;
    return already.has(stage) ? null : stage;
  }
  return null;
}

export interface ActivationNudgeInput {
  stage: ActivationNudgeStage;
  ownerName: string;
  tenantName: string;
  /** המסלול שנבחר בהרשמה — מה שייפתח ברגע שיוזן כרטיס. */
  planName: string;
  /**
   * שם המסלול שאליו החשבון יורד. `undefined` = לא הוגדר מסלול כזה,
   * ואז ההודעה אומרת „החשבון ננעל” בלי להמציא שם למשהו שאין.
   */
  partnerPlanName?: string | undefined;
  /** הקישור למסך המנוי. */
  billingUrl: string;
  /** קישור ההסרה — חובה בכל דיוור אוטומטי (חוק התקשורת §30א). */
  optOutUrl: string;
}

/** מה שנשאר פתוח, בניסוח אחד — כדי ששלוש ההודעות לא יסתרו זו את זו. */
function remains(partnerPlanName: string | undefined): string {
  return partnerPlanName === undefined
    ? "החשבון עצמו ננעל — נשאר רק מסך המנוי, וכל מה שצברתם ממתין בפנים."
    : `מה שנשאר פתוח הוא מסלול ${partnerPlanName}: רשת שיתופי הפעולה עם שאר המשרדים.`;
}

/**
 * ‎**„רוב היכולות” — ובשמן.**
 *
 * ניסוח כללי („חלק מהיכולות יוגבלו”) הוא בדיוק מה שגורם לאנשים
 * להתעלם ואז להיות מופתעים. הרשימה קצרה ומוחשית, ומה שנשאר נאמר
 * באותה נשימה כדי שההודעה לא תישמע כמו איום.
 */
const CLOSES = "הנכסים, הקונים, ההתאמות האוטומטיות, הסוכן החכם, התמלול והוואטסאפ";

export function activationNudgeEmail(input: ActivationNudgeInput): {
  subject: string;
  content: EmailContent;
} {
  const footnote =
    "קיבלתם את ההודעה כי פתחתם חשבון במתווכים ועדיין לא הפעלתם אותו. " +
    `להפסקת התזכורות: ${input.optOutUrl}`;
  const button = { label: "להפעלת החשבון", url: input.billingUrl };
  const greeting = `שלום ${input.ownerName},`;

  if (input.stage === "heads_up") {
    return {
      subject: "עוד יומיים, והמערכת עוברת לדיאטה",
      content: {
        heading: "עוד יומיים, והמערכת עוברת לדיאטה",
        greeting,
        paragraphs: [
          `בעוד יומיים נגמרת תקופת הניסיון של ${input.tenantName}, ובמערכת אין עדיין כרטיס אשראי תקף.`,
          `מה שקורה אז: ${CLOSES} — כולם נסגרים. ${remains(input.partnerPlanName)}`,
          "הנתונים שלכם לא נמחקים ולא הולכים לשום מקום. הם פשוט יושבים ומחכים, קצת כמו נכס שהבעלים לא החליט אם למכור.",
          `דקה אחת במסך המנוי מחזירה את מסלול ${input.planName} למקומו, וזה כל הסיפור.`,
        ],
        button,
        footnote,
      },
    };
  }

  if (input.stage === "closing") {
    return {
      subject: "זהו — סגרנו את רוב הברזים",
      content: {
        heading: "תקופת הניסיון הסתיימה",
        greeting,
        paragraphs: [
          `תקופת הניסיון של ${input.tenantName} הסתיימה היום, ולא נכנס כרטיס אשראי — אז ${CLOSES} נעולים מהרגע הזה.`,
          remains(input.partnerPlanName),
          "לא נעמיד פנים שהתגעגענו כבר עכשיו. נאמר רק שהכול נשמר: כל נכס, כל קונה, כל התאמה וכל תמלול שנעשו בתקופת הניסיון ממתינים בדיוק איפה שהשארתם אותם.",
          "הזנת כרטיס פותחת את הכול בחזרה באותו רגע — בלי הקמה מחדש ובלי לאבד שורה אחת.",
        ],
        button,
        footnote,
      },
    };
  }

  return {
    subject: "המייל האחרון שלנו. באמת",
    content: {
      heading: "זו ההודעה האחרונה",
      greeting,
      paragraphs: [
        `עבר שבוע מאז ש-${input.tenantName} עבר למצב מצומצם, ולא שמענו מכם. הבנו את הרמז.`,
        "זו ההודעה האחרונה בנושא — לא נשלח עוד תזכורות הפעלה.",
        remains(input.partnerPlanName),
        `אם בעוד חודש או בעוד שנה תרצו לחזור: הנתונים שלכם עדיין שם, והזנת כרטיס תפתח את ${input.planName} בחזרה תוך שנייה.`,
      ],
      button,
      footnote,
    },
  };
}
