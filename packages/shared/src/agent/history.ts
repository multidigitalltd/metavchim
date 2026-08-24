/**
 * זיכרון הסוכן על מה ש**הוא עצמו** שלח.
 *
 * ## הבאג
 *
 * המתווך קיבל בוואטסאפ „📞 שיחה שלא נענתה מ-05X…”, ענה „תזכיר לי
 * להתקשר אליו”, והסוכן לא ידע מיהו „אליו”. הסיבה אינה חולשה של
 * המודל: סבב ההתראות כתב ל-`whatsapp_chats` רק את חותמת
 * `notified_through` ולא הוסיף שום תור להיסטוריה. כלומר מבחינת
 * המודל השיחה התחילה במילה „תזכיר”, בלי שום דבר לפניה.
 *
 * ## למה לא פשוט לשמור את כותרת ההתראה
 *
 * כי בכותרת יש את מספר הטלפון של הלקוח, וההיסטוריה נשלחת למודל
 * חיצוני (Gemini). זו בדיוק הסיבה ש-`historySummary` מקצץ טלפונים,
 * אימיילים והערות מתוצאות השאילתות, ואותו כלל חייב לחול גם כאן.
 *
 * לכן הניסוח **נגזר מסוג ההתראה** ולא מהכותרת: מיפוי קבוע של
 * מחרוזות שנכתבו כאן, שאין בהן שום פרט של אדם. מה שהופך את התור
 * לשמיש הוא ה-`refs` — תווית קצרה בעברית והמזהה הפנימי לצידה,
 * כשהמזהה נשאר בצד שלנו והתווית לבדה מגיעה למודל.
 */

import type { AgentHistoryRef, AgentHistoryTurn } from "./prompt.js";

/**
 * כמה תורות נשמרים בשיחה.
 *
 * כאן ולא בשירות, כי **שני** כותבים נוגעים באותו שדה: מענה הסוכן
 * ב-API וסבב ההתראות ב-Worker. שני מספרים היו נחתכים זה את זה —
 * הצד עם החלון הקטן היה מוחק בכל כתיבה את מה שהצד השני שמר.
 */
export const AGENT_HISTORY_KEPT = 6;

/**
 * מה הסוכן אומר לעצמו שהוא שלח, לפי סוג ההתראה.
 *
 * סוג שאינו כאן אינו נכנס לזיכרון כלל. זו החלטה ולא פער: תור
 * שאומר „עדכנתי אותך על משהו” אינו מוסיף הקשר, והוא כן דוחק החוצה
 * תור אמיתי מחלון ההיסטוריה הקצר.
 */
const NOTIFY_MEMORY: Record<string, string> = {
  incoming_call: "עדכנתי אותך על שיחה נכנסת",
  call_missed: "עדכנתי אותך על שיחה נכנסת שלא נענתה",
  call_transcribed: "עדכנתי אותך שתמלול שיחה הסתיים",
  call_follow_up: "עדכנתי אותך על משימת המשך משיחה",
  lead: "עדכנתי אותך על ליד חדש",
  lead_sla: "עדכנתי אותך על ליד שממתין למענה",
  lead_stale: "עדכנתי אותך על ליד שנתקע",
  lead_repeat_inquiry: "עדכנתי אותך על לקוח שפנה שוב",
  lead_returned: "עדכנתי אותך על ליד שחזר",
  task_reminder: "הזכרתי לך משימה",
  appointment_reminder: "הזכרתי לך פגישה",
  viewing_followup: "עדכנתי אותך על מעקב אחרי סיור",
  offer_followup: "עדכנתי אותך על מעקב אחרי הצעה",
  property: "עדכנתי אותך על נכס חדש",
  property_delisted: "עדכנתי אותך על נכס שירד מהשוק",
  buyer: "עדכנתי אותך על קונה חדש",
  coop_offer: "עדכנתי אותך על הצעה מהרשת",
  coop_deal: "עדכנתי אותך על עסקה משותפת",
};

/**
 * אילו סוגי רשומה אפשר להצביע עליהם.
 *
 * `contact` אינו כאן, ובכוונה: אין לו סוג חיפוש בקוד שפותר ביטויים
 * (`ENTITY_LOOKUP`), ולכן תווית שמצביעה עליו הייתה מזמינה את המודל
 * להשתמש בה ואז נופלת בשקט. התראה על שיחה מלקוח **מוכר** שאין לו
 * ליד תישמר אפוא כזיכרון בלי הפניה — הסוכן יידע שהוא עדכן, ויבקש
 * שם. זה פחות טוב מהפניה, וטוב בהרבה משיוך שגוי.
 */
const REF_ENTITY_TYPES = new Set(["lead", "buyer", "property"]);

/** ההתראה כפי שהסבב מכיר אותה — בלי הכותרת, שיש בה טלפון. */
export interface NotifiedForMemory {
  type: string;
  entityType: string | null;
  entityId: string | null;
}

