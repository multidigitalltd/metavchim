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
import type { WhatsAppButton } from "./whatsapp-buttons.js";

/* ==================== קטגוריות ==================== */

/**
 * קיבוץ סוגי ההתראות לקטגוריות שהמתווך מכיר.
 *
 * המתווך אינו אמור להכיר שנים-עשר קודי התראה כדי לכבות רעש. הוא
 * חושב במונחים של „שיחות” ו„לידים”, וזו גם היחידה שבה הוא מכבה.
 */
export type WhatsAppNotifyCategory =
  "calls" | "leads" | "tasks" | "matches" | "network" | "digests" | "system";

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

  // המנטור האישי — הסיכום השבועי הוא סיכום; החגיגה היא אירוע, אבל
  // על עצמי ולא על לקוח, ולכן באותה קטגוריה שהמשתמש בוחר בה
  mentor_weekly: "digests",
  mentor_win: "digests",
  mentor_nudge: "digests",
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
 * ברירת המחדל: **הכול פעיל** (בקשת בעל הפלטפורמה).
 *
 * מי ששילם על סוכן אישי בוואטסאפ קנה בדיוק את זה — שהעבודה תגיע
 * אליו. ברירת מחדל כבויה הייתה הופכת את הפיצ'ר למשהו שצריך לגלות
 * ולהדליק, כלומר לפיצ'ר שרובם לא יקבלו. הכיבוי נשאר זמין לכל
 * קטגוריה בנפרד, והשעות השקטות פעילות מהרגע הראשון כדי שההפעלה
 * המלאה לא תעיר איש באמצע הלילה.
 */
export const DEFAULT_WHATSAPP_NOTIFY_PREFS: WhatsAppNotifyPrefs = {
  enabled: true,
  categories: {},
  quietFromHour: 22,
  quietToHour: 7,
};

/**
 * טווח השקט המרבי. טווח ארוך יותר פירושו „כמעט אף פעם”, והוא גם
 * חורג מחלון השמירה של הסורק — כלומר התראה שנדחתה בתחילתו הייתה
 * מתיישנת לפני סופו ולא נשלחת לעולם (ביקורת Codex).
 */
export const MAX_QUIET_SPAN_HOURS = 18;

function quietSpan(from: number, to: number): number {
  return from === to ? 0 : from < to ? to - from : 24 - from + to;
}

/** המפתח שתחתיו ההעדפות יושבות ב-`users.preferences`. */
export const WHATSAPP_NOTIFY_PREF_KEY = "whatsappNotify";

