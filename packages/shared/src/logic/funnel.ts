/**
 * ‎**מנוע המסלולים — שלבים שנערכים במסך, ולא רצף שקבוע בקוד.**
 *
 * ## ‏מה זה
 *
 * ‏שני מסלולים רצים על אותו מנוע: **משפך ההמרה** (חשבון ניסיון →
 * לקוח משלם) ו**מסלול הגבייה** (חיוב שנכשל → כרטיס שעודכן). שניהם
 * ‏„שלב שיוצא ביום מסוים למי שעונה על תנאי”, ולכן מנוע אחד ולא
 * שניים — ומה שנלמד באחד מגן על השני.
 *
 * ## ‏למה שני שעונים ולא אחד
 *
 * ‏זו ההכרעה שמכתיבה את כל המבנה. חלק מההודעות הן **תוכן**: „הוסיפו
 * נכס ראשון”, „ייבוא מאקסל”. הן נספרות מהיום שהמשרד נכנס למסלול,
 * והן נכונות באותה מידה בכל יום.
 *
 * ‏חלק מההודעות הן **מועד**: „נשארו יומיים”, „מה ננעל”. הן תלויות
 * בתאריך אמיתי — תפוגת הניסיון — ואין להן משמעות בלעדיו.
 *
 * ‏משרד שנרשם לפני עשרה ימים ונכנס היום למשפך: הניסיון שלו נגמר
 * בעוד ארבעה ימים, אבל „נשארו יומיים” יושבת ביום 12 של המשפך. שעון
 * אחד היה שולח אותה **שמונה ימים אחרי שהחשבון כבר ננעל** — לא
 * הודעה מאוחרת, הודעה שקרית. לכן `clock` הוא תכונה של השלב.
 *
 * ## ‏פונקציה טהורה, ובכוונה
 *
 * ‏השירות אוסף עובדות, זה מחליט, השירות שולח — אותה תבנית של
 * ‎`onboarding` ו-`activation-nudge`. מה שנובע מזה: אפשר לבדוק את
 * כל כללי העיתוי בלי מסד, בלי שעון אמיתי, ובלי לשלוח דבר.
 */

import {
  jerusalemDayStart,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  jerusalemWeekday,
} from "./israel-time.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/* ────────────────────────────  אוצר מילים  ──────────────────────────── */

/**
 * ‏המסלולים. `conversion` הוא שיווק, `dunning` הוא שירות — וההבחנה
 * אינה סמנטית בלבד, ראו `isServiceTrack`.
 */
export const FUNNEL_TRACKS = ["conversion", "dunning"] as const;
export type FunnelTrack = (typeof FUNNEL_TRACKS)[number];

export const FUNNEL_TRACK_LABELS: Record<FunnelTrack, string> = {
  conversion: "משפך ההמרה",
  dunning: "גבייה שנכשלה",
};

/**
 * ‎**מסלול שירות — אי אפשר לכבות אותו, ו„הפסק” אינו חל עליו.**
 *
 * ‏מסלול הגבייה מדבר על החשבון של הנמען עצמו: החיוב נדחה, השירות
 * ייסגר בעוד שלושה ימים. זו אינה פרסומת שאפשר לבקש לא לקבל, וזו
 * אינה הודעה שמנהל הפלטפורמה אמור להיות מסוגל לכבות בטעות ואז
 * לגלות שלקוחות ננעלו בלי שנאמרה מילה.
 *
 * ‏המפסק הראשי כן עוצר גם אותו — אבל זו פעולה מפורשת של „עצור
 * הכול”, ולא כיבוי שלב בודד שנראה כמו ניקוי רשימה.
 */
export function isServiceTrack(track: FunnelTrack): boolean {
  return track === "dunning";
}

/**
 * ‏השעונים. כל שלב תלוי בעוגן אחד בדיוק.
 *
 * ‎`funnel` — ימים מהיום שהמשרד נכנס למסלול.
 * ‎`trial` — ימים ביחס לתפוגת הניסיון (שלילי = לפני).
 * ‎`payment` — ימים מהרגע שהחיוב נדחה.
 */
export const FUNNEL_CLOCKS = ["funnel", "trial", "payment"] as const;
export type FunnelClock = (typeof FUNNEL_CLOCKS)[number];

/**
 * ‎**איזה שעון מעוגן בכל מסלול — ולמה זו הגדרה ולא נימוס.**
 *
 * ‏שלושת השעונים נשענים על שלוש עוגנים: `funnel` על מועד הכניסה,
 * ‎`trial` על תפוגת הניסיון, ו-`payment` על רגע הדחייה. שני
 * ‏הראשונים קיימים בכל רישום; ה**שלישי קיים רק במסלול הגבייה**,
 * ‏כי רישום המרה לא נפתח מדחיית חיוב ואין לו מה למלא שם.
 *
 * ‏שלב שמצרף מסלול המרה עם שעון תשלום עובר את שתי הבדיקות
 * ‏הבודדות — שני הערכים מוכרים — ואז `funnelStageDueAt` מחזיר
 * ‎`null` כי אין עוגן. `funnelExitReason` קרא `null` כ„אי אפשר
 * ‏לעולם”, הוציא את השלב מהחשבון, וסגר את הרישום כ„מוצה” (ביקורת
 * ‏Codex, P1).
 *
 * ‏זו אותה טעות שתוקנה בשלב פסול, בלבוש אחר: **היעדר מידע נקרא
 * ‏כידיעה שלילית.** ההבדל הוא שכאן השורה עצמה תקינה לכל אבריה,
 * ‏ורק הצירוף אינו — ולכן הכלל חייב להיות מפורש.
 */
