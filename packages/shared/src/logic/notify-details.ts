/**
 * ‎**מי ומה עומדים מאחורי ההתראה** — הפרטים שההודעה בוואטסאפ נושאת.
 *
 * ## הבעיה שזה פותר
 *
 * ‏„הקונה פתח את ההצעה ששלחת” הוא משפט שאי אפשר לפעול לפיו: איזה
 * קונה, איזו הצעה, ומה הטלפון שלו. עד כה כל התראה הסתיימה בקישור
 * למסך — כלומר הסוכן שקיבל אותה **חייב היה להיכנס למערכת** רק כדי
 * לדעת על מי מדובר. זה הפוך מהרעיון של הסוכן בוואטסאפ, שנבנה כדי
 * שאפשר יהיה לעבוד בלי להיכנס.
 *
 * ## למה כאן ולא בעובד
 *
 * העובד יודע לטעון שורות ולפענח PII; מה **מותר להראות ולמי**, ואיך
 * זה נקרא, הן החלטות שנבדקות בלי מסד ובלי Meta. שער הרשאה שנכתב
 * בתוך לולאת שליחה הוא שער שאיש לא בודק עד שהוא נפרץ.
 *
 * ## הכלל שהמודול הזה שומר
 *
 * ‏**התראה משרדית אינה מוסיפה פרטים שהנמען אינו רשאי לראות במערכת.**
 * סוכן עם `buyers.view_own` רואה בדשבורד רק את הקונים שלו; הודעת
 * וואטסאפ שהייתה נושאת את השם והטלפון של קונה של עמית עוקפת את
 * ההרשאה בערוץ צדדי. במקרה כזה נשארת הכותרת בלבד — בדיוק מה שהיה
 * עד היום, ולא פחות ממנו.
 */

import { formatIsraeliNumber, formatJerusalemDate, formatJerusalemTime } from "./israel-time.js";
import { LEAD_SOURCE_LABELS } from "../schemas/lead.js";
import { labelOf } from "../schemas/labels.js";

/* ==================== העובדות ==================== */

/** אדם בהתראה — שם וטלפון, אחרי פענוח. */
export interface NotifyPerson {
  name: string;
  /** ‎`null` = הכרטיס בלי טלפון. שדה חסר נאמר, ולא מוצג כשורה ריקה. */
  phone: string | null;
}

/** אדם יחד עם הסוכן שהכרטיס שלו — הבסיס לסינון פר-נמען. */
export interface OwnedPerson {
  person: NotifyPerson;
  ownerUserId: string | null;
}

interface DetailBase {
  /**
   * הסוכן שהכרטיס שייך לו. ‎`null` = בלי בעלים — ומה זה אומר
   * **תלוי בסוג**, ולא אותו דבר בכולם:
   *
   * - **ליד** בלי סוכן משויך הוא הערימה המשותפת, וכל מי שיש לו
   *   `leads.view_own` רואה אותו (`leadIsVisible` ב-API).
   * - **קונה** בלי בעלים אינו „של כולם” אלא **בלתי נראה**:
   *   `ownershipFilter` משווה מזהה, ו-NULL אינו שווה לאיש.
   *
   * שני הכללים חיים ב-`canSeeNotifyDetail` בנפרד, ובכוונה — הם
   * לא אותו כלל, וטיפול אחיד בהם היה פותח את אחד מהם.
   */
  ownerUserId: string | null;
}

export interface LeadDetail extends DetailBase {
  kind: "lead";
  person: NotifyPerson | null;
  source: string | null;
  summary: string | null;
  property: string | null;
}

export interface BuyerDetail extends DetailBase {
  kind: "buyer";
  person: NotifyPerson | null;
  budget: string | null;
  cities: readonly string[];
  rooms: string | null;
}

export interface PropertyDetail extends DetailBase {
  kind: "property";
  headline: string;
  price: string | null;
  /**
   * הקונים שההתאמה מצאה — עד שלושה, החזקים ראשונים.
   *
   * ‎**כל אחד עם הבעלים שלו**, ולא רשימת שמות שטוחה: `properties.view`
   * מתיר לראות את הנכס, לא את זהות הקונים שהותאמו לו. המסך עצמו
   * מסנן אותם ב-`ownershipFilter("buyers.view_all", "ownerUserId")`
   * לפני שהוא מחזיר שם, וההתראה חייבת לעשות בדיוק אותו דבר —
   * אחרת היא הערוץ שבו סוכן מקבל את הטלפון של הקונה של עמיתו.
   */
  people: readonly OwnedPerson[];
  /** נימוק ההתאמה כפי שהמנוע ניסח אותו. */
  why: string | null;
}

export interface OfferDetail extends DetailBase {
  kind: "offer";
  person: NotifyPerson | null;
  property: string | null;
  price: string | null;
  openCount: number | null;
  why: string | null;
}

export interface TaskDetail extends DetailBase {
  kind: "task";
  title: string;
  dueAt: Date | null;
  about: string | null;
}

export interface AppointmentDetail extends DetailBase {
  kind: "appointment";
  kindLabel: string;
  startsAt: Date;
  property: string | null;
  person: NotifyPerson | null;
}