function boolAt(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function hourAt(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
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
  if (typeof raw !== "object" || raw === null)
    return DEFAULT_WHATSAPP_NOTIFY_PREFS;
  const source =
    (raw as Record<string, unknown>)[WHATSAPP_NOTIFY_PREF_KEY] ?? raw;
  if (typeof source !== "object" || source === null)
    return DEFAULT_WHATSAPP_NOTIFY_PREFS;
  const record = source as Record<string, unknown>;

  const categories: Partial<Record<WhatsAppNotifyCategory, boolean>> = {};
  const rawCategories = record["categories"];
  if (typeof rawCategories === "object" && rawCategories !== null) {
    for (const [key, value] of Object.entries(
      rawCategories as Record<string, unknown>,
    )) {
      if (key in NOTIFY_CATEGORY_LABELS && typeof value === "boolean") {
        categories[key as WhatsAppNotifyCategory] = value;
      }
    }
  }

  const quietFromHour = hourAt(
    record,
    "quietFromHour",
    DEFAULT_WHATSAPP_NOTIFY_PREFS.quietFromHour,
  );
  const quietToHour = hourAt(
    record,
    "quietToHour",
    DEFAULT_WHATSAPP_NOTIFY_PREFS.quietToHour,
  );
  // טווח חורג ⇒ ברירת המחדל, ולא „שקט תמידי” שנראה כמו תקלה
  const withinCap =
    quietSpan(quietFromHour, quietToHour) <= MAX_QUIET_SPAN_HOURS;

  return {
    enabled: boolAt(record, "enabled") ?? DEFAULT_WHATSAPP_NOTIFY_PREFS.enabled,
    categories,
    quietFromHour: withinCap
      ? quietFromHour
      : DEFAULT_WHATSAPP_NOTIFY_PREFS.quietFromHour,
    quietToHour: withinCap
      ? quietToHour
      : DEFAULT_WHATSAPP_NOTIFY_PREFS.quietToHour,
  };
}

export function shouldNotifyByWhatsApp(
  type: string,
  prefs: WhatsAppNotifyPrefs,
): boolean {
  if (!prefs.enabled) return false;
  // קטגוריה שלא נכתבה = דלוקה: מי שהדליק את המתג רוצה הכול, אלא אם כיבה
  return prefs.categories[notifyCategory(type)] !== false;
}

/**
 * האם השעה נופלת בטווח השקט. הטווח עובר חצות ברוב המקרים
 * (22:00–07:00), ולכן ההשוואה מפוצלת. from === to פירושו „אין שקט”.
 */
export function inQuietHours(
  hour: number,
  prefs: WhatsAppNotifyPrefs,
): boolean {
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

/** אייקון מדויק יותר לסוגים שבהם ההבדל הוא ההבדל בין פעולות. */
const TYPE_ICON: Record<string, string> = {
  call_missed: "📵",
  incoming_call: "📞",
  call_transcribed: "🎧",
  call_follow_up: "🎧",
  call_transcribe_failed: "⚠️",
  lead: "🔥",
  lead_sla: "⏳",
  lead_stale: "🥶",
  lead_repeat_inquiry: "🔁",
  task_reminder: "⏰",
  appointment_reminder: "📅",
  viewing_followup: "🚪",
  offer_followup: "📨",
  buyer: "🙋",
  property: "🏠",
  property_delisted: "🚫",
  matches_refreshed: "🎯",
  coop_deal: "🤝",
  coop_offer: "💼",
  payout_decision: "💰",
  credits_expiring: "⌛",
  daily_brief: "☀️",
  weekly_summary: "📊",
  mentor_weekly: "🧭",
  mentor_win: "🎉",
  mentor_nudge: "🎯",
};

/**
 * משפט הפעולה בסוף ההודעה — מה עושים עכשיו.
 *
 * התראה שמסתיימת בלי משפט כזה היא ידיעה; עם משפט כזה היא תזכורת
 * שאפשר לפעול עליה מיד, באותה שיחה. הניסוח נגזר מהקטגוריה השכיחה
 * בהודעה — ולא אחד לכל פריט, שזה כבר הטפה.
 */
const CATEGORY_CALL_TO_ACTION: Record<WhatsAppNotifyCategory, string> = {
  calls: "📲 להחזיר שיחה עכשיו — או לכתוב לי „תזכיר לי להתקשר אליו בעוד שעה”.",
  leads: "⚡ ליד חם מתקרר תוך שעות — כתבו לי „תעדכן סטטוס” או „תקבע לו סיור”.",
  tasks: "✅ לסגור את זה עכשיו? כתבו לי „בוצע” ואעדכן.",
  matches: "🎯 יש התאמה — כתבו לי „תשלח הצעה” ואכין אותה.",
  network: '🤝 שת"פ שמחכה לתשובה — כתבו לי מה להשיב.',
  digests: "🚀 שאלו אותי „מה הכי דחוף היום?” ואתן לכם את הסדר.",
  system: "💬 אפשר לענות לי כאן ואטפל בזה.",
};

/*
 * ==================== המנטור בוואטסאפ — דו-כיווני ====================
 *
 * ההתראות של המנטור אינן „עדכון” על לקוח אלא שיחה עם המתווך עצמו,
 * ולכן הן מקבלות משפט פעולה משלהן וכפתורים משלהן: הסיכום השבועי
 * מבקש מחויבות ותשובה, הדחיפה והחגיגה מזמינות להסתכל על היעדים.
 * הכפתורים נושאים **פקודות שהשיחה כבר מבינה** (`cmd`) — אותו מסלול
 * הבנה⟵אישור כמו משפט שהוקלד, בלי מסלול ביצוע שני (docs/13 §9).
 */

/**
 * מפתח הפקודה על הכפתור ⟵ המשפט שנשלח למנוע כאילו הוקלד.
 *
 * מקור אחד לשני הצדדים: הוורקר שמצמיד את הכפתור והסוכן שמתרגם את
 * הלחיצה. מפתח שאינו כאן אינו כפתור של המנטור.
 */
export const MENTOR_QUICK_COMMANDS = {
  mentor_status: "מה המצב ביעדים שלי?",
  mentor_commit: "מתחייב לשבוע הבא",
  mentor_reflect: "לענות למנטור",
} as const;
export type MentorQuickCommand = keyof typeof MENTOR_QUICK_COMMANDS;

/** הכפתורים על כל התראה שאינה של המנטור — לא השתנו. */
export const NOTIFY_DEFAULT_BUTTONS: readonly WhatsAppButton[] = [
  { action: "cmd", arg: "urgent", title: "📋 מה דחוף היום?" },
  { action: "snooze", arg: "120", title: "🔕 שקט לשעתיים" },
];

const MENTOR_STATUS_BUTTON: WhatsAppButton = {
  action: "cmd",
  arg: "mentor_status",
  title: "🎯 היעדים שלי",
};

/**
 * הכפתורים לפי מה שבהודעה.
 *
 * רק כשההודעה **כולה** של המנטור: אגד שמערבב ליד חם עם סיכום שבועי
 * מקבל את כפתורי ברירת המחדל — „מתחייב” מתחת לליד היה מבלבל.
 */
export function notifyQuickReplies(
  items: readonly NotifyItem[],
): WhatsAppButton[] {
  const types = new Set(items.map((item) => item.type));
  const mentorOnly =
    items.length > 0 && [...types].every((type) => type.startsWith("mentor_"));
  if (!mentorOnly) return [...NOTIFY_DEFAULT_BUTTONS];
  if (types.has("mentor_weekly")) {
    return [
      { action: "cmd", arg: "mentor_commit", title: "💪 מתחייב" },
      { action: "cmd", arg: "mentor_reflect", title: "✍️ לענות למנטור" },
      MENTOR_STATUS_BUTTON,
    ];
  }
  return [MENTOR_STATUS_BUTTON, ...NOTIFY_DEFAULT_BUTTONS];
}

/** משפט הפעולה כשכל הפריטים הם של המנטור — לפי הסוג, לא הקטגוריה. */
const MENTOR_CALL_TO_ACTION: Record<string, string> = {
  mentor_weekly:
    "💪 לחיצה על „מתחייב” לשבוע הבא — או לכתוב לי מה עצר השבוע, ואעביר למנטור.",
  mentor_nudge:
    "🎯 אפשר לכתוב לי „מה המצב ביעדים שלי?” ואראה לך איפה זה עומד מול השבוע.",
  mentor_win:
    "🎉 כל הכבוד לך! אפשר לכתוב לי „מה המצב ביעדים שלי?” לראות איך זה מזיז את השבוע.",
};

function callToAction(shown: readonly NotifyItem[]): string {
  const types = new Set(shown.map((item) => item.type));
  if (types.size === 1) {
    const only = [...types][0];
    const mentor = only === undefined ? undefined : MENTOR_CALL_TO_ACTION[only];
    if (mentor !== undefined) return mentor;
  }
  return CATEGORY_CALL_TO_ACTION[dominantCategory(shown)];
}

function dominantCategory(
  items: readonly NotifyItem[],
): WhatsAppNotifyCategory {
  const counts = new Map<WhatsAppNotifyCategory, number>();
  for (const item of items) {
    const category = notifyCategory(item.type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let best: WhatsAppNotifyCategory = "system";
  let bestCount = 0;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

/** כמה פריטים נכנסים להודעה אחת לפני „ועוד N”. */
export const NOTIFY_ITEMS_PER_MESSAGE = 6;

/**
 * הודעה אחת לכל מה שהצטבר, ולא הודעה לכל התראה.
 *
 * מתווך שהיה בפגישה חוזר לשבע התראות; שבע הודעות וואטסאפ ברצף הן
 * מטרד, ובמקרה הגרוע דירוג איכות נמוך למספר אצל Meta. ההודעה
 * מקבצת, ומצרפת קישור אחד לכל פריט — כי הפעולה עצמה נעשית במסך.
 */
export function formatNotifyMessage(
  items: readonly NotifyItem[],
  webOrigin: string,
): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, NOTIFY_ITEMS_PER_MESSAGE);
  const lines: string[] = [
    items.length === 1
      ? "🔔 *עדכון חדש*"
      : `🔔 *${items.length} עדכונים חדשים*`,
    "",
  ];

  for (const item of shown) {
    // כותרת שכבר פותחת בסמל (החגיגה, הסיכום, הדחיפה) לא מקבלת סמל שני
    const icon = /^[^\p{L}\p{N}]/u.test(item.title)
      ? ""
      : `${TYPE_ICON[item.type] ?? CATEGORY_ICON[notifyCategory(item.type)]} `;
    lines.push(`${icon}*${item.title}*`);
    if (item.body !== null && item.body !== "") lines.push(item.body);
    const url = notificationUrl(item);
    // "/" הוא הדשבורד — קישור כללי אינו מוסיף דבר להתראה
    if (url !== "/") lines.push(`👈 ${webOrigin}${url}`);
    lines.push("");
  }

  if (items.length > shown.length) {
    lines.push(`➕ ועוד ${items.length - shown.length} עדכונים במערכת.`);
    lines.push("");
  }
  lines.push(callToAction(shown));
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
  return cleaned.length > max
    ? `${cleaned.slice(0, max - 1)}…`
    : cleaned || "עדכון";
}
