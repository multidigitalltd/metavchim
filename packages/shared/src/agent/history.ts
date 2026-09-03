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
 * ‎**ליבת האחסון של שיחת הסוכן — פעם אחת, לשלושת הכותבים.**
 *
 * צ'אט הוואטסאפ, צ'אט המסך וסורק ההתראות בוורקר כותבים כולם לאותה
 * עמודת `history`. שלושת מרכיבי הליבה — מפתח המנעול, הפירוק
 * והמיזוג — יושבים כאן, בחבילה ששלושתם צורכים; ניסוח מקומי אצל
 * כותב אחד הוא בדיוק הכפילות שמפרידה את הערוצים (הנחיית בעל
 * המוצר), וכבר קרתה פעם אחת עם שני חלונות היסטוריה שונים.
 */

/** מפתח מנעול-הייעוץ של שיחת המשתמש — זהה בכל הכותבים. */
export function conversationLockKey(tenantId: string, userId: string): string {
  return `wa-chat:${tenantId}:${userId}`;
}

/** עמודת ה-JSON ⟵ תורות. צורה לא מוכרת = שיחה ריקה, לא קריסה. */
export function parseStoredTurns(history: unknown): AgentHistoryTurn[] {
  return Array.isArray(history) ? (history as unknown as AgentHistoryTurn[]) : [];
}

/**
 * ‎**ההצעה האחרונה שהסוכן העלה** — או `null` כשאין כזו.
 *
 * „כן” הוא מילה תלושה בלי הדבר שהיא מסכימה לו. הפונקציה מחזירה
 * את המשפט שהוצע בתור האחרון בלבד — **ולא סורקת אחורה**: „כן”
 * אחרי שיחה שלמה על משהו אחר אינו חוזר להצעה מלפני עשרה תורות,
 * וזו בדיוק ההפתעה שתגרום למתווך להפסיק לענות „כן”.
 *
 * ‎`origin: "assistant"` (התראה שהסוכן יזם) אינו נושא הצעה, ולכן
 * הוא פשוט לא יתאים — אין צורך לסנן אותו בנפרד.
 */
export function lastOffer(history: readonly AgentHistoryTurn[]): string | null {
  const last = history.at(-1);
  const offer = last?.offer;
  return offer === undefined || offer.trim() === "" ? null : offer;
}

/**
 * מיזוג תורות חדשים אל השמורים — הוספה בסוף ותקרה אחת. ההיסטוריה
 * אינה נערכת אחורה, ולכן החיבור הזה הוא מיזוג נכון ולא ניחוש.
 */
export function mergeStoredTurns(
  stored: readonly AgentHistoryTurn[],
  added: readonly AgentHistoryTurn[],
): AgentHistoryTurn[] {
  return [...stored, ...added].slice(-AGENT_HISTORY_KEPT);
}

/**
 * מה הסוכן אומר לעצמו שהוא שלח, לפי סוג ההתראה.
 *
 * סוג שאינו כאן אינו נכנס לזיכרון כלל. זו החלטה ולא פער: תור
 * שאומר „עדכנתי אותך על משהו” אינו מוסיף הקשר, והוא כן דוחק החוצה
 * תור אמיתי מחלון ההיסטוריה הקצר.
 */