export const FUNNEL_TRACK_CLOCKS: Record<FunnelTrack, readonly FunnelClock[]> = {
  conversion: ["funnel", "trial"],
  dunning: ["funnel", "payment"],
};

/** ‏האם לצירוף הזה יש בכלל עוגן שאפשר למדוד ממנו. */
export function isFunnelClockAnchored(track: FunnelTrack, clock: FunnelClock): boolean {
  return FUNNEL_TRACK_CLOCKS[track].includes(clock);
}

/**
 * ‎**גבול ההיסט — שנה לכל כיוון.**
 *
 * ## ‏למה בכלל צריך גבול
 *
 * ‏`offset_days` הוא `INTEGER` במסד, ולכן `2147483647` הוא ערך
 * ‏חוקי לגמרי מבחינתו. `funnelStageDueAt` מחשב
 * ‏`anchor + offset × DAY_MS`, וזה חורג מטווח ה-`Date` של
 * ‏JavaScript — התוצאה היא `Invalid Date`. משם היא נכנסת לחישוב
 * ‏התפוגה ולעזרי שעון ירושלים, שם היא **זורקת** — כלומר שורת
 * ‏תצורה אחת מפילה את כל סבב הרישום, לכל המשרדים (ביקורת Codex,
 * ‏P2).
 *
 * ‏וזה בדיוק מה שהמנגנון הזה נבנה למנוע: שלב פגום אמור להיות
 * ‏**חסם מיצוי** שנרשם ב-`catalog().invalid` — לא קריסה.
 *
 * ## ‏ולמה שנה, ולמה שלילי מותר
 *
 * ‏שלילי הוא חלק מהמודל: `trial_heads_up` יושב על `-2`, כלומר
 * ‏יומיים **לפני** תפוגת הניסיון. הגבול הוא לכן סימטרי.
 *
 * ‏שנה היא מרווח נדיב פי עשרים מההיסט הגדול בקטלוג (17), ורחוקה
 * ‏בסדרי גודל מהמקום שבו `Date` נשבר. גבול צמוד יותר היה פוסל
 * ‏תצורה לגיטימית של משרד; גבול רחב יותר לא היה קונה דבר.
 */
export const FUNNEL_OFFSET_DAYS_MAX = 365;

/** ‏האם ההיסט בטווח שאפשר לחשב ממנו תאריך. */
export function isFunnelOffsetInRange(offsetDays: number): boolean {
  return (
    Number.isInteger(offsetDays) && Math.abs(offsetDays) <= FUNNEL_OFFSET_DAYS_MAX
  );
}

export const FUNNEL_CLOCK_LABELS: Record<FunnelClock, string> = {
  funnel: "מיום הכניסה למסלול",
  trial: "ביחס לתפוגת הניסיון",
  payment: "מרגע שהחיוב נדחה",
};

/** הערוצים. שניהם, או אחד מהם — לכל שלב בנפרד. */
export const FUNNEL_CHANNELS = ["email", "whatsapp"] as const;
export type FunnelChannel = (typeof FUNNEL_CHANNELS)[number];

export const FUNNEL_CHANNEL_LABELS: Record<FunnelChannel, string> = {
  email: "מייל",
  whatsapp: "וואטסאפ",
};

/**
 * ‎**התנאים — רשימה סגורה, כי היא נבחרת מתפריט במסך.**
 *
 * ‏זו הסיבה שהיא סגורה ולא ביטוי חופשי: מנהל הפלטפורמה עורך שלב
 * בטופס, ותיבת טקסט שמצפה לביטוי לוגי היא דרך בטוחה לשלוח הודעה
 * לקהל הלא נכון. כל תנאי כאן נגזר מעובדה שהמערכת כבר מחשבת.
 */
export const FUNNEL_AUDIENCES = [
  "always",
  "no_properties",
  "next_step_pending",
  "has_data",
  "feature_unused",
  "no_card",
  "trial_active",
  "charge_still_failing",
] as const;
export type FunnelAudience = (typeof FUNNEL_AUDIENCES)[number];

export const FUNNEL_AUDIENCE_LABELS: Record<FunnelAudience, string> = {
  always: "כל מי שבמסלול",
  no_properties: "טרם הוזן נכס",
  next_step_pending: "הצעד החיוני הבא טרם הושלם",
  has_data: "יש כבר נתונים במערכת",
  feature_unused: "יש פיצ׳ר במסלול שלא נגעו בו",
  no_card: "אין כרטיס אשראי תקף",
  trial_active: "הניסיון עדיין בתוקף",
  charge_still_failing: "החיוב עדיין לא עבר",
};

/* ────────────────────────────  העובדות  ──────────────────────────── */

/**
 * ‏מה שהמערכת יודעת על המשרד ברגע ההחלטה.
 *
 * ‏שדה אחד לכל תנאי, ולא אובייקט חופשי: תנאי חדש מחייב שדה חדש,
 * וקומפילציה נופלת בכל מקום שמרכיב את העובדות — כלומר אי אפשר
 * להוסיף תנאי ולשכוח למלא אותו.
 */
