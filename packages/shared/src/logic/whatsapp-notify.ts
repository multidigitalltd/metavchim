/**
 * דחיפת התראות לוואטסאפ — ההחלטות, בלי הרשת.
 *
 * ## למה זה קיים
 *
 * הסוכן בוואטסאפ נבנה כדי שמתווך יוכל לנהל את העבודה **בלי להיכנס
 * למערכת**. כל עוד הוא רק עונה, מי שאינו פותח את הדשבורד פשוט לא
 * יודע ששיחה לא נענתה, שנכנס ליד או שתמלול הסתיים — ובדיוק בשביל
 * זה הוא נכנס לדשבורד. הדחיפה היא מה שסוגר את המעגל.
 *
 * ## למה כאן ולא ב-Worker
 *
 * הסורק רץ בתהליך העובדים, אבל ההחלטות — מה נשלח, למי, מתי לא
 * להעיר, ואיך זה נראה — הן לוגיקה שאפשר וצריך לבדוק בלי Redis,
 * בלי מסד ובלי Meta. טעות כאן שקטה: התראה שלא נשלחה אינה מתלוננת.
 */

import { notificationUrl, type PushableNotification } from "./web-push.js";

/* ==================== קטגוריות ==================== */

/**
 * קיבוץ סוגי ההתראות לקטגוריות שהמתווך מכיר.
 *
 * המתווך אינו אמור להכיר שנים-עשר קודי התראה כדי לכבות רעש. הוא
 * חושב במונחים של „שיחות” ו„לידים”, וזו גם היחידה שבה הוא מכבה.
 */
export type WhatsAppNotifyCategory =
  | "calls"
  | "leads"
  | "tasks"
  | "matches"
  | "network"
  | "digests"
  | "system";

export const NOTIFY_CATEGORY_LABELS: Record<WhatsAppNotifyCategory, string> = {
  calls: "שיחות ותמלולים",
  leads: "לידים",
  tasks: "משימות, פגישות ותזכורות",
  matches: "התאמות, קונים ונכסים",
  network: "רשת השיתופים והתשלומים",
  digests: "סיכומים יומיים ושבועיים",
  system: "הודעות מערכת",
};

/** סוג ההתראה → הקטגוריה שלו. סוג שאינו כאן נחשב הודעת מערכת. */
const TYPE_CATEGORY: Record<string, WhatsAppNotifyCategory> = {
  incoming_call: "calls",
  call_missed: "calls",
  call_transcribed: "calls",
  call_follow_up: "calls",
  call_transcribe_failed: "calls",

  lead: "leads",
  lead_sla: "leads",
  lead_stale: "leads",
  lead_repeat_inquiry: "leads",
  lead_returned: "leads",

  task: "tasks",
  task_reminder: "tasks",
  appointment_reminder: "tasks",
  viewing_followup: "tasks",
  offer_followup: "tasks",
  custom_automation: "tasks",

  buyer: "matches",
  property: "matches",
  property_delisted: "matches",
  matches_refreshed: "matches",
  match_weights_calibrated: "matches",

  coop_deal: "network",
  coop_offer: "network",
  coop_offer_declined: "network",
  payout_decision: "network",

  daily_brief: "digests",
  weekly_summary: "digests",
};

export function notifyCategory(type: string): WhatsAppNotifyCategory {
  return TYPE_CATEGORY[type] ?? "system";
}

/* ==================== העדפות המשתמש ==================== */

export interface WhatsAppNotifyPrefs {
  /** המתג הראשי. כבוי = הסוכן עונה, אבל אינו יוזם. */
  enabled: boolean;
  /** כיבוי לפי קטגוריה — מה שלא נכתב נחשב דלוק. */
  categories: Partial<Record<WhatsAppNotifyCategory, boolean>>;
  /** שעת התחלת השקט (כולל) — שעון ישראל */
  quietFromHour: number;
  /** שעת סיום השקט (לא כולל) — שעון ישראל */
  quietToHour: number;
}

/**
 * ברירת המחדל: **כבוי**.
 *
 * הודעת וואטסאפ יזומה היא צלצול בטלפון הפרטי. משרד שמפעיל את הסוכן
 * לסוכניו אינו מבקש בכך להעיר אותם, ולכן ההפעלה היא בחירה של מי
 * שמקבל את ההודעות. השעות השקטות קיימות מהרגע הראשון מאותה סיבה.
 */
export const DEFAULT_WHATSAPP_NOTIFY_PREFS: WhatsAppNotifyPrefs = {
  enabled: false,
  categories: {},
  quietFromHour: 22,
  quietToHour: 7,
};

/** המפתח שתחתיו ההעדפות יושבות ב-`users.preferences`. */
export const WHATSAPP_NOTIFY_PREF_KEY = "whatsappNotify";

