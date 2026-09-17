import type { EmailContent } from "./email-template.js";
import { formatIsraeliNumber } from "./israel-time.js";
import { canReceiveWhatsapp, whatsappLink } from "./whatsapp-link.js";

/**
 * הפורום המקצועי — הליבה המשותפת (docs/16).
 *
 * ## מה יושב כאן ולמה
 *
 * כל מה שנאמר **בשלושה ערוצים** — מסך, פעמון/מייל, וואטסאפ — נכתב
 * פעם אחת: רשימות סגורות (נושאים, סוגי שרשור, קטגוריות בעלי
 * מקצוע), גבולות אורך שהעמודות במסד נגזרות מהם, ניסוחי ההתראות
 * והמיילים, כינויי האנונימיות, וההעדפות של המשתמש. ניסוח שחי בערוץ
 * אחד בלבד הוא ניסוח שהערוץ השני ימציא מחדש (ראו `mentor.ts`).
 *
 * ## האנונימיות — הפיצ'ר, לא תוספת
 *
 * שאלה מקצועית בפורום פתוח נקראת גם בידי הלקוח וגם בידי המתחרה
 * ממול, ולכן השאלות החשובות פשוט לא נשאלות. שרשור או תגובה
 * שסומנו כאנונימיים **אינם נושאים מזהה מחבר כלל** במסד — רק חותם
 * ‎HMAC (`author_key`) שמאפשר למחבר לערוך את שלו, ולמערכת להגביל
 * קצב. הכינוי שרואים בשרשור („השואל/ת”, „אנונימי 2”) מחושב בזמן
 * הקריאה מסדר ההופעה, ואינו נשמר בשום מקום.
 */

/* ==================== רשימות סגורות ==================== */

/** סוג השרשור — מה מבקשים מהקוראים. */
export const FORUM_KINDS = ["question", "discussion", "tip"] as const;
export type ForumKind = (typeof FORUM_KINDS)[number];
export const FORUM_KIND_LABELS: Record<ForumKind, string> = {
  question: "שאלה",
  discussion: "דיון",
  tip: "טיפ מהשטח",
};

/** נושאי הפורום — הרשימה שהמסך מסנן לפיה, וה-Zod אוכף. */
export const FORUM_TOPICS = [
  "legal",
  "pricing",
  "clients",
  "marketing",
  "exclusivity",
  "tax_finance",
  "tech",
  "career",
  "general",
] as const;
export type ForumTopic = (typeof FORUM_TOPICS)[number];
export const FORUM_TOPIC_LABELS: Record<ForumTopic, string> = {
  legal: "חוזים ומשפט",
  pricing: "תמחור ושמאות",
  clients: "לקוחות ומשא ומתן",
  marketing: "שיווק ופרסום",
  exclusivity: "בלעדיות",
  tax_finance: "מיסוי ומימון",
  tech: "כלים וטכנולוגיה",
  career: "קריירה ומשרד",
  general: "כללי",
};

/** קטגוריות המדריך המקצועי — בעלי מקצוע שמתווך עובד איתם. */
export const FORUM_PRO_CATEGORIES = [
  "lawyer",
  "appraiser",
  "mortgage_advisor",
  "photographer",
  "inspector",
  "home_stager",
  "mover",
  "notary",
  "contractor",
  "accountant",
  "other",
] as const;
export type ForumProCategory = (typeof FORUM_PRO_CATEGORIES)[number];
export const FORUM_PRO_CATEGORY_LABELS: Record<ForumProCategory, string> = {
  lawyer: "עורך/ת דין מקרקעין",
  appraiser: "שמאי/ת",
  mortgage_advisor: "יועץ/ת משכנתאות",
  photographer: "צלם/ת נדל\"ן",
  inspector: "בדק בית",
  /*
   * ‎**„אדריכלות ועיצוב פנים” ולא „הום סטיילינג”** (בקשת המשתמש).
   *
   * ‏המפתח `home_stager` נשאר: הוא שמור בשורות קיימות במאגר, ושינוי
   * ‏שלו היה מותיר אותן בקטגוריה שאינה בקטלוג. התווית היא מה שרואים.
   */
  home_stager: "אדריכלות ועיצוב פנים",
  mover: "הובלות",
  notary: "נוטריון",
  contractor: "שיפוצים",
  accountant: "רואה חשבון / מיסוי",
  other: "אחר",
};