export interface FunnelFacts {
  hasProperties: boolean;
  /** ‏יש נכס, קונה או שיחה — כלומר יש על מה לדבר בהודעת „מה עשינו לכם” */
  hasData: boolean;
  /** ‏נשאר צעד חיוני שטרם הושלם ב-`onboardingSteps()` */
  nextStepPending: boolean;
  /** ‏יש במסלול פיצ׳ר שהמשרד מעולם לא נגע בו */
  featureUnused: boolean;
  hasValidCard: boolean;
  /** ‏הניסיון עדיין לא פג. `false` גם למשרד שאין לו ניסיון כלל. */
  trialActive: boolean;
  /** ‏החיוב שנדחה עדיין לא נפרע */
  chargeFailing: boolean;
}

/** ‏האם המשרד עונה על תנאי בודד. */
export function matchesAudience(audience: FunnelAudience, facts: FunnelFacts): boolean {
  switch (audience) {
    case "always":
      return true;
    case "no_properties":
      return !facts.hasProperties;
    case "next_step_pending":
      return facts.nextStepPending;
    case "has_data":
      return facts.hasData;
    case "feature_unused":
      return facts.featureUnused;
    case "no_card":
      return !facts.hasValidCard;
    case "trial_active":
      return facts.trialActive;
    case "charge_still_failing":
      return facts.chargeFailing;
  }
}

/**
 * ‎**כל התנאים, ולא אחד מהם.**
 *
 * ‏„no_card ‎+‎ has_data” בתוכנית פירושו שניהם: „הנתונים שלכם
 * ממתינים” נשלחת רק למי שגם לא שילם וגם באמת הזין משהו. „או” היה
 * שולח אותה למשרד ריק, וההודעה הייתה מצביעה על כלום.
 *
 * ‏רשימה ריקה נקראת כ„תמיד” ולא כ„אף פעם”: שלב שנשמר בטעות בלי
 * תנאי אמור לצאת לכולם, לא להיעלם בשקט.
 */
export function matchesAllAudiences(
  audiences: readonly FunnelAudience[],
  facts: FunnelFacts,
): boolean {
  return audiences.every((audience) => matchesAudience(audience, facts));
}

/* ────────────────────────────  השלב  ──────────────────────────── */

/** ‏הגדרת שלב — מה שנשמר בטבלה ונערך במסך. */
export interface FunnelStageDef {
  /** ‏מזהה יציב. הוא מה שנרשם ביומן, ולכן שינוי שם שובר את הזיכרון. */
  key: string;
  track: FunnelTrack;
  clock: FunnelClock;
  /** ‏שלילי = לפני העוגן. `trial` עם `-2` הוא „יומיים לפני התפוגה”. */
  offsetDays: number;
  audience: readonly FunnelAudience[];
  channels: readonly FunnelChannel[];
  enabled: boolean;
}

/** ‏העוגנים של המשרד — `null` פירושו שהשעון הזה לא רץ עבורו. */
export interface FunnelAnchors {
  /** ‏היום שבו המשרד נכנס למסלול. `null` = טרם נכנס. */
  funnelStartedAt: Date | null;
  trialEndsAt: Date | null;
  /**
   * ‎**האם `trialEndsAt` ריק כי הניסיון נגמר — ולא כי הערך חסר.**
   *
   * ‏שני המצבים נראים אותו דבר על השורה ואינם אותו דבר בהחלטה:
   * ‏ערך שחסר עשוי לחזור, וניסיון שנגמר לא יחזור. בלי ההבחנה
   * ‏הזו כל אחד משניהם נקרא כשני — ואין קריאה שנכונה לשניהם.
   *
   * ‏`trialAnchorConcluded` הוא מי שעונה על השאלה מתוך שורת
   * ‏הדייר, במקום אחד, כדי שהיא לא תיענה פעמיים באופן שונה.
   */
  trialConcluded: boolean;
  /** ‏מתי החיוב נדחה. `null` = אין גבייה פתוחה. */
  paymentFailedAt: Date | null;
}

/**
 * ‎**האם למשרד כבר אין ניסיון — ולא „לא הצלחנו לקרוא מתי הוא נגמר”.**
 *
 * ## ‏למה השאלה בכלל נשאלת
 *
 * ‏הכניסה למסלול דורשת `status: "trial"` **וגם** `trialEndsAt`
 * ‏שאינו ריק, ולכן בכניסה העוגן תמיד שם. הוא מתרוקן רק אחר כך,
 * ‏ובשתי משמעויות הפוכות: ניסיון שנגמר בכוונה (מעבר למסלול חינמי,
 * ‏הענקת תקופה) — שאין אחריו כרטיס שיסגור את הרישום כ„שילם” —
 * ‏ולעומתו איפוס זמני ממסך החיוב, שהתאריך יכול לחזור ממנו ברגע.
 *
 * ## ‎**ולמה זה נשמר ואינו נגזר**
 *
 * ‏הגרסה הקודמת ניחשה את ההבדל מ-`status` ומ-`paidUntil`, וזה
 * ‏נשבר בדיוק כפי שניחוש נשבר: „פתח ללא תפוגה” שולח
 * ‏`paidUntil: null`, מוחק את תאריך הניסיון, ומשאיר את הסטטוס
 * ‏„ניסיון” — מצב **שאינו ניתן להבחנה** מהאיפוס הזמני, ולכן נקרא
 * ‏כ„עדיין אפשרי” ונשאר פתוח לנצח. ובכיוון השני, מנהל שמחזיר משרד
 * ‏חינמי לניסיון אמיתי הופך את ה„נגמר” לשקר, כי הסטטוס לבדו אינו
 * ‏זוכר מה קרה (ביקורת Codex, שני ממצאים).
 *
 * ‏הסיבה אינה נמצאת בנתונים, ולכן היא נכתבת: `trialConcludedAt`
 * ‏נרשם על ידי מי שמסיים את הניסיון, ומתאפס על ידי מי שמעניק
 * ‏ניסיון חדש. השאלה כאן חדלה להיות ניחוש והפכה לקריאה.
 */
