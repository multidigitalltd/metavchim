import { jerusalemDayStart, jerusalemWallParts } from "./israel-time.js";

/**
 * ‎**מי גר בנכס — שלוש אפשרויות, ורביעית שהיא „עדיין לא נשאלנו”.**
 *
 * ## מה זה פותר
 *
 * המסך ידע עד כה שני מצבים: יש שוכר רשום, או אין. וכשלא היה, הוא
 * אמר „הבעלים גר בנכס, **או** שאין דייר” — כלומר הכריז על שתי
 * עובדות שאיש לא בדק, על סמך היעדר רשומה. זו אותה מחלקה שחוזרת
 * במערכת הזו: „לא ידוע” שנקרא כ„לא”.
 *
 * וההבדל בין השניים אינו סמנטי. דירה ריקה אפשר להראות בכל שעה;
 * דירה שהבעלים גר בה דורשת תיאום; דירה מושכרת דורשת תיאום עם מי
 * שאינו צד לעסקה ואין לו שום אינטרס לשתף פעולה. שלושה מצבים, שלוש
 * דרכי עבודה שונות לגמרי.
 *
 * ## ‎**למה `null` הוא ערך ולא באג**
 *
 * כל הנכסים שכבר במערכת מקבלים `null`, ובמכוון: נכס בלי שוכר רשום
 * **אינו** „הבעלים גר בו”. מיגרציה שהייתה מנחשת ערך התחלתי הייתה
 * ממציאה בדיוק את העובדה שהשדה הזה נועד להפסיק להמציא.
 *
 * ## ‎**המספר שנופל מכאן — והסיבה שזה לא עוד שדה טופס**
 *
 * לחוזה שכירות יש תום, ולהודעה על אי-חידוש יש מועד אחרון. מתווך
 * שמוכר דירה מושכרת נשאל „מתי אפשר להיכנס”, וכשהמועד להודיע כבר
 * חלף — החוזה מתחדש, והתשובה שהוא נתן הופכת לשגויה בשנה. `leaseNotice`
 * מחשב את המועד הזה, בדיוק כמו „מועד השליש” בבלעדיות: תאריך שנגזר
 * ממסמך ולא מהזיכרון.
 */

export const OCCUPANCY_STATES = ["owner", "vacant", "rented"] as const;

export type OccupancyState = (typeof OCCUPANCY_STATES)[number];

/** התווית במסך. */
export const OCCUPANCY_LABEL: Record<OccupancyState, string> = {
  owner: "הבעלים גר בנכס",
  vacant: "אין דייר",
  rented: "מושכר",
};

/**
 * מה זה אומר על **תיאום ביקור** — וזו הסיבה שהמתווך בוחר.
 *
 * לא תיאור של המצב אלא של העבודה שנגזרת ממנו. „אין דייר” בלי
 * המשפט שאחריו הוא עובדה; איתו הוא הוראה.
 */
export const OCCUPANCY_MEANING: Record<OccupancyState, string> = {
  owner: "ביקור בתיאום עם הבעלים",
  vacant: "אפשר להראות בכל שעה",
  rented: "הביקור מתואם עם השוכר, והוא אינו צד לעסקה",
};

/** האם המצב הזה מחייב שיהיה שוכר רשום. */
export function requiresTenant(state: OccupancyState): boolean {
  return state === "rented";
}

/**
 * ‎**סתירה בין המצב שנבחר לבין מי שרשום — הודעה או `null`.**
 *
 * „הבעלים גר בנכס” בזמן ששוכר רשום בכרטיס אינו מצב אפשרי, ושמירה
 * שקטה של שניהם משאירה טלפון של אדם בכרטיס שמצהיר שאין שם אדם.
 * ההודעה נוקבת בפעולה ולא רק בבעיה: המסך אינו מוחק את השוכר מעצמו,
 * כי מחיקה שקטה של איש קשר היא בדיוק מה שאסור לקרות באגב.
 */