/** קטגוריות הכלים שהקהילה משתפת — קישורים, תבניות, אפליקציות. */
export const FORUM_TOOL_CATEGORIES = [
  "calculator",
  "template",
  "site",
  "app",
  "data",
  "other",
] as const;
export type ForumToolCategory = (typeof FORUM_TOOL_CATEGORIES)[number];
export const FORUM_TOOL_CATEGORY_LABELS: Record<ForumToolCategory, string> = {
  calculator: "מחשבון",
  template: "תבנית / מסמך",
  site: "אתר / מאגר מידע",
  app: "אפליקציה",
  data: "נתונים ומחירים",
  other: "אחר",
};

/** שני סוגי הרשומות במדריך — כלי או בעל מקצוע. טבלה אחת, דירוג אחד. */
export const FORUM_LISTING_KINDS = ["tool", "pro"] as const;
export type ForumListingKind = (typeof FORUM_LISTING_KINDS)[number];

/** סיבות דיווח — רשימה סגורה, כי „אחר” חופשי הופך לתיבת תלונות. */
export const FORUM_REPORT_REASONS = [
  "spam",
  "offensive",
  "privacy",
  "misleading",
  "other",
] as const;
export type ForumReportReason = (typeof FORUM_REPORT_REASONS)[number];
export const FORUM_REPORT_REASON_LABELS: Record<ForumReportReason, string> = {
  spam: "פרסום או ספאם",
  offensive: "פוגעני",
  privacy: "חושף פרטים של אדם",
  misleading: "מטעה או שגוי",
  other: "אחר",
};

/* ==================== גבולות — העמודות נגזרות מהם ==================== */

export const FORUM_TITLE_MIN = 8;
export const FORUM_TITLE_MAX = 160;
export const FORUM_BODY_MIN = 20;
export const FORUM_BODY_MAX = 6000;
export const FORUM_REPLY_MIN = 2;
export const FORUM_REPLY_MAX = 6000;
export const FORUM_LISTING_NAME_MAX = 120;
export const FORUM_LISTING_DESCRIPTION_MAX = 1000;
export const FORUM_LISTING_URL_MAX = 500;
export const FORUM_LISTING_AREA_MAX = 80;
export const FORUM_LISTING_CONTACT_MAX = 120;
export const FORUM_RATING_COMMENT_MAX = 500;
export const FORUM_REPORT_NOTE_MAX = 500;
export const FORUM_SEARCH_MAX = 120;
/** כמה שרשורים בעמוד — לרשימה מהירה שנטענת בבת אחת. */
export const FORUM_PAGE_SIZE = 30;

/* ==================== פנייה לבעל מקצוע ==================== */

/**
 * ‎**פתיחת השורה הראשונה — „מי אתה ואיך הגעת אליי”.**
 *
 * ‏בעל המקצוע במדריך אינו מכיר את מי שכותב לו, ומספר לא מוכר
 * ‏בוואטסאפ הוא מספר שלא עונים לו. המשפט הזה עונה על השאלה עוד
 * ‏לפני שהיא נשאלת, והוא גם מה שהופך את המדריך למשהו ששווה
 * ‏להיות רשום בו: בעל המקצוע לומד מאיפה מגיעות הפניות.
 *
 * ‏קבוע אחד ולא טקסט שכל מסך מרכיב — הוא יופיע גם בוואטסאפ של
 * ‏הסוכן וגם בכפתור שבמסך, וניסוח שחי בשני מקומות מתפצל.
 */
export const FORUM_PRO_INTRO = "הי, הגעתי דרך מערכת מתווכים";

/** ספרות וסימני ניקוד של מספר בלבד — ראו `forumProWhatsappLink`. */
const PHONE_ONLY = /^[\d+()\-\u2013\u2014.\s]+$/u;