export function trialAnchorConcluded(tenant: {
  status: string;
  trialEndsAt: Date | null;
  trialConcludedAt: Date | null;
}): boolean {
  /*
   * ‎**משרד שאינו בניסיון — הניסיון שלו נגמר, ותאריך שנשאר אינו
   * ‏משנה זאת** (ביקורת Codex, P2).
   *
   * ‏השאלה נשאלה על התאריך בלבד, ולכן משרד שעבר ל-`active` או
   * ‏ל-`suspended` בזמן שהתאריך העתידי נשאר בשורה נקרא כמי
   * ‏שהניסיון שלו עוד רץ: שלבי „נשארו יומיים” נותרו „עדיין
   * ‏אפשריים”, הרישום נשאר פתוח, וברגע שהשליחה נדלקת הם יוצאים —
   * ‏אל משרד **משלם**. וניקוי התאריך אחר כך היה משאיר אותו פתוח
   * ‏לתמיד, כי `trialConcludedAt` לא נכתב במעבר הסטטוס.
   *
   * ‏זו אותה אחדות של `isTrialActive`: „בניסיון” הוא סטטוס **וגם**
   * ‏תאריך, ולכן גם „יצא מהניסיון” נקרא מהסטטוס. הדרך חזרה קיימת
   * ‏ומוגדרת — `reopenForRestoredTrial`, שדורש בדיוק את שני
   * ‏החצאים האלה.
   */
  if (tenant.status !== "trial") return true;
  // ‏תאריך שקיים אינו „נגמר”: הוא פשוט מועד, שעבר או שלא
  if (tenant.trialEndsAt !== null) return false;
  return tenant.trialConcludedAt !== null;
}

/**
 * ‎**עוגן הניסיון כולו — התאריך והמסקנה יחד.**
 *
 * ‏השניים נגזרים מאותה שורה ומאותו כלל, ושני קוראים שיגזרו אותם
 * ‏בנפרד הם בדיוק הפרידה שכבר קרתה כאן: תאריך עתידי לצד „לא
 * ‏נגמר” על משרד שאינו בניסיון.
 */
export function trialAnchorOf(tenant: {
  status: string;
  trialEndsAt: Date | null;
  trialConcludedAt: Date | null;
}): { trialEndsAt: Date | null; trialConcluded: boolean } {
  return {
    trialEndsAt: tenant.status === "trial" ? tenant.trialEndsAt : null,
    trialConcluded: trialAnchorConcluded(tenant),
  };
}

/**
 * ‏מתי השלב אמור לצאת — או `null` כשהשעון שלו אינו רץ.
 *
 * ‎`null` ולא תאריך רחוק: „אין לזה מועד” ו„המועד עוד לא הגיע” הם
 * שני מצבים שונים, ומיזוגם היה הופך משרד בלי ניסיון למועמד קבוע
 * לתזכורת על תפוגה שלא תקרה.
 */
export function funnelStageDueAt(stage: FunnelStageDef, anchors: FunnelAnchors): Date | null {
  const anchor =
    stage.clock === "funnel"
      ? anchors.funnelStartedAt
      : stage.clock === "trial"
        ? anchors.trialEndsAt
        : anchors.paymentFailedAt;
  if (anchor === null) return null;
  return new Date(anchor.getTime() + stage.offsetDays * DAY_MS);
}

/**
 * ‎**שעות השליחה — תשע עד שש, ולא בשבת.**
 *
 * ‏שני מספרים ולא ארבעה: `isFunnelSendingHour` שואלת „מותר עכשיו”,
 * ‏ו-`firstFunnelSendingWindowEnd` שואלת „מתי ההזדמנות הבאה
 * נסגרת”. שתיהן חייבות לדבר על אותו חלון — שתי הגדרות היו נותנות
 * ‏תפוגה שאינה מתאימה לחלון שבו באמת שולחים.
 */
const SENDING_START_HOUR = 9;
const SENDING_END_HOUR = 18;
/** ‏0 ראשון … 6 שבת, כמו `jerusalemWeekday`. */
const SATURDAY = 6;

/**
 * ‎**תקרת פיגור לכל שעון בנפרד — ולא מספר אחד לכולם.**
 *
 * ‏זה נראה כמו כוונון והוא למעשה כלל נכונות. תוכן ההפעלה („הוסיפו
 * נכס ראשון”) נכון גם שבוע באיחור, ולכן פיגור סביר עדיף על ויתור.
 * ‏„נשארו יומיים” באיחור של שלושה ימים היא **הודעה שקרית** — עדיף
 * שלא תישלח כלל. ובגבייה חלון החסד כולו שלושה ימים, ולכן תזכורת
 * שאיחרה יותר מיום כבר מדברת על מצב אחר.
 *
 * ‏בלי ההפרדה הזאת היינו נאלצים לבחור: תקרה קצרה שמוחקת תוכן
 * שימושי, או תקרה ארוכה ששולחת שקרים.
 */
export const FUNNEL_MAX_LAG_DAYS: Record<FunnelClock, number> = {
  funnel: 7,
  trial: 2,
  payment: 1,
};