/** תווית לפי סוג הרשומה. קצרה, בעברית, ובלי פרט מזהה. */
const REF_LABEL: Record<string, string> = {
  lead: "הליד מהעדכון",
  buyer: "הקונה מהעדכון",
  property: "הנכס מהעדכון",
};

/**
 * תור זיכרון אחד לכל מה שנשלח בהודעה יזומה אחת.
 *
 * הודעה אחת יכולה לשאת כמה התראות, וכך היא נראית למתווך — הודעה
 * אחת. שמירתה כתור אחד היא מה ששומר על אותה תמונה: „עדכנתי אותך
 * על שיחה שלא נענתה ועל ליד חדש”, ולא שני תורות שדוחקים את שאר
 * השיחה מהחלון.
 *
 * מחזירה `null` כשאין באף פריט מה לזכור.
 */
export function assistantMemoryTurn(items: readonly NotifiedForMemory[]): AgentHistoryTurn | null {
  const texts: string[] = [];
  const refs: AgentHistoryRef[] = [];
  const seenRefs = new Set<string>();
  const seenTexts = new Set<string>();

  for (const item of items) {
    const text = NOTIFY_MEMORY[item.type];
    if (text === undefined) continue;
    // אותו סוג פעמיים באותה הודעה — משפט אחד, לא חזרה
    if (!seenTexts.has(text)) {
      seenTexts.add(text);
      texts.push(text);
    }
    if (
      item.entityId === null ||
      item.entityType === null ||
      !REF_ENTITY_TYPES.has(item.entityType) ||
      seenRefs.has(item.entityId)
    ) {
      continue;
    }
    seenRefs.add(item.entityId);
    /*
     * מספור רק כשיש יותר מאחד. „הליד מהעדכון 1” כשיש אחד בלבד הוא
     * ניסוח שמזמין את המודל לשאול איזה מהם, כשאין בכלל בחירה.
     */
    refs.push({
      label: REF_LABEL[item.entityType] ?? item.entityType,
      entityType: item.entityType as AgentHistoryRef["entityType"],
      entityId: item.entityId,
    });
  }

  if (texts.length === 0) return null;
  return {
    transcript: texts.join(", "),
    // אין פעולה: הסוכן לא ביצע דבר, הוא דיווח
    action: "notify",
    params: {},
    origin: "assistant",
    ...(refs.length > 0 ? { refs: numberDuplicateLabels(refs) } : {}),
  };
}

/** „הליד מהעדכון” ⟵ „הליד מהעדכון 1/2” כששניים נושאים אותה תווית. */
function numberDuplicateLabels(refs: readonly AgentHistoryRef[]): AgentHistoryRef[] {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref.label, (counts.get(ref.label) ?? 0) + 1);
  const used = new Map<string, number>();
  return refs.map((ref) => {
    if ((counts.get(ref.label) ?? 0) < 2) return ref;
    const n = (used.get(ref.label) ?? 0) + 1;
    used.set(ref.label, n);
    return { ...ref, label: `${ref.label} ${n}` };
  });
}

/**
 * הביטוי שהמודל החזיר ⟵ ההפניה שהוא התכוון אליה.
 *
 * המודל מתבקש להעתיק `⟪תווית⟫` כמו שהיא, אבל מודלים משמיטים
 * סוגריים ומוסיפים מילית — ולכן ההשוואה סלחנית: הסוגריים יורדים,
 * והתאמה נחשבת גם כשהביטוי מכיל את התווית או להפך. השוואה קשיחה
 * הייתה הופכת כל סטייה קטנה לחיפוש טקסט חופשי אחרי „הליד מהעדכון”,
 * שלעולם אינו נמצא.
 */
export function matchHistoryRef(
  refs: readonly AgentHistoryRef[] | undefined,
  phrase: string,
): AgentHistoryRef | null {
  if (refs === undefined || refs.length === 0) return null;
  const needle = stripBrackets(phrase);
  if (needle.length < 2) return null;
  for (const ref of refs) {
    const label = stripBrackets(ref.label);
    if (needle === label || needle.includes(label) || label.includes(needle)) return ref;
  }
  return null;
}

function stripBrackets(text: string): string {
  return text.replaceAll(/[⟪⟫«»<>]/gu, "").trim();
}

/**
 * כל ההפניות שהשיחה מכירה, מהחדשה לישנה.
 *
 * הסדר מכריע: „אליו” מתייחס לעדכון האחרון, ולא לזה שלפניו. תווית
 * שחוזרת בשני תורות תיפתר לזו של התור המאוחר.
 */
export function historyRefs(history: readonly AgentHistoryTurn[]): AgentHistoryRef[] {
  const out: AgentHistoryRef[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    for (const ref of history[i]!.refs ?? []) out.push(ref);
  }
  return out;
}