/**
 * קישור וואטסאפ לבעל מקצוע, או `null` כשאי אפשר.
 *
 * ‎`contact` במדריך הוא שדה חופשי: יש בו טלפון, יש בו מייל, ויש
 * ‏בו „050-1234567 / office@…”. ‏`canReceiveWhatsapp` הוא מה
 * ‏שמכריע — הוא דורש נייד ישראלי מלא אחרי נרמול, ולכן מייל, קו
 * ‏נייח או מחרוזת מעורבת נופלים בו. כפתור שנפתח על מספר שאינו
 * ‏נמען גרוע מכפתור שאינו מוצג: ההודעה „נשלחת” ואיש אינו מקבל
 * ‏אותה (אותו נימוק שכתוב ב-`canReceiveWhatsapp` עצמה).
 */
export function forumProWhatsappLink(contact: string | null | undefined): string | null {
  const value = (contact ?? "").trim();
  /*
   * ‎**קודם „זה בכלל מספר”, ורק אז „זה נייד ישראלי”.**
   *
   * ‏`canReceiveWhatsapp` מסירה כל תו שאינו ספרה, ולכן
   * ‏„050-1234567 / office@example.com” היה עובר אצלה בהצלחה —
   * ‏האותיות נעלמות והספרות נשארות. הכפתור היה נפתח על המספר
   * ‏הנכון במקרה הזה, ועל ספרות מצורפות במקרה הבא. שדה חופשי
   * ‏שיש בו יותר ממספר אינו מספר.
   */
  if (!PHONE_ONLY.test(value) || !canReceiveWhatsapp(value)) return null;
  return whatsappLink(value, FORUM_PRO_INTRO);
}

/* ==================== אנונימיות ==================== */

export const FORUM_ANON_LABEL = "מתווך/ת אנונימי/ת";
export const FORUM_ASKER_LABEL = "השואל/ת";

/**
 * כינוי לכל מחבר בשרשור — **מחושב, לא נשמר.**
 *
 * מחבר השרשור האנונימי הוא תמיד „השואל/ת”, כי הקוראים צריכים לדעת
 * אילו תגובות הן שלו („תודה, ניסיתי וזה עבד”). שאר האנונימיים
 * ממוספרים לפי סדר ההופעה הראשונה, כדי שאפשר יהיה לעקוב אחרי דיון
 * בין שניים בלי לדעת מי הם. מחבר מזוהה מקבל את שמו כפי שהוא.
 *
 * הקלט הוא רשימת מפתחות המחברים לפי סדר הפרסום; הפלט ממפה כל
 * מפתח לכינוי. מפתח שאינו במפה = מחבר מזוהה (או שנמחק).
 */
export function forumPseudonyms(
  threadAuthorKey: string,
  threadAnonymous: boolean,
  posts: readonly { authorKey: string; anonymous: boolean }[],
): Map<string, string> {
  const names = new Map<string, string>();
  if (threadAnonymous) names.set(threadAuthorKey, FORUM_ASKER_LABEL);
  let counter = 0;
  for (const post of posts) {
    if (!post.anonymous || names.has(post.authorKey)) continue;
    counter += 1;
    names.set(post.authorKey, `אנונימי ${counter}`);
  }
  return names;
}

/**
 * „אנונימי: …” בתחילת הודעה בוואטסאפ — תגובה בעילום שם.
 *
 * הסוכן בוואטסאפ מקבל טקסט אחד, ואין בו תיבת סימון. תחילית
 * מפורשת היא הדרך היחידה לומר „בלי השם שלי” בלי סבב שאלה נוסף.
 */
const ANON_PREFIX = /^\s*(?:אנונימי|בעילום\s+שם|אנונימית)\s*[:\-–—]\s*/u;
export function parseAnonymousPrefix(text: string): { anonymous: boolean; text: string } {
  const match = ANON_PREFIX.exec(text);
  if (match === null) return { anonymous: false, text: text.trim() };
  return { anonymous: true, text: text.slice(match[0].length).trim() };
}