/**
 * ‎**מרווח מזערי בין שתי הודעות לאותו משרד.**
 *
 * ‏עשרים שעות ולא עשרים וארבע: שתי הודעות ביומיים עוקבים בשעות
 * שונות הן בסדר, שתיים באותו יום עבודה הן הצקה. שני שעונים שרצים
 * במקביל יכולים בקלות להבשיל באותו בוקר, וזה בדיוק המקרה שהמרווח
 * קיים בשבילו.
 */
export const FUNNEL_MIN_GAP_HOURS = 20;

/**
 * ‎**מתי השלב חדל להיות רלוונטי — ולעולם לא לפני שהייתה לו הזדמנות
 * אחת לצאת.**
 *
 * ## ‏למה זה לא פשוט „מועד + תקרת פיגור”
 *
 * ‏כך זה היה, וזה היה שגוי דווקא במסלול שהכי חשוב בו לדייק. חיוב
 * ‏שנכשל בשש וחצי בערב יום שישי: `pay_failed` מגיע מיד, תקרת
 * ‏הפיגור שלו יום אחד, ולכן הוא **פג בשבת בערב** — לפני שנפתח
 * ‏חלון השליחה הבא, ראשון בתשע. המשרד היה מקבל כהודעה ראשונה את
 * ‏`pay_reminder`: תזכורת על הודעה שמעולם לא נשלחה (ביקורת Codex).
 *
 * ‏ההערה שלי מעל `isFunnelSendingHour` אף טענה שעיכוב של שבת „נשאר
 * ‏בתוך החלון”. זה נכון על חלון החסד בן שלושת הימים, ולא על תקרת
 * ‏הפיגור של השלב — כלומר הקוד סתר את ההסבר שלו עצמו.
 *
 * ## ‏הכלל
 *
 * ‏התפוגה היא המאוחר מבין השניים: המועד ועוד תקרת הפיגור, או סוף
 * ‏חלון השליחה הראשון שנפתח אחרי המועד. תקרת הפיגור ממשיכה לעשות
 * ‏את עבודתה — „נשארו יומיים” לא ייצא שלושה ימים באיחור — ובלי
 * ‏שהיא תמחק שלב שלא ניתן היה לשלוח אותו כלל.
 *
 * ‏מקום אחד לחישוב: הוא נדרש גם ל„מה יוצא עכשיו” וגם ל„המסלול
 * ‏מוצה”, ושתי נוסחאות מקבילות היו נפרדות בעריכה הראשונה.
 */
export function funnelStageExpiresAt(
  stage: FunnelStageDef,
  anchors: FunnelAnchors,
): Date | null {
  const dueAt = funnelStageDueAt(stage, anchors);
  if (dueAt === null) return null;
  const lagged = new Date(dueAt.getTime() + FUNNEL_MAX_LAG_DAYS[stage.clock] * DAY_MS);
  const firstChance = firstFunnelSendingWindowEnd(dueAt);
  return lagged.getTime() >= firstChance.getTime() ? lagged : firstChance;
}

/* ────────────────────────────  ההחלטה  ──────────────────────────── */

export interface FunnelDueInput {
  stages: readonly FunnelStageDef[];
  anchors: FunnelAnchors;
  facts: FunnelFacts;
  /** ‏מפתחות השלבים שכבר נשלחו למשרד הזה. */
  sent: readonly string[];
  /** ‏מתי יצאה ההודעה האחרונה — לאכיפת המרווח. `null` = טרם נשלח דבר. */
  lastSentAt: Date | null;
  now: Date;
}

/**
 * ‏כל השלבים שהגיע זמנם ועדיין בתוקף, **לפי סדר המועד**.
 *
 * ‏מיועד למסך („מה עומד לצאת”) ולבדיקות. השליחה עצמה משתמשת
 * ב-`nextFunnelStage`, שמוציא אחד.
 */
export function dueFunnelStages(input: FunnelDueInput): FunnelStageDef[] {
  const already = new Set(input.sent);
  const nowMs = input.now.getTime();

  const ready: { stage: FunnelStageDef; dueMs: number }[] = [];
  for (const stage of input.stages) {
    if (!stage.enabled) continue;
    if (already.has(stage.key)) continue;
    const dueAt = funnelStageDueAt(stage, input.anchors);
    if (dueAt === null) continue;
    const dueMs = dueAt.getTime();
    if (nowMs < dueMs) continue;
    const expiresAt = funnelStageExpiresAt(stage, input.anchors);
    if (expiresAt === null) continue;
    if (nowMs > expiresAt.getTime()) continue;
    if (!matchesAllAudiences(stage.audience, input.facts)) continue;
    ready.push({ stage, dueMs });
  }

  /*
   * ‏מיון לפי המועד, ובשוויון לפי המפתח. הקשירה אינה קוסמטית: בלעדיה
   * הסדר תלוי בסדר השורות שהמסד החזיר, ואז „איזו הודעה יוצאת קודם”
   * משתנה בין סבבים בלי שאיש שינה דבר.
   */
  ready.sort((a, b) => a.dueMs - b.dueMs || a.stage.key.localeCompare(b.stage.key, "en"));
  return ready.map((entry) => entry.stage);
}