export interface ContactDetail extends DetailBase {
  kind: "contact";
  person: NotifyPerson;
}

export type NotifyDetail =
  | LeadDetail
  | BuyerDetail
  | PropertyDetail
  | OfferDetail
  | TaskDetail
  | AppointmentDetail
  | ContactDetail;

/* ==================== שער ההרשאה ==================== */

export interface DetailViewer {
  userId: string;
  capabilities: readonly string[];
}

/**
 * ‎**בעלות בלבד אינה הרשאה** — היא רק חצי ממנה.
 *
 * ‏`view_own` ניתנת לשלילה פר-משתמש (`UserCapability` עם
 * ‎`effect: "deny"`), וגם נופלת עם חסימת מודול לכל המשרד. הזכאות
 * לוואטסאפ אינה תלויה בשתיהן — כלומר סוכן שהגישה שלו ללידים
 * נשללה במפורש היה ממשיך לקבל שמות וטלפונים בהודעה, בזמן
 * שהמסך מציג לו „אין הרשאה”. הכלל כאן הוא אותו כלל של הנתיבים:
 * ‎`view_all`, או `view_own` **וגם** בעלות.
 */
function ownedWith(
  detail: DetailBase,
  viewer: DetailViewer,
  viewAll: string,
  viewOwn: string,
  /** האם „בלי בעלים” פירושו הערימה המשותפת (ליד) או בלתי נראה (קונה). */
  nullIsShared: boolean,
): boolean {
  if (viewer.capabilities.includes(viewAll)) return true;
  if (!viewer.capabilities.includes(viewOwn)) return false;
  return detail.ownerUserId === null ? nullIsShared : detail.ownerUserId === viewer.userId;
}

/**
 * האם מותר לצרף את הפרטים האלה להודעה של הנמען הזה.
 *
 * הכללים הם אותם כללים של המסכים, ובכוונה: מה שסוכן אינו רואה
 * ברשימה אינו אמור להגיע אליו בהתראה.
 */
export function canSeeNotifyDetail(detail: NotifyDetail, viewer: DetailViewer): boolean {
  const has = (capability: string): boolean => viewer.capabilities.includes(capability);
  switch (detail.kind) {
    case "lead":
      // ליד בלי סוכן משויך הוא הערימה המשותפת — ראו `leadIsVisible`
      return ownedWith(detail, viewer, "leads.view_all", "leads.view_own", true);
    case "buyer":
    case "offer":
      /*
       * הצעה היא תמיד על קונה ולכן נשענת על אותה הרשאה. וקונה בלי
       * בעלים אינו „של כולם” אלא בלתי נראה — `false` ולא `true`.
       */
      return ownedWith(detail, viewer, "buyers.view_all", "buyers.view_own", false);
    case "property":
      /*
       * ‎`properties.view` מתיר את **הנכס** — הכתובת, המחיר, הנימוק.
       * זהות הקונים שהותאמו לו נשענת על הרשאת הקונים, ומסוננת
       * אחד-אחד ב-`notifyDetailLines`.
       */
      return has("properties.view");
    case "task":
    case "appointment":
      /*
       * ‎`tasks.view_own` אינה קיימת: משימה מוטלת על סוכן, ומי
       * שהיא שלו רואה אותה בהגדרה. פגישה בלי בעלים היא פגישה
       * משרדית, והיא נשארת למי שרואה את המשרד כולו — פרטי לקוח
       * הם לא המקום להיות נדיבים בו.
       */
      return has("tasks.view_all") || detail.ownerUserId === viewer.userId;
    case "contact":
      /*
       * איש קשר בלי הקשר של ליד או קונה — הטלפון שלו הוא כל התוכן.
       * רק מי שרואה את המשרד כולו מקבל אותו; לסוכן `view_own` אין
       * דרך לדעת אם הכרטיס הזה שלו, ולכן ברירת המחדל היא לא.
       */
      return has("leads.view_all") || has("buyers.view_all");
  }
}

/** אותה הרשאה בדיוק, על קונה בודד בתוך רשימת ההתאמות של נכס. */
function canSeeBuyer(owned: OwnedPerson, viewer: DetailViewer): boolean {
  return ownedWith(
    { ownerUserId: owned.ownerUserId },
    viewer,
    "buyers.view_all",
    "buyers.view_own",
    false,
  );
}

/* ==================== הניסוח ==================== */

/** אגורות לשקלים מנוקדים — "1,900,000" ולא "190000000". */
export function shekelLabel(agorot: number): string {
  return `${formatIsraeliNumber(Math.round(agorot / 100))} ₪`;
}

const APPOINTMENT_KIND_LABEL: Record<string, string> = {
  viewing: "סיור",
  meeting: "פגישה",
  call: "שיחה",
};

export function appointmentKindLabel(kind: string): string {
  return APPOINTMENT_KIND_LABEL[kind] ?? "פגישה";
}

/** שורת אדם — "👤 דני כהן · 050-1234567". טלפון חסר אינו נקודה ריקה. */
function personLine(person: NotifyPerson): string {
  return person.phone === null ? `👤 ${person.name}` : `👤 ${person.name} · ${person.phone}`;
}