export function occupancyConflict(
  state: OccupancyState,
  hasTenant: boolean,
): string | null {
  if (requiresTenant(state)) {
    return hasTenant ? null : "כדי לסמן „מושכר” יש להוסיף את פרטי השוכר.";
  }
  return hasTenant
    ? `בכרטיס רשום שוכר. לפני סימון „${OCCUPANCY_LABEL[state]}” יש לסמן „הדירה התפנתה”.`
    : null;
}

/** תקרה על תקופת ההודעה — חצי שנה. מעבר לזה זו טעות הקלדה. */
export const MAX_NOTICE_PERIOD_DAYS = 180;

export function noticePeriodRejectionReason(days: number): string | null {
  if (!Number.isInteger(days) || days < 0) return "תקופת ההודעה היא מספר ימים.";
  if (days > MAX_NOTICE_PERIOD_DAYS) {
    return `תקופת הודעה ארוכה מ-${MAX_NOTICE_PERIOD_DAYS} ימים אינה סבירה — בדקו את החוזה.`;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * כמה ימים לפני שהמועד להודיע נסגר — מתחת לזה מוצגת אזהרה.
 *
 * שלושים יום, ולא „שבוע”: מי שגילה שבוע לפני המועד עדיין צריך
 * להשיג את הבעלים, לנסח, ולשלוח בדואר רשום.
 */
export const NOTICE_WARNING_DAYS = 30;

export type NoticeState = "passed" | "soon" | "ok";

export interface LeaseNotice {
  /** התאריך האחרון להודיע לשוכר, כתווית ישראלית `YYYY-MM-DD`. */
  notifyBy: string;
  /** ימים שנותרו עד אותו מועד. שלילי = חלף. */
  daysLeft: number;
  state: NoticeState;
  /** משפט אחד למסך — מה זה אומר, לא מה זה. */
  message: string;
}

/**
 * ‎**המועד האחרון להודיע לשוכר שהחוזה אינו מתחדש.**
 *
 * ‎`notifyBy = תום החוזה − תקופת ההודעה`. אחרי המועד הזה החוזה
 * מתחדש בפועל, והתשובה „הדירה תתפנה ביוני” הופכת לשגויה בשנה שלמה
 * — מול קונה שכבר מכר את הדירה שלו.
 *
 * ‎**החישוב בחצות ישראלית ולא ב-UTC**, מאותה סיבה שכל תאריך אחר
 * במערכת הזו: בין חצות לשלוש לפנות בוקר `Date` גולמי מציין את
 * אתמול, ומועד שסופרים בו ימים אינו סובל סטייה של יום.
 *
 * מחזיר `null` כשאין תום חוזה — לא הכול ידוע, וזו תשובה לגיטימית.
 */
export function leaseNotice(
  leaseEndsAt: Date | null | undefined,
  noticePeriodDays: number | null | undefined,
  now: Date,
): LeaseNotice | null {
  if (!leaseEndsAt || Number.isNaN(leaseEndsAt.getTime())) return null;
  const days = noticePeriodDays ?? 0;
  if (!Number.isInteger(days) || days < 0) return null;

  const notifyAt = new Date(leaseEndsAt.getTime() - days * DAY_MS);
  const notifyBy = jerusalemWallParts(notifyAt).date;
  /*
   * ההפרש נמדד בין **תחילות ימים ישראליות**, ולא בין רגעים. אחרת
   * „נותרו 0 ימים” היה תלוי בשעה שבה המסך נטען: אותו יום מציג 1
   * בבוקר ו-0 בערב, על נתון שלא השתנה.
   */
  const daysLeft = Math.round(
    (jerusalemDayStart(notifyAt).getTime() - jerusalemDayStart(now).getTime()) / DAY_MS,
  );

  const state: NoticeState = daysLeft < 0 ? "passed" : daysLeft <= NOTICE_WARNING_DAYS ? "soon" : "ok";
  return {
    notifyBy,
    daysLeft,
    state,
    message:
      state === "passed"
        ? "המועד להודיע על אי-חידוש חלף — בררו מול הבעלים אם החוזה התחדש לפני שמבטיחים מועד כניסה."
        : state === "soon"
          ? `נותרו ${daysLeft} ימים להודיע לשוכר על אי-חידוש.`
          : "יש עוד זמן להודיע לשוכר על אי-חידוש.",
  };
}