/**
 * ‎**ההודעה הבאה — אחת, והמוקדמת שבתור.**
 *
 * ## ‏למה אחת
 *
 * ‏זה מה ש„לאט לאט” אומר בקוד. משרד שנכנס למסלול ושהניסיון שלו
 * קרוב לתפוגה יכול למצוא את עצמו עם שלושה שלבים בשלים באותו רגע;
 * שליחתם יחד היא בדיוק גל ההודעות שהתוכנית מנסה למנוע.
 *
 * ## ‏למה המוקדמת, ולא המאוחרת
 *
 * ‏כאן ההכרעה הפוכה מזו של `dueActivationNudge`, ובכוונה. שם
 * שלושת השלבים הם **אותה הודעה בעוצמות שונות**, ולכן „הניסיון נגמר
 * בעוד יומיים” למי שכבר פג הוא שקר — והמאוחרת היא הנכונה.
 *
 * ‏כאן השלבים הם **סיפור**: פעולה ראשונה, ואז המסך הריק, ואז
 * פיצ׳ר. דילוג למאוחרת היה משמיט תוכן שהמשרד מעולם לא קיבל, ומגיש
 * לו את הפרק החמישי. מה שמונע הודעות מיושנות הוא תקרת הפיגור —
 * והיא, לא סדר הבחירה, זו שמוחקת את מה שכבר אינו נכון.
 */
export function nextFunnelStage(input: FunnelDueInput): FunnelStageDef | null {
  if (input.lastSentAt !== null) {
    const since = input.now.getTime() - input.lastSentAt.getTime();
    if (since < FUNNEL_MIN_GAP_HOURS * HOUR_MS) return null;
  }
  return dueFunnelStages(input)[0] ?? null;
}

/* ────────────────────────────  שעות שקט  ──────────────────────────── */

/**
 * ‎**שעות שליחה — תשע עד שש, ולא בשבת.**
 *
 * ‏אותו כלל בדיוק של `ActivationNudgeService` ושל ההזמנה לשיחת
 * ההיכרות, וכאן הוא נכתב פעם אחת שכולם יקראו ממנו: דיוור שנוחת
 * בשלוש לפנות בוקר נקרא כספאם גם כשהתוכן מדויק.
 *
 * ‏גם מסלול הגבייה כפוף לו: הודעה על כסף שנוחתת בליל שבת עולה
 * יותר ממה שהיא מקדמת.
 *
 * ‏**וזה בדיוק מה שמחייב את `funnelStageExpiresAt`.** קודם כתוב
 * ‏כאן שעיכוב של שבת „נשאר בתוך חלון החסד” — נכון על שלושת הימים
 * ‏של הגבייה, ולא על תקרת הפיגור של השלב עצמו, שהיא יום אחד.
 * ‏ההודעה המיידית על כישלון חיוב בערב שישי פגה לפני שהחלון הבא
 * ‏נפתח בכלל.
 */
export function isFunnelSendingHour(parts: { weekday: string; hour: number }): boolean {
  if (parts.weekday === "Saturday") return false;
  return parts.hour >= SENDING_START_HOUR && parts.hour < SENDING_END_HOUR;
}

/**
 * ‎**סוף חלון השליחה השלם הראשון שנפתח מ-`after` והלאה.**
 *
 * ## ‏„שלם” — ולא „מה שנשאר מהחלון הנוכחי”
 *
 * ‏הגרסה הראשונה ספרה כל חלון שסופו עוד לפנינו, ולכן חיוב שנכשל
 * ‏בשישי ב-17:01 „קיבל הזדמנות” של 59 דקות. הסורק רץ **בראש כל
 * ‏שעה**, והריצה הבאה — 18:00 — כבר מחוץ לשעות השליחה. כלומר לא
 * ‏עברה בה ולו סריקה אחת, השלב פג בשבת ב-17:01, וההודעה הראשונה
 * ‏שוב הייתה `pay_reminder` (ביקורת Codex).
 *
 * ## ‏ולמה הכלל אינו „חלון שיש בו סריקה”
 *
 * ‏זו הייתה הצמדה של הלוגיקה הטהורה לקצב הסורק — מספר שנקבע בשלב
 * ‏ב׳ וחי במקום אחר. שינוי הקצב היה משנה בשקט את התפוגה, ושני
 * ‏עותקים של אותו מספר סוטים זה מזה.
 *
 * ‏במקום זה נדרש שהחלון **ייפתח** אחרי המועד. זה גס יותר לטובת
 * ‏הצד הבטוח — תפוגה מאוחרת אינה שולחת דבר, היא רק אינה מוחקת
 * ‏מוקדם — ואינו תלוי בקצב כלל.
 *
 * ‏עשרה ימים הם תקרת בטיחות ולא כלל: רצף של יותר מיומיים סגורים
 * ‏אינו קיים בלוח, והתקרה קיימת רק כדי שטעות עתידית בכלל השעות לא
 * ‏תיצור לולאה אינסופית. אם היא נגמרת — מוחזר `after` עצמו, כלומר
 * ‏„אין הזדמנות”, וההתנהגות חוזרת לתקרת הפיגור בלבד.
 */
export function firstFunnelSendingWindowEnd(after: Date): Date {
  for (let day = 0; day <= 10; day += 1) {
    const at = jerusalemDayStart(after, day);
    if (jerusalemWeekday(at) === SATURDAY) continue;
    const date = jerusalemWallParts(at).date;
    const hour = (h: number): Date =>
      jerusalemWallIsoToUtc(`${date}T${String(h).padStart(2, "0")}:00`);
    if (hour(SENDING_START_HOUR).getTime() >= after.getTime()) return hour(SENDING_END_HOUR);
  }
  return after;
}

/* ────────────────────────────  כניסה מדורגת  ──────────────────────────── */

