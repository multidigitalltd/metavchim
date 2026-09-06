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
  /** ‏מתי החיוב נדחה. `null` = אין גבייה פתוחה. */
  paymentFailedAt: Date | null;
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
    if (nowMs > dueMs + FUNNEL_MAX_LAG_DAYS[stage.clock] * DAY_MS) continue;
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
 * ‏גם מסלול הגבייה כפוף לו. חלון החסד הוא שלושה ימים, ועיכוב של
 * שבת אחת נשאר בתוכו — בעוד שהודעה על כסף שנוחתת בליל שבת עולה
 * יותר ממה שהיא מקדמת.
 */
export function isFunnelSendingHour(parts: { weekday: string; hour: number }): boolean {
  if (parts.weekday === "Saturday") return false;
  return parts.hour >= 9 && parts.hour < 18;
}

/* ────────────────────────────  כניסה מדורגת  ──────────────────────────── */

/**
 * ‎**מי נכנס למסלול היום — ובכמה.**
 *
 * ## ‏הבעיה שזה פותר
 *
 * ‏„כל משרד מתחיל ביום 0 שלו” נשמע כמו החלטה על משרד בודד, אבל
 * ביום ההשקה יש **קבוצה שלמה** שטרם נכנסה. אם כולם מתחילים באותו
 * בוקר, כולם מקבלים את ההודעה הראשונה באותו בוקר — וזה בדיוק גל
 * השליחה שמספר וואטסאפ יחיד לא שורד.
 *
 * ‏„לאט לאט” חייב לחול גם על הקבוצה, לא רק על כל משרד בנפרד.
 *
 * ## ‏הוותיקים ראשונים
 *
 * ‏מי שנרשם מזמן קרוב יותר לתפוגת הניסיון שלו, ולכן יש לו פחות זמן
 * לקבל את התוכן. סדר הפוך היה מבזבז עליו את הימים שנשארו.
 */
export function funnelEntryBatch<T extends { id: string; createdAt: Date }>(
  candidates: readonly T[],
  dailyQuota: number,
): T[] {
  if (dailyQuota <= 0) return [];
  return [...candidates]
    .sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id, "en"),
    )
    .slice(0, dailyQuota);
}

/** ‏ברירת המחדל של הכניסה היומית — כשבוע לקטלוג בגודל הנוכחי. */
export const FUNNEL_DEFAULT_DAILY_ENTRIES = 25;

/** ‏מי שנרשם בתוך החלון הזה נחשב „חדש”, לא „פיגור”. */
export const FUNNEL_FRESH_SIGNUP_HOURS = 48;

/**
 * ‎**מי נכנס עכשיו — החדשים מיד, והוותיקים לפי המכסה.**
 *
 * ## ‏למה זה לא סתם `funnelEntryBatch`
 *
 * ‏המכסה נועדה **לנקז פיגור**: ביום ההשקה יש קבוצה שלמה שממתינה,
 * והיא נכנסת על פני כשבוע. אבל המכסה מסדרת ותיקים ראשונים — ולכן
 * משרד שנרשם הבוקר היה נדחק לסוף התור, ומקבל את „יום 0” שלו
 * **בעוד שבוע**. זו ההודעה שכל התוכנית נשענת עליה, והיא הייתה
 * מגיעה אחרי שהוא כבר ניסה את המערכת לבד ונטש.
 *
 * ‏שתי המטרות אינן סותרות ברגע שמפרידים ביניהן: הרשמה טרייה אינה
 * פיגור, ולכן היא אינה נספרת במכסה. בקצב הרגיל מדובר בכמה משרדים
 * ביום — לא גל.
 */
export function funnelEntryPlan<T extends { id: string; createdAt: Date }>(
  candidates: readonly T[],
  dailyQuota: number,
  now: Date,
): T[] {
  const freshFrom = now.getTime() - FUNNEL_FRESH_SIGNUP_HOURS * HOUR_MS;
  const fresh: T[] = [];
  const backlog: T[] = [];
  for (const candidate of candidates) {
    (candidate.createdAt.getTime() >= freshFrom ? fresh : backlog).push(candidate);
  }
  return [...fresh, ...funnelEntryBatch(backlog, dailyQuota)];
}

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
  sent: readonly string[];
  anchors: FunnelAnchors;
  now: Date;
}): FunnelExitReason | null {
  if (input.track === "dunning") {
    if (!input.facts.chargeFailing) return "resolved";
  } else if (input.facts.hasValidCard) {
    return "paid";
  }
  const live = input.stages.filter((stage) => stage.enabled && stage.track === input.track);
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
    const dueAt = funnelStageDueAt(stage, input.anchors);
    if (dueAt === null) return false;
    const expiresMs = dueAt.getTime() + FUNNEL_MAX_LAG_DAYS[stage.clock] * DAY_MS;
    return input.now.getTime() <= expiresMs;
  });
  if (live.length > 0 && stillPossible.length === 0) return "completed";
  return null;
}
