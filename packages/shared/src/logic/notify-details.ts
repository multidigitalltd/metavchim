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

interface DetailBase {
  /**
   * הסוכן שהכרטיס שייך לו. ‎`null` = כרטיס משרדי (ליד במאגר, נכס),
   * וכזה גלוי לכל מי שרשאי לראות את הסוג הזה בכלל.
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
  /** הקונים שההתאמה מצאה — עד שלושה, החדשים ראשונים. */
  people: readonly NotifyPerson[];
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

function owns(detail: DetailBase, viewer: DetailViewer): boolean {
  // כרטיס בלי בעלים הוא משרדי — במאגר המשותף, ולא של אף אחד
  return detail.ownerUserId === null || detail.ownerUserId === viewer.userId;
}

/**
 * האם מותר לצרף את הפרטים האלה להודעה של הנמען הזה.
 *
 * הכללים הם אותם כללים של המסכים, ובכוונה: מה שסוכן אינו רואה
 * ברשימה אינו אמור להגיע אליו בהתראה. `view_all` היא סימן ההיכר
 * של מי שרואה את כל המשרד; בלעדיה נשארת הבעלות.
 */
export function canSeeNotifyDetail(detail: NotifyDetail, viewer: DetailViewer): boolean {
  const has = (capability: string): boolean => viewer.capabilities.includes(capability);
  switch (detail.kind) {
    case "lead":
      return has("leads.view_all") || owns(detail, viewer);
    case "buyer":
    case "offer":
      // הצעה היא תמיד על קונה, ולכן היא נשענת על אותה הרשאה
      return has("buyers.view_all") || owns(detail, viewer);
    case "property":
      return has("properties.view");
    case "task":
    case "appointment":
      return has("tasks.view_all") || owns(detail, viewer);
    case "contact":
      /*
       * איש קשר בלי הקשר של ליד או קונה — הטלפון שלו הוא כל התוכן.
       * רק מי שרואה את המשרד כולו מקבל אותו; לסוכן `view_own` אין
       * דרך לדעת אם הכרטיס הזה שלו, ולכן ברירת המחדל היא לא.
       */
      return has("leads.view_all") || has("buyers.view_all");
  }
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
 */
export function notifyDetailLines(detail: NotifyDetail): string[] {
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
      for (const person of detail.people) lines.push(personLine(person));
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