/** ‏ברירת המחדל של הכניסה היומית — כשבוע לקטלוג בגודל הנוכחי. */
export const FUNNEL_DEFAULT_DAILY_ENTRIES = 25;

/** ‏מי שנרשם בתוך החלון הזה נחשב „חדש”, לא „פיגור”. */
export const FUNNEL_FRESH_SIGNUP_HOURS = 48;

/**
 * ‎**„לאט לאט” חל גם על הקבוצה — ולמה זה אינו פונקציה כאן.**
 *
 * ‏הכלל הוא „הרשמה טרייה נכנסת מיד; הפיגור נפרס לפי מכסה”, והוא
 * ‏מיושם בשתי שאילתות ב-`FunnelEnrollmentService`. הגרסה הראשונה
 * ‏חילקה כאן רשימה שכבר נשלפה, וזה היה **נכון רק עד גודל הדף**:
 * ‏מיון אחד אינו יכול לשרת גם „ותיקים ראשונים” וגם „טריים תמיד”,
 * ‏ולכן כל קבוצה חייבת להישלף בסדר שלה ובתקרה שלה.
 *
 * ‏מה שנשאר כאן הם שני המספרים שהכלל נשען עליהם, כדי שהם יהיו
 * ‏מוגדרים במקום אחד ולא בתוך שאילתה.
 */

/* ────────────────────────────  עצירה  ──────────────────────────── */

/**
 * ‏למה משרד יצא מהמסלול. נשמר על השורה כדי שהמסך יוכל לומר „נעצר
 * כי שילם” ולא רק „לא פעיל”.
 */
export const FUNNEL_EXIT_REASONS = ["paid", "completed", "opted_out", "resolved"] as const;
export type FunnelExitReason = (typeof FUNNEL_EXIT_REASONS)[number];

export const FUNNEL_EXIT_REASON_LABELS: Record<FunnelExitReason, string> = {
  paid: "שילם",
  completed: "סיים את הרצף",
  opted_out: "ביקש להפסיק",
  resolved: "החיוב עבר",
};

/**
 * ‎**האם השעון של השלב הזה כבוי לתמיד, ולא רק לא-מחושב עכשיו.**
 *
 * ‏רק שעון הניסיון יודע להיגמר. `funnel` מעוגן ב-`startedAt` של
 * ‏הרישום עצמו, ולכן אינו יכול להיעדר ברישום פתוח; `payment`
 * ‏מעוגן ברישום הגבייה, ורישום גבייה פתוח **הוא** העוגן. שעון
 * ‏שאין לו „נגמר” מוגדר נשאר במצב „לא ידוע” — כלומר בהגנה של
 * ‏הסבב הקודם, ולא בסגירה.
 */
export function funnelAnchorConcluded(clock: FunnelClock, anchors: FunnelAnchors): boolean {
  return clock === "trial" && anchors.trialConcluded;
}

/**
 * ‎**מתי המסלול נגמר למשרד הזה.**
 *
 * ‏המסלול נעצר ברגע שהמטרה הושגה, ולא בסופו: משרד ששילם באמצע
 * המשפך אינו אמור לקבל „נשארו יומיים”, ומשרד שכרטיסו נפרע אינו
 * אמור לקבל „מחר זה נסגר”. `null` = ממשיך.
 *
 * ‏הבדיקה יושבת כאן ולא בשאילתה כדי ששני המסלולים ייעצרו לפי אותו
 * כלל — ולא לפי שני `WHERE` שאפשר לתקן אחד מהם ולשכוח את השני.
 */