/**
 * ‎**המסר עצמו לא נחתך** — רק ההסבר.
 *
 * נימוק התאמה יכול להגיע באורך של פסקה. בהודעה שכבר נושאת כמה
 * פריטים הוא בולע את השאר, ולכן הוא נקטע — אבל השם והטלפון,
 * שהם כל מה שהסוכן צריך כדי לפעול, לעולם לא.
 */
function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const WHY_MAX = 120;
const SUMMARY_MAX = 140;

/**
 * שורות הפרטים של פריט אחד, מוכנות להדבקה מתחת לכותרת.
 *
 * מחזירה רשימה ריקה כשאין מה לומר — פריט בלי פרטים אינו מקבל
 * שורה ריקה או „לא ידוע”, אלא נשאר כפי שהיה.
 *
 * ‎`viewer` נדרש כאן ולא רק ב-`canSeeNotifyDetail`, כי פריט אחד
 * יכול לשאת **כמה כרטיסים בבעלויות שונות**: התאמות של נכס הן
 * קונים של סוכנים שונים, ואישור הפריט כולו מכוח `properties.view`
 * היה מוסר את זהותם לכל מי שרשאי לראות נכס.
 */
export function notifyDetailLines(detail: NotifyDetail, viewer: DetailViewer): string[] {
  const lines: string[] = [];
  switch (detail.kind) {
    case "lead": {
      if (detail.person) lines.push(personLine(detail.person));
      if (detail.property !== null) lines.push(`🏠 ${detail.property}`);
      /*
       * ‏התווית מהקטלוג של הסכימה ולא מטבלה מקומית: מקור שנוסף
       * לסכימה היה מופיע כאן כמזהה גולמי — „web_form” במקום „אתר”.
       */
      const source = labelOf(LEAD_SOURCE_LABELS, detail.source);
      if (source !== undefined) lines.push(`📥 מקור: ${source}`);
      if (detail.summary !== null && detail.summary !== "") {
        lines.push(`📝 ${clamp(detail.summary, SUMMARY_MAX)}`);
      }
      return lines;
    }
    case "buyer": {
      if (detail.person) lines.push(personLine(detail.person));
      const wants = [detail.rooms, detail.cities.join(", ")].filter(
        (part): part is string => part !== null && part !== "",
      );
      if (wants.length > 0) lines.push(`🔎 ${wants.join(" · ")}`);
      if (detail.budget !== null) lines.push(`💰 ${detail.budget}`);
      return lines;
    }
    case "property": {
      lines.push(`🏠 ${detail.headline}`);
      if (detail.price !== null) lines.push(`💰 ${detail.price}`);
      /*
       * ‎**הנכס אינו מכשיר את הקונים שלו.** הכתובת והמחיר גלויים
       * לכל מי שרשאי לראות נכסים; שם וטלפון של קונה שהותאם אליו
       * הם כרטיס של סוכן, ונבדקים אחד-אחד — בדיוק כפי שהמסך
       * מסנן אותם לפני שהוא מציג את ההתאמות.
       */
      for (const owned of detail.people) {
        if (canSeeBuyer(owned, viewer)) lines.push(personLine(owned.person));
      }
      if (detail.why !== null && detail.why !== "") lines.push(`✨ ${clamp(detail.why, WHY_MAX)}`);
      return lines;
    }
    case "offer": {
      if (detail.person) lines.push(personLine(detail.person));
      if (detail.property !== null) lines.push(`🏠 ${detail.property}`);
      if (detail.price !== null) lines.push(`💰 ${detail.price}`);
      /*
       * ‎„פתח פעם אחת” אינו מידע — זו בדיוק ההתראה שהוא קרא. מספר
       * הפתיחות נאמר רק כשהוא כבר סיפור: מי שחוזר לדף שלוש פעמים
       * מתלבט, וזה הרגע להתקשר.
       */
      if (detail.openCount !== null && detail.openCount >= 2) {
        lines.push(`🔁 פתח ${detail.openCount} פעמים`);
      }
      if (detail.why !== null && detail.why !== "") lines.push(`✨ ${clamp(detail.why, WHY_MAX)}`);
      return lines;
    }
    case "task": {
      lines.push(`✅ ${detail.title}`);
      if (detail.dueAt !== null) {
        lines.push(
          `🕓 ליום ${formatJerusalemDate(detail.dueAt)} בשעה ${formatJerusalemTime(detail.dueAt)}`,
        );
      }
      if (detail.about !== null) lines.push(`🔗 ${detail.about}`);
      return lines;
    }
    case "appointment": {
      lines.push(
        `📅 ${detail.kindLabel} · ${formatJerusalemDate(detail.startsAt)} בשעה ${formatJerusalemTime(detail.startsAt)}`,
      );
      if (detail.person) lines.push(personLine(detail.person));
      if (detail.property !== null) lines.push(`🏠 ${detail.property}`);
      return lines;
    }
    case "contact":
      return [personLine(detail.person)];
  }
}