const NOTIFY_MEMORY: Record<string, string> = {
  /*
   * דו"ח הבוקר נכנס לזיכרון: „מה הפגישה הראשונה?” מיד אחריו הוא
   * ההמשך הטבעי, ובלי התור הזה השיחה נראתה למודל כמתחילה מהשאלה.
   */
  daily_brief: 'שלחתי לך את דו"ח הבוקר',
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

/**
 * „משה כהן” ⟵ „משה כהן 1” / „משה כהן 2” כששניים נושאים אותו שם.
 *
 * תווית שחוזרת פעמיים אינה מזהה דבר: היא מצביעה על שתי רשומות,
 * והבחירה ביניהן נופלת על „הראשונה שנמצאה” — כלומר ניחוש שקט
 * (ביקורת Codex). מספור הופך אותה למזהה, ובמקום שבו הוא מוצג הוא
 * גם אומר למתווך שיש שניים.
 *
 * מיוצא כדי שגם שורות התוצאה יעברו בו: התווית שנשמרת, זו שמוצגת
 * וזו שבהפניה חייבות להיות אותה מחרוזת, אחרת המספור עצמו יוצר
 * את הפער שהוא נועד לסגור.
 */
export function numberedLabels(
  labels: readonly string[],
  maxLength?: number,
  /**
   * אילו תוויות **רשאיות** לקבל מספר. חסר = כולן.
   *
   * מספור הופך תווית למפתח, ולכן הוא מיועד לשורה שיש לה רשומה
   * להצביע עליה. שורת אירוע (שיחה, פגישה) שקיבלה מספר הפכה
   * ל„<כותרת> 2” — ביטוי שאין לו מקבילה באף רשומה, והחיפוש עליו
   * נכשל בשקט (ביקורת Codex). מי שאינו רשאי עדיין **תופס** את
   * התווית שלו, כדי שמספר שנוצר לא ייפול עליה.
   */
  numberable?: readonly boolean[],
): string[] {
  return numberedForms(labels, labels, maxLength, numberable).display;
}

/**
 * אותה הכרעה בדיוק, לשתי הצורות של אותה תווית — **מספר אחד לשתיהן.**
 *
 * לשורת תוצאה יש צורה מוצגת (נחתכת ב„…”) וצורה נשמרת (רישא נקייה),
 * והן נבדלות דווקא בקצה. שני מעברי מספור נפרדים הכריעו אחרת על
 * אותה שורה: שני שמות שנחלקים ב-39 התווים הראשונים ונבדלים ב-40
 * נראים זהים בתצוגה ומקבלים „1” ו„2”, בעוד הזיכרון רואה שתי
 * מחרוזות שונות ואינו ממספר. המתווך רואה מספר, חוזר עליו, ואף
 * הפניה אינה נושאת אותו (ביקורת Codex).
 *
 * לכן ההתנגשות נבדקת בשתי הצורות, המספר נבחר כך שהוא פנוי
 * ב**שתיהן**, ומוצמד לשתיהן. מקרה הפוך קיים גם הוא — שם באורך
 * הגבול בדיוק מול שם ארוך שנחתך אליו — ולכן אין די בבדיקת התצוגה.
 */
export function numberedForms(
  display: readonly string[],
  memory: readonly string[],
  maxLength?: number,
  numberable?: readonly boolean[],
): { display: string[]; memory: string[] } {
  const mayNumber = (i: number): boolean => numberable?.[i] ?? true;
  /*
   * **הספירה כוללת את כולם; רק ההצמדה מוגבלת.**
   *
   * ספירה שדילגה על מי שאינו רשאי למספר עיוורת בדיוק להתנגשות
   * שהיא אמורה למצוא: שם קונה ארוך ופגישה שכותרתה שווה לארבעים
   * התווים הראשונים שלו נראים שונה בתצוגה ונחתכים לאותה רישא
   * בזיכרון. איש מהם לא נספר כפול, אף אחד לא מוספר, ושתי השורות
   * חוזרות לפרומפט באותה תווית — כשרק לאחת מהן יש הפניה
   * (ביקורת Codex).
   *
   * ההכרעה מי מקבל את המספר נשארת כפי שהייתה: השורה שיש לה רשומה
   * זזה, ושורת האירוע נשארת בשמה.
   */
  const tally = (values: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const displayCounts = tally(display);
  const memoryCounts = tally(memory);
  /*
   * **הייחודיות נבדקת על התווית הסופית — אחרי המספור ואחרי הקיצור.**
   *
   * שני מקורות להתנגשות, ושניהם נתפסו רק אחרי שתיקנתי כל אחד
   * בנפרד (ביקורת Codex):
   *
   * 1. „משה כהן 1” יכול להיות שם אמיתי של לקוח שלישי ברשימה.
   * 2. תווית באורך המרבי מתקצרת כדי לפנות מקום לסיומת — והתוצאה
   *    המקוצרת עלולה להיות שווה לתווית אחרת שכבר ברשימה.
   *
   * לכן המונה עולה עד שהצורה **הסופית** פנויה, ולא עד שהצורה
   * הביניימית פנויה. `maxLength` חסר = אין קיצור (תוויות התראה).
   */
  const fit = (label: string, suffix: string): string => {
    if (maxLength === undefined || label.length + suffix.length <= maxLength) {
      return `${label}${suffix}`;
    }
    return `${label.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
  };
  const takenDisplay = new Set(display);
  const takenMemory = new Set(memory);
  const numbered: { display: string[]; memory: string[] } = { display: [], memory: [] };
  display.forEach((shown, i) => {
    const remembered = memory[i] ?? shown;
    const duplicated =
      (displayCounts.get(shown) ?? 0) > 1 || (memoryCounts.get(remembered) ?? 0) > 1;
    if (!mayNumber(i) || !duplicated) {
      numbered.display.push(shown);
      numbered.memory.push(remembered);
      return;
    }
    let n = 1;
    while (takenDisplay.has(fit(shown, ` ${n}`)) || takenMemory.has(fit(remembered, ` ${n}`))) {
      n += 1;
    }
    const chosenDisplay = fit(shown, ` ${n}`);
    const chosenMemory = fit(remembered, ` ${n}`);
    takenDisplay.add(chosenDisplay);
    takenMemory.add(chosenMemory);
    numbered.display.push(chosenDisplay);
    numbered.memory.push(chosenMemory);
  });
  return numbered;
}

/** אותו כלל, על רשימת הפניות. */
function numberDuplicateLabels(refs: readonly AgentHistoryRef[]): AgentHistoryRef[] {
  const labels = numberedLabels(refs.map((ref) => ref.label));
  return refs.map((ref, i) => ({ ...ref, label: labels[i]! }));
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
  /*
   * **התאמה מדויקת קודמת לסלחנית.**
   *
   * „משה כהן 2” מכיל את „משה כהן 1”? לא — אבל „משה כהן” כן נכלל
   * בשתיהן, ולכן ההשוואה הסלחנית לבדה הייתה בוחרת את הראשונה.
   */
  /*
   * **תווית שחוזרת בשני תורות נפתרת לזו של המאוחר.**
   *
   * הרשימה מסודרת מהחדש לישן, ולכן ההופעה הראשונה היא הנכונה —
   * וההופעות הישנות יורדות כאן, לפני בדיקת הריבוי. בלי זה שני
   * עדכונים על „הליד מהעדכון” היו נראים כשתי אפשרויות, וההכרעה
   * הייתה חוזרת לחיפוש דווקא כשהתשובה ידועה.
   *
   * מה שנשאר אחרי הצמצום הוא ריבוי אמיתי: שתי רשומות **מאותו תור**
   * שנושאות תווית מתאימה.
   */
  const newest = refs.filter(
    (ref, i) =>
      refs.findIndex((other) => stripBrackets(other.label) === stripBrackets(ref.label)) === i,
  );
  const exact = newest.filter((ref) => stripBrackets(ref.label) === needle);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const loose = newest.filter((ref) => {
    const label = stripBrackets(ref.label);
    return needle.includes(label) || label.includes(needle);
  });
  /*
   * **ביטוי שמתאים לכמה הפניות אינו מכריע.**
   *
   * שתי רשומות באותו שם, או שני שמות ארוכים שנחתכו לאותה רישא —
   * ובחירת הראשונה היא פגיעה שקטה ברשומה הלא נכונה. `null` מחזיר
   * את ההכרעה לחיפוש, שיודע לומר „נמצאו כמה” ולבקש בחירה
   * (ביקורת Codex).
   */
  return loose.length === 1 ? loose[0]! : null;
}

function stripBrackets(text: string): string {
  return text.replaceAll(/[⟪⟫«»<>]/gu, "").trim();
}

/**
 * כמה שורות נלקחות מהתוצאה — **לתשובה, לזיכרון ולהפניות גם יחד.**
 *
 * שתי תקרות נפרדות היו שוברות את ההמשך הרב-תורי: המתווך רואה שורה
 * שביעית, אומר „תקבע לשביעי”, והזיכרון שנשלח לתור הבא מכיר חמש
 * (ביקורת Codex). מה שנראה ומה שנזכר חייבים להיות אותה רשימה
 * בדיוק — ולכן אותו קבוע.
 *
 * הוא יושב **כאן** ולא ב-`result-lines`, כי `agentTurnRefs` היא
 * שאוכפת אותו על הרשימה הסופית, ו-`result-lines` מייבאת מכאן ממילא.
 * הכיוון ההפוך היה מעגל.
 */
export const AGENT_RESULT_ROWS = 8;

/**
 * ההפניות של תור אחד — **הרשומות שהפעולות נגעו בהן, ואחריהן מה שהוצג.**
 *
 * ## מה היה חסר
 *
 * ‎`agentResultRefs` נשענת על `agentResultList`, שמכירה **רשימות**.
 * תוצאה של יצירה, של עדכון או של כרטיס בודד אינה רשימה, ולכן היא
 * לא ייצרה שום הפניה: „תראה לי את הכרטיס של דנה” ואז „תזכיר לי
 * להתקשר אליה” נפל לחיפוש טקסט אחרי „דנה”, ואיתו לשני מצבי הכישלון
 * המתועדים ב-`agentResultRefs`: רישא של שם ארוך שבעליו אינו בין אלף
 * אנשי הקשר האחרונים, ושתי רשומות באותו שם.
 *
 * זו הייתה דווקא הרשומה שהכי סביר שכינוי הגוף מצביע עליה — זו
 * שהמתווך בדיוק פתח, יצר או עדכן.
 *
 * ## למה ‎`acted` הוא **רשימה** ולא ערך יחיד
 *
 * „תוסיף קונה דנה ותזכיר לי להתקשר אליה” הוא אישור אחד ושתי פעולות,
 * ולכן התור נושא שתי רשומות: הקונה שנוצר והמשימה שנוצרה. שמירת
 * הראשית בלבד הייתה מאבדת את המשימה, ו„תסגור אותה” בתור הבא היה
 * חוזר לחיפוש כותרת (ביקורת Codex).
 *
 * הסדר הוא **מהמאוחר לקדום** — הפעולה האחרונה שבוצעה ראשונה.
 * ‎`matchHistoryRef` משאירה את ההופעה הראשונה של כל תווית, ולכן
 * הסדר הזה הוא מה שגורם לכינוי גוף להצביע על מה שזה עתה קרה.
 *
 * ## מדוע התווית היא **השם** ולא תווית תפקיד
 *
 * ‎`buildInterpretPrompt` מדפיס ‎`נוגע ב: ⟪…⟫`‎ רק לתורות של הסוכן.
 * בתור של המתווך המודל רואה את התמלול שלו ואת תקציר התוצאה, ולכן
 * הביטוי שהוא יכול להחזיר הוא מה שמופיע שם — שם, לא „הכרטיס
 * שעדכנתי”. תווית תפקיד הייתה הפניה שאיש לא יכול להצביע עליה.
 *
 * ## תווית ששייכת לשתי רשומות — **שני הצדדים יורדים**
 *
 * שורות התוצאה כבר ממוספרות ומקוצרות מול תקציר הזיכרון, ומספור
 * חוזר כאן היה מנתק את התווית שבהפניה מזו שבתקציר. לכן תווית
 * מתנגשת אינה מוכרעת אלא **נמחקת**, וההכרעה חוזרת לחיפוש שיודע
 * לומר „נמצאו כמה” ולבקש בחירה.
 *
 * **ושני הצדדים, לא אחד מהם.** קודם ירדה רק הרשומה שנגעו בה
 * והשורה שהוצגה נשארה — כלומר על „תוסיף לו הערה” אחרי חיפוש
 * שהציג את הקונה „משה כהן” וצעד המשך שיצר ליד באותו שם, ההערה
 * הייתה נכתבת בשקט על הקונה. השמטת צד אחד אינה מסירה את העמימות
 * אלא הופכת אותה לתשובה שנראית ודאית — כלומר כתיבה על הכרטיס
 * הלא נכון (ביקורת Codex). תווית שמצביעה על יותר מרשומה אחת אינה
 * מזהה אף אחת מהן.
 *
 * אותה רשומה בדיוק (אותו מזהה) אינה התנגשות אלא כפילות, ונשמרת
 * פעם אחת — הראשונה ברשימה, כלומר המאוחרת שבוצעה.
 *
 * ## התוצאה חייבת לעבור את `InterpretSchema` — **בכל שדותיה**
 *
 * מה שיוצא מכאן נשמר בתור הבא ונשלח בבקשה הבאה, ולכן כל חריגה
 * מהסכימה אינה „ערך חורג” אלא **תור שלם שנעלם ב-400**. שני גבולות,
 * ושניהם נבדקו רק אחרי שנשברו:
 *
 * 1. אורך התווית — נחתך ב-`refOf` שבצד ה-API.
 * 2. **אורך הרשימה** — נחתך כאן. שאילתה שהחזירה שמונה שורות ועוד
 *    צעד המשך אחד ייצרו תשע, והבקשה הבאה נדחתה (ביקורת Codex).
 *
 * החיתוך שומר את מה שנגעו בו ומקצץ מזנב השורות: הפניה שנפלה
 * מחזירה את ההכרעה לחיפוש, וזה מסלול שעובד. שם, לעומת זאת, אינו
 * מובן — התור כולו לא נשלח.
 */
export function agentTurnRefs(
  acted: readonly (AgentHistoryRef | undefined)[],
  shown: readonly AgentHistoryRef[],
): AgentHistoryRef[] {
  /*
   * **כפילות רשומה קודם, עמימות תווית אחר כך** — ובסדר הזה.
   *
   * אותה רשומה שנגעו בה וגם הוצגה היא הופעה אחת, ואילו הצמצום
   * נעשה אחרי בדיקת התוויות היא הייתה נראית כשתי רשומות באותו שם
   * ושתיהן היו נמחקות — כלומר הפניה תקינה לגמרי הייתה נעלמת.
   */
  const unique: AgentHistoryRef[] = [];
  for (const ref of [...acted, ...shown]) {
    if (ref === undefined) continue;
    if (unique.some((other) => other.entityId === ref.entityId)) continue;
    unique.push(ref);
  }

  // תווית שיותר מרשומה אחת נושאת אותה אינה מזהה אף אחת מהן
  const ambiguous = new Set(
    unique
      .filter((ref, i) => unique.some((other, j) => j !== i && other.label === ref.label))
      .map((ref) => ref.label),
  );

  return unique.filter((ref) => !ambiguous.has(ref.label)).slice(0, AGENT_RESULT_ROWS);
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