export function funnelExitReason(input: {
  track: FunnelTrack;
  facts: FunnelFacts;
  /** ‏כל שלבי המסלול שהוגדרו — כדי לדעת מתי הרצף מוצה. */
  stages: readonly FunnelStageDef[];
  /**
   * ‎**קיימת שורת שלב שלא הצלחנו לקרוא.**
   *
   * ‏שלב עם שעון, תנאי קהל או ערוץ שאינם מוכרים נזרק לפני שהוא
   * ‏מגיע לכאן, ולכן הוא נעדר מ-`stages` — ואז „לא נשאר שלב שיכול
   * ‏לצאת” נכון פורמלית ושקרי למעשה: הוא נכון רק על מה שהצלחנו
   * ‏לקרוא (ביקורת Codex, P1).
   */
  definitionsIncomplete?: boolean;
  sent: readonly string[];
  anchors: FunnelAnchors;
  now: Date;
}): FunnelExitReason | null {
  if (input.track === "dunning") {
    if (!input.facts.chargeFailing) return "resolved";
  } else if (input.facts.hasValidCard) {
    return "paid";
  }
  /*
   * ‎**כל שלבי המסלול — ולא רק המופעלים כרגע.**
   *
   * ‏זו ההבחנה בין „אי אפשר” ל„עדיין לא”. שלב כבוי אינו בלתי אפשרי:
   * ‏הוא **מתג שאפשר להדליק מחר**, וזו בדיוק תוכנית ההפעלה — 14
   * ‏השלבים נזרעים כבויים ונדלקים בהדרגה.
   *
   * ‏עם `enabled` בסינון הזה, המשרד הראשון שקיבל את השלב היחיד
   * ‏שהודלק היה נסגר מיד כ„מוצה”, ו-`enrollDue` מוציא מהמועמדות כל
   * ‏מי שכבר היה לו רישום — כלומר הקוהורט הקיים לא היה מקבל אף שלב
   * ‏שיודלק אחר כך, לנצח (ביקורת Codex, P1). ההדרגתיות עצמה הייתה
   * ‏שורפת את הקהל.
   *
   * ‏זה עדיין נגמר: שלב כבוי שחלונו חלף פג כמו כל שלב אחר, ולכן
   * ‏רישום אינו נשאר פתוח לנצח בגלל מתג שאיש לא הדליק.
   */
  const live = input.stages.filter((stage) => stage.track === input.track);
  const already = new Set(input.sent);
  /*
   * ‎**„מוצה” = לא נשאר שלב שעוד **יכול** לצאת — ולא „כולם נשלחו”.**
   *
   * ‏ההבדל אינו דקדוקי. שלב עם תנאי קהל („הנתונים שלכם ממתינים”,
   * רק למי שהזין משהו) לעולם אינו נרשם כנשלח למשרד שלא ענה עליו.
   * כלל שדורש שכולם יישלחו היה משאיר **כל משרד ריק תקוע במסלול
   * לנצח** — לא מקבל דבר, ולא נסגר לעולם.
   *
   * ‏לכן הבדיקה היא על החלון: שלב שנשלח, או ששעונו אינו רץ כלל, או
   * שמועדו ותקרת הפיגור שלו כבר מאחורינו — אינו יכול לצאת עוד.
   */
  const stillPossible = live.filter((stage) => {
    if (already.has(stage.key)) return false;
    const expiresAt = funnelStageExpiresAt(stage, input.anchors);
    /*
     * ‎**„אי אפשר לחשב” אינו „אי אפשר לעולם” — וכאן זה הכלל, לא חריג.**
     *
     * ‏`null` מגיע ממקום אחד בלבד: אין עוגן. אחרי ש-`FUNNEL_TRACK_CLOCKS`
     * ‏פוסל צירוף שאינו מעוגן **בהגדרה**, כל `null` שנשאר הוא **ערך
     * ‏שחסר בפועל** — למשל `trialEndsAt` שמנהל פלטפורמה איפס אחרי
     * ‏שהרישום כבר נפתח (`setBillingOverride` מתיר זאת במפורש).
     *
     * ‏קריאתו כ„בלתי אפשרי” סגרה את הרישום לצמיתות, ואם התאריך
     * ‏הוחזר אחר כך — מאותו מסך עצמו — המשרד כבר לא היה מקבל את
     * ‏שלבי הניסיון (ביקורת Codex).
     *
     * ‎**וזה בטוח דווקא בזכות הטבלה.** בלעדיה כל שלב עם שעון שאינו
     * ‏של המסלול היה חוסם סגירה לנצח; איתה, המסלול מצהיר אילו
     * ‏עוגנים אמורים להיות שם, ולכן עוגן חסר הוא **חריגה** ולא מצב
     * ‏רגיל. חוסר הסימטריה מכריע כמו קודם: רישום פתוח אינו עולה
     * ‏דבר — `dueFunnelStages` ממילא אינו שולח בלי מועד — ורישום
     * ‏שנסגר בטעות אבד.
     *
     * ‎**אלא ש„חסר” אינו המצב היחיד שנראה כך.** משרד שעבר למסלול
     * ‏חינמי מוחק את `trialEndsAt` בכוונה, ואינו מקבל כרטיס שיסגור
     * ‏את הרישום כ„שילם” — כלומר כל שלב ניסיון שלו מגיע לכאן עם
     * ‏`null` **לתמיד**. „עדיין אפשרי” הפך שם את התיקון מאובדן
     * ‏רישומים לתור תקוע: הרישום נשאר פתוח לנצח וכל סבב סורק אותו
     * ‏מחדש (ביקורת Codex). זו בדיוק הסכנה שביקשתי לבדוק בסבב
     * ‏הקודם, והיא קיימת.
     *
     * ‏לכן ההבחנה עוברת לשאלה הנכונה — לא „יש תאריך?” אלא „האם
     * ‏הניסיון נגמר?”. `trialAnchorConcluded` עונה עליה מתוך שורת
     * ‏הדייר: נגמר = בלתי אפשרי, חסר = לא ידוע, וההגנה מהסבב הקודם
     * ‏נשארת בדיוק במקום שנועדה לו.
     */
    if (expiresAt === null) return !funnelAnchorConcluded(stage.clock, input.anchors);
    return input.now.getTime() <= expiresAt.getTime();
  });
  if (live.length > 0 && stillPossible.length === 0) {
    /*
     * ‎**„מוצה” היא הכרזה בלתי הפיכה, ולכן היא דורשת הגדרה שלמה.**
     *
     * ‏`enrollDue` מוציא מהמועמדות כל מי שכבר היה לו רישום במסלול,
     * ‏ולכן סגירה אינה החלטה על היום אלא **לתמיד**. שורת שלב
     * ‏שנזרקה — שעון לא מוכר, תנאי קהל לא מוכר, אפס ערוצים — היא
     * ‏בדיוק המקרה שבו „לא נשאר מה לשלוח” נכון על מה שקראנו וייתכן
     * ‏שאינו נכון על מה שנכתב.
     *
     * ‏חוסר הסימטריה מכריע: רישום שנשאר פתוח אינו עולה דבר — שלב
     * ‏פסול אינו נשלח ממילא — ואילו רישום שנסגר בטעות אבד. לכן
     * ‏העדפנו להשאיר פתוח עד שהשורה תתוקן.
     */
    if (input.definitionsIncomplete === true) return null;
    return "completed";
  }
  return null;
}