function boolAt(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function hourAt(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return value >= 0 && value <= 23 ? value : fallback;
}

/**
 * קריאת ההעדפות מתוך `preferences` של המשתמש.
 *
 * סלחני בכוונה: ה-JSON נכתב ע"י המסך ויכול להכיל כל דבר, והתנהגות
 * ברירת המחדל היא הדבר הבטוח. שדה פגום אינו מפיל את הסורק כולו.
 */
export function parseWhatsAppNotifyPrefs(raw: unknown): WhatsAppNotifyPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_WHATSAPP_NOTIFY_PREFS;
  const source = (raw as Record<string, unknown>)[WHATSAPP_NOTIFY_PREF_KEY] ?? raw;
  if (typeof source !== "object" || source === null) return DEFAULT_WHATSAPP_NOTIFY_PREFS;
  const record = source as Record<string, unknown>;

  const categories: Partial<Record<WhatsAppNotifyCategory, boolean>> = {};
  const rawCategories = record["categories"];
  if (typeof rawCategories === "object" && rawCategories !== null) {
    for (const [key, value] of Object.entries(rawCategories as Record<string, unknown>)) {
      if (key in NOTIFY_CATEGORY_LABELS && typeof value === "boolean") {
        categories[key as WhatsAppNotifyCategory] = value;
      }
    }
  }

  return {
    enabled: boolAt(record, "enabled") ?? DEFAULT_WHATSAPP_NOTIFY_PREFS.enabled,
    categories,
    quietFromHour: hourAt(record, "quietFromHour", DEFAULT_WHATSAPP_NOTIFY_PREFS.quietFromHour),
    quietToHour: hourAt(record, "quietToHour", DEFAULT_WHATSAPP_NOTIFY_PREFS.quietToHour),
  };
}

export function shouldNotifyByWhatsApp(type: string, prefs: WhatsAppNotifyPrefs): boolean {
  if (!prefs.enabled) return false;
  // קטגוריה שלא נכתבה = דלוקה: מי שהדליק את המתג רוצה הכול, אלא אם כיבה
  return prefs.categories[notifyCategory(type)] !== false;
}

/**
 * האם השעה נופלת בטווח השקט. הטווח עובר חצות ברוב המקרים
 * (22:00–07:00), ולכן ההשוואה מפוצלת. from === to פירושו „אין שקט”.
 */
export function inQuietHours(hour: number, prefs: WhatsAppNotifyPrefs): boolean {
  const { quietFromHour: from, quietToHour: to } = prefs;
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/* ==================== ניסוח ההודעה ==================== */

export interface NotifyItem extends PushableNotification {
  createdAt?: Date;
}

/** אייקון לפי קטגוריה — סריקה מהירה של הודעה עם כמה פריטים. */
const CATEGORY_ICON: Record<WhatsAppNotifyCategory, string> = {
  calls: "📞",
  leads: "🔥",
  tasks: "⏰",
  matches: "🎯",
  network: "🤝",
  digests: "📊",
  system: "ℹ️",
};

/** כמה פריטים נכנסים להודעה אחת לפני „ועוד N”. */
export const NOTIFY_ITEMS_PER_MESSAGE = 6;

/**
 * הודעה אחת לכל מה שהצטבר, ולא הודעה לכל התראה.
 *
 * מתווך שהיה בפגישה חוזר לשבע התראות; שבע הודעות וואטסאפ ברצף הן
 * מטרד, ובמקרה הגרוע דירוג איכות נמוך למספר אצל Meta. ההודעה
 * מקבצת, ומצרפת קישור אחד לכל פריט — כי הפעולה עצמה נעשית במסך.
 */
export function formatNotifyMessage(items: readonly NotifyItem[], webOrigin: string): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, NOTIFY_ITEMS_PER_MESSAGE);
  const lines: string[] = [
    items.length === 1 ? "*עדכון מהמערכת*" : `*${items.length} עדכונים מהמערכת*`,
    "",
  ];

  for (const item of shown) {
    const icon = CATEGORY_ICON[notifyCategory(item.type)];
    lines.push(`${icon} *${item.title}*`);
    if (item.body !== null && item.body !== "") lines.push(item.body);
    const url = notificationUrl(item);
    // "/" הוא הדשבורד — קישור כללי אינו מוסיף דבר להתראה
    if (url !== "/") lines.push(`${webOrigin}${url}`);
    lines.push("");
  }

  if (items.length > shown.length) {
    lines.push(`ועוד ${items.length - shown.length} עדכונים במערכת.`);
    lines.push("");
  }
  lines.push("אפשר לענות לי כאן כדי לטפל בזה — או לכתוב *עזרה*.");
  return lines.join("\n").trim();
}

/* ==================== חלון 24 השעות של Meta ==================== */

/**
 * מדיניות WhatsApp: הודעה חופשית מותרת רק בתוך 24 שעות מההודעה
 * האחרונה של הלקוח. מחוצה לו נדרשת תבנית מאושרת מראש.
 *
 * זו אינה מגבלה שאפשר לעקוף — Meta פשוט דוחה את השליחה — ולכן
 * הסורק בודק אותה לפני ששולח, ולא לומד עליה מהשגיאה.
 */
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sessionWindowOpen(
  lastInboundAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_SESSION_WINDOW_MS;
}

/**
 * הפרמטרים לתבנית ההתראה: כותרת קצרה וגוף קצר.
 *
 * תבנית של Meta אינה מקבלת שורות חדשות בפרמטר, ולכן הטקסט משוטח.
 * שני פרמטרים ולא אחד — כך הוא נראה כמו התראה ולא כמו קיר טקסט.
 */
export function templateParams(items: readonly NotifyItem[]): [string, string] {
  const first = items[0];
  const headline =
    items.length === 1 && first ? first.title : `${items.length} עדכונים חדשים`;
  const detail =
    items.length === 1 && first
      ? (first.body ?? "פרטים מלאים במערכת")
      : items
          .slice(0, 3)
          .map((item) => item.title)
          .join(" · ");
  return [flatten(headline, 120), flatten(detail, 300)];
}

/** תבנית של Meta דוחה שורות חדשות, טאבים ורצף רווחים כפולים. */
function flatten(text: string, max: number): string {
  const cleaned = text.replace(/\s+/gu, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned || "עדכון";
}