/* ==================== קטעים וניסוחים ==================== */

/** קטע פתיחה של גוף — לרשימה, להתראה ולמייל. חותך במילה, לא באמצע. */
export function forumSnippet(body: string, max = 140): string {
  const flat = body.replace(/\s+/gu, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** נתיב השרשור במסך — אותו נתיב לפעמון, לפוש, לוואטסאפ ולמייל. */
export function forumThreadPath(threadId: string): string {
  return `/forum/t/${threadId}`;
}

/**
 * ההתראות של הפורום — `type` בטבלת ההתראות. הקטגוריה בוואטסאפ
 * (`whatsapp-notify.ts`) ונתיב הפוש (`web-push.ts`) נגזרים מהם.
 */
export const FORUM_NOTIFICATION_TYPES = {
  /** תגובה חדשה בשרשור שעוקבים אחריו */
  reply: "forum_reply",
  /** שרשור חדש — למי שעוקב אחרי כל הפורום */
  thread: "forum_thread",
  /** התגובה שלך סומנה כתשובה המקובלת */
  accepted: "forum_accepted",
} as const;
export type ForumNotificationType =
  (typeof FORUM_NOTIFICATION_TYPES)[keyof typeof FORUM_NOTIFICATION_TYPES];

export function isForumNotificationType(type: string): type is ForumNotificationType {
  return Object.values(FORUM_NOTIFICATION_TYPES).includes(type as ForumNotificationType);
}

/** הישות שההתראה מצביעה עליה — מפתח ב-`ENTITY_ROUTES` ובקישורי הפעמון. */
export const FORUM_THREAD_ENTITY = "forum_thread";

export interface ForumNoticeText {
  title: string;
  body: string;
}

/** התראה על תגובה — הכותרת נושאת את מי ענה, הגוף את תחילת התגובה. */
export function forumReplyNotice(input: {
  threadTitle: string;
  authorLabel: string;
  reply: string;
}): ForumNoticeText {
  return {
    title: `${input.authorLabel} בפורום: ${forumSnippet(input.threadTitle, 90)}`.slice(0, 200),
    body: forumSnippet(input.reply, 220),
  };
}

/** התראה על שרשור חדש — למי שעוקב אחרי הפורום כולו. */
export function forumThreadNotice(input: {
  kind: ForumKind;
  title: string;
  authorLabel: string;
  body: string;
}): ForumNoticeText {
  return {
    title: `${FORUM_KIND_LABELS[input.kind]} חדש/ה בפורום: ${forumSnippet(input.title, 90)}`.slice(0, 200),
    body: `${input.authorLabel} — ${forumSnippet(input.body, 200)}`.slice(0, 500),
  };
}

/** „התגובה שלך התקבלה כתשובה” — הרגע הקטן שמחזיק קהילה. */
export function forumAcceptedNotice(threadTitle: string): ForumNoticeText {
  return {
    title: "התגובה שלך סומנה כתשובה המקובלת",
    body: forumSnippet(threadTitle, 200),
  };
}

/* ==================== וואטסאפ — כפתורים ופקודות ==================== */

/**
 * מפתח הכפתור ⟵ המשפט שנשלח למנוע כאילו הוקלד — אותו דפוס של
 * המנטור (`MENTOR_QUICK_COMMANDS`). מקור אחד לוורקר שמצמיד את
 * הכפתור ולסוכן שמתרגם את הלחיצה.
 */
export const FORUM_QUICK_COMMANDS = {
  forum_reply: "להשיב בפורום",
  forum_latest: "מה חדש בפורום?",
  forum_unfollow: "להפסיק לעקוב אחרי השיחה",
} as const;
export type ForumQuickCommand = keyof typeof FORUM_QUICK_COMMANDS;

/**
 * הפקודה **עם השרשור בתוכה** — „להשיב בפורום [01ABC…]”.
 *
 * הכפתור קשור לשרשור **שההודעה דיברה עליו**, לא ל„ההתראה האחרונה”:
 * בין המסירה ללחיצה יכולה להגיע התראה על שרשור אחר, ותגובה שנכתבה
 * על שאלה אחת הייתה מתפרסמת מתחת לאחרת (ביקורת Codex). אותו דפוס
 * כמו „הרעיון עזר לי [offers_sent:2]” של המנטור.
 */
const THREAD_PAYLOAD = /^(.*?)\s*\[([0-9A-HJKMNP-TV-Z]{26})\]\s*$/u;

export function forumThreadCommand(
  command: "forum_reply" | "forum_unfollow",
  threadId: string,
): string {
  return `${FORUM_QUICK_COMMANDS[command]} [${threadId}]`;
}

/** הפקודה והשרשור שבתוכה — או `null` כשההודעה אינה פקודת פורום. */
export function parseForumCommand(
  text: string,
): { command: "forum_reply" | "forum_unfollow"; threadId: string | null } | null {
  const trimmed = text.trim();
  const payload = THREAD_PAYLOAD.exec(trimmed);
  const phrase = (payload === null ? trimmed : payload[1]!).replace(/\s+/gu, " ").trim();
  const command =
    phrase === FORUM_QUICK_COMMANDS.forum_reply
      ? "forum_reply"
      : phrase === FORUM_QUICK_COMMANDS.forum_unfollow
        ? "forum_unfollow"
        : null;
  if (command === null) return null;
  return { command, threadId: payload === null ? null : payload[2]! };
}

/* ==================== העדפות המשתמש ==================== */

/** המפתח שתחתיו ההעדפות יושבות ב-`users.preferences`. */
export const FORUM_PREF_KEY = "forum";

export type ForumDigest = "instant" | "daily";

export interface ForumPrefs {
  /** לעקוב אחרי **כל** הפורום — שרשור חדש הוא התראה. */
  followAll: boolean;
  /** לקבל במייל את מה שמגיע לפעמון (שרשורים שעוקבים אחריהם). */
  email: boolean;
  /** מיידי (מקובץ לעשר דקות) או פעם ביום בבוקר. */
  digest: ForumDigest;
}

/**
 * ברירת המחדל: מייל **דלוק**, מיידי, בלי מעקב אחרי הכול.
 *
 * מי שעוקב אחרי שרשור עשה זאת בכוונה — לשלוח לו את התשובה במייל
 * הוא קיום ההבטחה, לא ספאם. מעקב אחרי כל הפורום הוא החלטה שמכפילה
 * את הרעש פי כמה, ולכן היא כבויה עד שמבקשים אותה.
 */
export const DEFAULT_FORUM_PREFS: ForumPrefs = {
  followAll: false,
  email: true,
  digest: "instant",
};

export function parseForumPrefs(raw: unknown): ForumPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_FORUM_PREFS;
  const source = (raw as Record<string, unknown>)[FORUM_PREF_KEY] ?? raw;
  if (typeof source !== "object" || source === null) return DEFAULT_FORUM_PREFS;
  const record = source as Record<string, unknown>;
  const digest = record["digest"];
  return {
    followAll: typeof record["followAll"] === "boolean" ? record["followAll"] : DEFAULT_FORUM_PREFS.followAll,
    email: typeof record["email"] === "boolean" ? record["email"] : DEFAULT_FORUM_PREFS.email,
    digest: digest === "daily" || digest === "instant" ? digest : DEFAULT_FORUM_PREFS.digest,
  };
}

/* ==================== מייל ==================== */

export interface ForumMailItem {
  type: string;
  title: string;
  body: string | null;
  threadId: string | null;
}

/**
 * מייל אחד לכל מה שהצטבר — לא מייל לכל תגובה.
 *
 * מי שעוקב אחרי שרשור פעיל היה מקבל עשרה מיילים בשעה. הקיבוץ
 * (עשר דקות, או יום שלם למי שביקש תקציר) הופך את זה למייל אחד עם
 * רשימה, וקישור לכל שרשור.
 */
export function forumActivityEmail(
  firstName: string,
  items: readonly ForumMailItem[],
  webOrigin: string,
  digest: ForumDigest,
): { subject: string; content: EmailContent } {
  const origin = webOrigin.replace(/\/+$/u, "");
  const count = items.length;
  const subject =
    count === 1
      ? items[0]!.title
      : digest === "daily"
        ? `הפורום המקצועי — ${count} עדכונים מהיום האחרון`
        : `הפורום המקצועי — ${count} עדכונים חדשים`;
  const seenThreads = new Set<string>();
  const links = items
    .filter((item) => item.threadId !== null)
    .filter((item) => {
      if (seenThreads.has(item.threadId!)) return false;
      seenThreads.add(item.threadId!);
      return true;
    })
    .slice(0, 12)
    .map((item) => ({
      label: item.title,
      url: `${origin}${forumThreadPath(item.threadId!)}`,
    }));
  const paragraphs = items.slice(0, 12).map((item) =>
    item.body === null || item.body === "" ? item.title : `${item.title} — ${item.body}`,
  );
  return {
    subject,
    content: {
      heading: count === 1 ? "עדכון מהפורום המקצועי" : `${count} עדכונים מהפורום המקצועי`,
      greeting: `שלום ${firstName},`,
      paragraphs,
      links,
      button: { label: "לפורום", url: `${origin}/forum` },
      footnote:
        "המייל נשלח כי אתם עוקבים אחרי שיחות בפורום. אפשר לכבות או להחליף לתקציר יומי בפרופיל, תחת „הפורום המקצועי”.",
    },
  };
}

/* ==================== חיפוש ==================== */

/**
 * תחיליות עבריות שנדבקות למילה — „הבלעדיות”, „בבלעדיות”, „ושבלעדיות”.
 *
 * תצורת `simple` של Postgres אינה מכירה עברית: „בלעדיות” ו„הבלעדיות”
 * הן שתי מילים שונות בעיניה. המחשבון כאן עושה את מה שמנתח מורפולוגי
 * היה עושה, בצורה גסה ומספיקה: מוריד את התחילית מהמילה שהוקלדה,
 * ומחפש את השורש עם **כל** התחיליות הנפוצות בתחילת התו במסמך.
 */
const HEBREW_PREFIXES = [
  "", "ה", "ו", "ב", "ל", "מ", "ש", "כ",
  "וה", "וב", "ול", "ומ", "וש", "וכ", "שה", "מה", "כש", "שב", "של", "שמ",
] as const;
/** התחיליות שמורידים מהמילה שהוקלדה — הארוכות קודם. */
const STRIPPABLE = ["וכש", "כשה", "וה", "וב", "ול", "ומ", "וש", "וכ", "שה", "מה", "כש", "שב", "של", "שמ", "ה", "ו", "ב", "ל", "מ", "ש", "כ"] as const;
/** אורך שורש מינימלי אחרי ההורדה — „בית” אינו „ית”. */
const MIN_STEM = 3;

function stem(word: string): string {
  if (!/^[\u05D0-\u05EA]/u.test(word)) return word;
  for (const prefix of STRIPPABLE) {
    if (word.startsWith(prefix) && word.length - prefix.length >= MIN_STEM) {
      return word.slice(prefix.length);
    }
  }
  return word;
}

/**
 * מחרוזת ל-`to_tsquery('simple', …)` — בטוחה, כי רק אותיות וספרות
 * שורדות; כל מילה הופכת לקבוצת חלופות עם תחיליות, בהתאמת תחילית
 * (`:*`), והמילים מחוברות ב-AND. `null` = אין מה לחפש.
 */
export function forumSearchTsquery(raw: string): string | null {
  const words = raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words
    .map((word) => {
      const root = stem(word);
      const variants = /^[\u05D0-\u05EA]/u.test(root)
        ? HEBREW_PREFIXES.map((prefix) => `${prefix}${root}:*`)
        : [`${root}:*`];
      return `(${[...new Set(variants)].join(" | ")})`;
    })
    .join(" & ");
}

/* ==================== דירוג ==================== */

/** ממוצע לעשירית; `null` כשאין דירוגים — ואז המסך אומר „טרם דורג”. */
export function ratingAverage(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

/* ==================== מחשבונים ==================== */

/**
 * עמלת תיווך — אחוז מהמחיר, בתוספת מע"מ.
 *
 * אגורות ומספרים שלמים, כמו בכל מקום שכסף עובר בו (`MoneyAgorot`).
 * המע"מ מגיע מבחוץ: השיעור משתנה בחוק, והוא כבר קבוע אחד במערכת
 * (`DEFAULT_VAT_PERCENT`).
 */
export function commissionBreakdown(
  priceAgorot: number,
  percent: number,
  vatPercent: number,
): { netAgorot: number; vatAgorot: number; grossAgorot: number } {
  const net = Math.round((priceAgorot * percent) / 100);
  const vat = Math.round((net * vatPercent) / 100);
  return { netAgorot: net, vatAgorot: vat, grossAgorot: net + vat };
}

/** החזר חודשי בהלוואה בריבית קבועה (שפיצר). ריבית אפס = חלוקה שווה. */
export function monthlyPayment(principalAgorot: number, annualRatePercent: number, years: number): number {
  const months = Math.round(years * 12);
  if (months <= 0 || principalAgorot <= 0) return 0;
  const rate = annualRatePercent / 100 / 12;
  if (rate === 0) return Math.round(principalAgorot / months);
  const factor = Math.pow(1 + rate, months);
  return Math.round((principalAgorot * rate * factor) / (factor - 1));
}

/** תשואה שנתית ברוטו מהשכרה — אחוז לעשירית. */
export function rentalYieldPercent(priceAgorot: number, monthlyRentAgorot: number): number | null {
  if (priceAgorot <= 0) return null;
  return Math.round(((monthlyRentAgorot * 12) / priceAgorot) * 1000) / 10;
}

export interface TaxBracket {
  /** עד סכום זה (בשקלים); `null` = ללא תקרה */
  upTo: number | null;
  percent: number;
}

/**
 * מדרגות מס רכישה — **נתון שמתעדכן בחוק, ולכן ניתן לעריכה במסך.**
 *
 * הערכים כאן הם המדרגות שפורסמו לינואר 2025 (דירה יחידה ודירה
 * נוספת). רשות המסים מעדכנת אותן מדי ינואר; המחשבון מציג אותן
 * כברירת מחדל עם שנת הפרסום, ומאפשר להקליד מדרגות עדכניות. מחשבון
 * שמציג מספר מהשנה שעברה כאמת מוחלטת מזיק יותר ממחשבון שאין בו.
 */
export const PURCHASE_TAX_YEAR = 2025;
export const PURCHASE_TAX_SINGLE_HOME: readonly TaxBracket[] = [
  { upTo: 1_978_745, percent: 0 },
  { upTo: 2_347_040, percent: 3.5 },
  { upTo: 6_055_070, percent: 5 },
  { upTo: 20_183_565, percent: 8 },
  { upTo: null, percent: 10 },
];
export const PURCHASE_TAX_ADDITIONAL_HOME: readonly TaxBracket[] = [
  { upTo: 6_055_070, percent: 8 },
  { upTo: null, percent: 10 },
];

/** מס רכישה מדורג — כל מדרגה על החלק שבתוכה. שקלים שלמים. */
export function purchaseTax(priceShekels: number, brackets: readonly TaxBracket[]): number {
  if (priceShekels <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const bracket of brackets) {
    const ceiling = bracket.upTo ?? Number.POSITIVE_INFINITY;
    if (priceShekels <= floor) break;
    const slice = Math.min(priceShekels, ceiling) - floor;
    tax += (slice * bracket.percent) / 100;
    floor = ceiling;
  }
  return Math.round(tax);
}

/** „1,234,567 ₪” — לתצוגה בלבד. */
export function shekelsLabel(shekels: number): string {
  return `${formatIsraeliNumber(Math.round(shekels))} ₪`;
}
