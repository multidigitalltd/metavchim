import type { MentorActivity, MentorGoalMetric } from "./mentor.js";

/**
 * ספר המשחק של המנטור — מה מנטור מכירות בנדל"ן באמת אומר כשמבקשים
 * ממנו עצה (docs/14 §7.1).
 *
 * ## למה זה בקוד ולא רק בפרומפט
 *
 * שלושה מקומות נותנים עצה: השיחה החופשית (עם מודל), הבוקר של המנטור
 * והסיכום השבועי (בלי מודל), ותשובת הגיבוי כשהמודל אינו זמין. עצה
 * שחיה רק בפרומפט נעלמת ברגע שאין מפתח — ובדיוק אז המתווך שואל
 * „מה לעשות”. הרעיונות כאן דטרמיניסטיים, נבדקים, ובאותו קול; המודל
 * מקבל אותם כחומר גלם ומתאים אותם למספרים של המתווך.
 *
 * ## הקול
 *
 * צורת המקור („לחסום”, „לשלוח”) ו„שלך”/„לך” — לא „אתה/את” ולא פועל
 * בגוף שני בהווה, כדי לא לנחש מין. משפט אחד או שניים לרעיון: משהו
 * שאפשר לעשות **היום**, לא עיקרון.
 */

export interface MentorPlaybookEntry {
  /** מה בדרך כלל עומד מאחורי מדד חלש — שאלה של מנטור, לא אבחנה מלמעלה */
  diagnosis: string;
  /** רעיונות לביצוע — קונקרטיים, בסדר שבו מנטור היה מציע אותם */
  ideas: readonly string[];
}

export const MENTOR_PLAYBOOK: Readonly<
  Record<MentorGoalMetric, MentorPlaybookEntry>
> = {
  offers_sent: {
    diagnosis:
      "הצעות הן הצעד שבשליטה מלאה שלך — כשהן יורדות, בדרך כלל אין שעה קבועה לשלוח אותן, או שמחכים ל„התאמה מושלמת” שלא מגיעה.",
    ideas: [
      "לקבוע שעה קבועה להצעות — למשל 11:00, טלפון על שקט — ולשלוח 3 הצעות ברצף. הצעה יוצאת מהרגל, לא מהשראה.",
      "לכל קונה פעיל לשלוח 2–3 נכסים, לא 10: נכס אחד שמתאים באמת ושניים ליד, עם משפט למה חשבת עליו. הצעה עם „למה” מקבלת תשובה.",
      "לפתוח את המסך „התאמות” ולשלוח את שלוש ההתאמות הגבוהות שעוד לא נשלחו. זה עשר דקות, וזה 3 הצעות.",
      "אחרי 24 שעות בלי תשובה — הודעה אחת: „ראית את הנכס בהרצל? יש סיור מחר ב-17:00.” הצעה בלי מעקב היא חצי הצעה.",
      "לשלוח הצעה גם על נכס „כמעט מתאים” עם שאלה: „זה בכיוון, או שהכיוון אחר?” — התשובה מדייקת את החיפוש יותר מכל שאלון.",
    ],
  },
  viewings_held: {
    diagnosis:
      "סיורים נופלים בשני מקומות: הצעות שלא הופכות לסיור (ההצעה לא מדויקת, או שאין הזמנה ברורה), וסיורים שהיו ביומן ולא התקיימו.",
    ideas: [
      "בכל הצעה להציע שני מועדים קונקרטיים — „מחר ב-17:00 או חמישי ב-10:00?” — במקום „מתי נוח לך?”. שאלה פתוחה מקבלת „אחזור אליך”.",
      "יום לפני הסיור — הודעת אישור קצרה עם כתובת ושעה; שעה לפני — „אני בדרך”. שני משפטים שמורידים את הביטולים בחצי.",
      "לקבץ סיורים: שלושה נכסים באותה שכונה אחרי הצהריים לאותו קונה. סיור אחד הופך לשלושה, והקונה רואה השוואה במקום.",
      "אחרי סיור שבוטל — לא לוותר: „חבל שלא יצא, יש לי משהו דומה ביום שני. לשמור לך 18:00?” הביטול הוא הזדמנות לקבוע שוב.",
      "להתקשר במקום להתכתב כשמדובר בקביעת סיור — שיחה של דקה סוגרת מה שחמש הודעות לא סוגרות.",
    ],
  },
  leads_answered: {
    diagnosis:
      "ליד שלא נענה מתקרר תוך שעות. בדרך כלל הסיבה היא לא זמן — אלא שהלידים נכנסים בזמן סיור או נהיגה, ואין הרגל לחזור אליהם ברגע שהיום מתפנה.",
    ideas: [
      "שלוש נקודות ביום לבדוק לידים חדשים — 09:00, 13:00, 18:00 — ולחזור לכולם באותו סבב. ליד שנענה ביום שנכנס שווה פי כמה מליד של מחר.",
      "ליד שנכנס באמצע סיור — הודעה אחת מוכנה מראש: „ראיתי את הפנייה שלך, אני בסיור ואחזור עד 17:00.” ההודעה קונה זמן; השתיקה מאבדת את הלקוח.",
      "לסיים כל שיחה עם ליד חדש בצעד הבא ובתאריך — סיור, הצעה או שיחה נוספת — ולרשום אותו כמשימה. ליד בלי צעד הבא הוא ליד שנשכח.",
      "לקחת את הלידים שלא נענו מהשבוע שעבר ולחזור אליהם היום עם „עוד רלוונטי?” — חלק כן, וזה שווה את חמש הדקות.",
    ],
  },
  leads_answered_fast: {
    diagnosis:
      "המענה ללידים מגיע, אבל מאוחר. ההבדל בין עשר דקות לשעתיים הוא בדרך כלל הרגל — התראה שרואים אבל דוחים.",
    ideas: [
      "ליד חדש = טלפון תוך 5 דקות, גם אם זה רק „קיבלתי, אחזור בפירוט ב-14:00”. הלקוח בדרך כלל פנה לשלושה מתווכים — הראשון שעונה הוא זה שמדבר איתו.",
      "לחזור מהוואטסאפ, לא מהמייל: הודעה קצרה עם השם שלך ושאלה אחת („מה הכי חשוב לך בדירה?”) פותחת שיחה תוך דקה.",
      "בזמן פגישה או סיור — לתת לעמית במשרד לחזור ללידים החדשים במקומך, ולהחזיר טובה. מענה מהיר של המשרד עדיף על מענה מאוחר שלך.",
      "להפעיל התראות בדפדפן ובטלפון ללידים חדשים (בעמוד הפרופיל) — כדי שהמענה לא יחכה לפעם הבאה שפותחים את המערכת.",
    ],
  },
  calls_made: {
    diagnosis:
      "שיחות יוצאות הן המדד הראשון שנופל כשהיום מתמלא במה שדחוף. בדרך כלל אין להן שעה משלהן — ומה שאין לו שעה לא קורה.",
    ideas: [
      "לחסום 45 דקות בבוקר לשיחות יוצאות — 10:00 עד 10:45, טלפון ביד ורשימה מוכנה מאתמול בערב. עשר שיחות בבלוק אחד קלות יותר מעשר מפוזרות.",
      "רשימת השיחות של מחר נכתבת היום בסוף היום: קונים שלא שמעו ממך שבוע, מוכרים בלי עדכון, לידים ישנים. בבוקר רק מחייגים.",
      "לכל שיחה מטרה אחת לפני שמחייגים — לקבוע סיור, לקבל תשובה על הצעה, לעדכן מוכר. שיחה עם מטרה נגמרת בצעד הבא.",
      "להתקשר לקונה שהיה בסיור לפני שבועיים ולא נסגר — „מה חשבת בסוף על הדירה בהרצל? יש משהו חדש שדומה.” שיחת מעקב אחת שווה שלוש הצעות חדשות.",
    ],
  },
  calls_answered: {
    diagnosis:
      "שיחות נכנסות שלא נענות הן לידים שהולכים למתווך הבא. רובן מגיעות בזמן סיורים ופגישות — השאלה היא לא איך לענות תמיד, אלא איך לחזור מהר.",
    ideas: [
      "שיחה שלא נענתה מקבלת הודעה תוך דקה: „ראיתי שהתקשרת, אני בפגישה ואחזור עד 16:00.” — וחזרה בשעה שהובטחה. המספר הזה כבר לא יתקשר למישהו אחר.",
      "לסיים כל סיור עם עשר דקות פנויות אחריו — לחזור לשיחות שלא נענו לפני שנוסעים לסיור הבא.",
      "בשעות של פגישות קבועות — להפנות את הקו לעמית במשרד. שיחה שנענתה על ידי מישהו מהמשרד שווה יותר משיחה שנענתה מחר.",
      "לפתוח את מסך השיחות פעם ביום ולעבור על „לא נענו” — כל שורה היא טלפון של דקה, ולפחות אחת מהן היא לקוח.",
    ],
  },
  followups_done: {
    diagnosis:
      "מעקבים שלא הושלמו אומרים בדרך כלל דבר אחד: המשימות קיימות, אבל אין רגע ביום שמוקדש להן — והן נדחות עד שהן כבר לא רלוונטיות.",
    ideas: [
      "רבע שעה בסוף היום למעקבים בלבד — לסגור את של היום ולכתוב את של מחר. מעקב שנעשה ביום שנקבע לו הוא מה שמבדיל בין „עוקב” ל„נזכר”.",
      "לכל מעקב לכתוב מה אומרים בו, לא רק „לחזור לדנה”: „לשאול את דנה אם הדירה בהרצל עדיין רלוונטית אחרי הסיור”. מעקב עם משפט מוכן נעשה; מעקב סתמי נדחה.",
      "לחלק את המעקבים לשניים — טלפון (בבלוק השיחות של הבוקר) והודעה (בכל רגע פנוי). מעקב בהודעה לוקח דקה, ואפשר לסגור חמישה בין סיורים.",
      "אחרי כל סיור — מעקב ליום המחרת, לא לשבוע הבא. הרושם מהסיור טרי יום אחד; אחרי שבוע צריך להתחיל מחדש.",
    ],
  },
  owner_updates_sent: {
    diagnosis:
      "מוכר שלא שומע ממך שבוע מתחיל לחשוב שלא קורה כלום — גם כשקורה. עדכון קבוע הוא מה ששומר את הבלעדיות ומונע הורדת מחיר בטלפון כועס.",
    ideas: [
      "יום קבוע לעדכוני מוכרים — למשל חמישי אחרי הצהריים: לכל מוכר הודעה של שלושה משפטים — כמה פניות, כמה סיורים, מה הקונים אמרו. גם כשאין חדש, „השבוע 4 פניות ו-2 סיורים, ממשיכים” הוא עדכון.",
      "לשלוח דוח פעילות מהמערכת (בכרטיס הנכס, „בעל הנכס”) פעם בשבועיים — מספרים שהמוכר רואה בעצמו שווים יותר מהבטחות.",
      "אחרי כל סיור — משפט אחד למוכר באותו יום: „היה סיור, הקונים אמרו X.” המשוב מהשטח הוא מה שמכין את המוכר לשיחה על מחיר.",
      "לסמן בכרטיס הנכס כל מוכר שלא קיבל עדכון עשרה ימים — ולהתחיל את יום העדכונים ממנו.",
    ],
  },
  new_buyers: {
    diagnosis:
      "קונים חדשים מגיעים משלושה מקורות: לידים שנענו והפכו לקונים, מבקרים בסיורים שלא התאימו לנכס הזה, והפניות. כשהמספר יורד — בדרך כלל אחד מהם נעצר.",
    ideas: [
      "כל מבקר בסיור שלא התאים לו הנכס הוא קונה: לשאול לפני שהוא יוצא „מה כן היה מתאים לך?” ולפתוח לו כרטיס. סיור אחד יכול להכניס שני קונים.",
      "לחזור ללידים מהחודש האחרון שלא הפכו לקונים ולשאול שאלה אחת: „עוד מחפשים?” — מי שעונה כן נכנס לרשימת ההצעות היום.",
      "לבקש הפניה מכל קונה שסגרת איתו — „מכיר מישהו שמחפש באזור?” — בשבוע שאחרי החתימה, כשהוא הכי מרוצה.",
      "לפרסם נכס בשוק הרשת (שת״פ) — קונים של משרדים אחרים רואים אותו, ומי שמתעניין הוא ליד חדש שלך.",
    ],
  },
  new_properties: {
    diagnosis:
      "נכסים חדשים הם צד ההיצע, והוא לא נכנס לבד. כשהמספר יורד, בדרך כלל השבוע התמלא בקונים ולא נשאר זמן לצאת למוכרים.",
    ideas: [
      "שעה בשבוע ל„הליכה ברחוב”: הרחובות שבהם יש לך קונים פעילים — שלטי „למכירה” של בעלים פרטיים הם פנייה ישירה עם קונה ביד.",
      "לכל מוכר שסגרת איתו — לבקש שני שמות של שכנים או חברים ששוקלים למכור. הפניה ממוכר מרוצה היא הנכס הקל ביותר לקלוט.",
      "לחזור למוכרים שסירבו לבלעדיות לפני חודשיים: „הנכס עוד בשוק? יש לי קונה שמחפש בדיוק את זה.” חלק מהם עייפו מלמכור לבד.",
      "לעקוב אחרי ביקושים ברשת השת״פ — ביקוש שאין לו נכס הוא סיבה לצאת לחפש אחד באזור, עם קונה מוכן.",
    ],
  },
  deals_closed: {
    diagnosis:
      "עסקה היא תוצאה, לא פעולה — אי אפשר „לעשות עסקה” היום. מה שאפשר: לזהות את העסקה הקרובה ביותר ולהסיר לה מכשול אחד.",
    ideas: [
      "לבחור את הקונה הכי קרוב לסגירה ולשאול מה חסר לו — מחיר, מימון, אישור של בן משפחה — ולטפל בדבר הזה היום, לא בהצעה חדשה.",
      "לחזור לקונה שראה נכס פעמיים ולא החליט — ולהציע סיור שלישי עם מי שמחליט איתו. עסקאות נסגרות כשכל המחליטים ראו.",
      "להביא למוכר הצעת מחיר בכתב גם כשהיא נמוכה — הצעה על השולחן מזיזה משא ומתן שתקוע בהשערות.",
      "לתרגם את יעד העסקאות ליעדי תהליך שבועיים (הכפתור במסך היעדים) — ולעבוד על המספרים שבשליטה: סיורים, הצעות, לידים.",
    ],
  },
};

/**
 * מפתח הרעיון — „offers_sent:2”: המדד והמיקום ברשימה. יציב כל עוד
 * הרשימה אינה משתנה בסדרה; רעיון שנמחק מהאמצע מזיז את המפתחות
 * שאחריו, ולכן מוסיפים רעיונות **בסוף** בלבד.
 */
export function ideaKey(metric: MentorGoalMetric, index: number): string {
  return `${metric}:${index}`;
}

const IDEA_KEY = /^([a-z_]+):(\d{1,2})$/u;

/** הרעיון שמאחורי מפתח — `null` למפתח שאינו מצביע על רעיון קיים. */
export function ideaByKey(
  key: string,
): { metric: MentorGoalMetric; index: number; text: string } | null {
  const match = IDEA_KEY.exec(key);
  if (match === null) return null;
  const metric = match[1] as MentorGoalMetric;
  const entry = (MENTOR_PLAYBOOK as Record<string, MentorPlaybookEntry>)[
    metric
  ];
  if (entry === undefined) return null;
  const index = Number(match[2]);
  const text = entry.ideas[index];
  return text === undefined ? null : { metric, index, text };
}

/**
 * מה המתווך אמר על רעיונות — הזיכרון של המנטור לגבי מה עובד אצלו
 * (docs/14 §7.2). נשמר ב-`preferences.mentor.ideas` של המשתמש.
 *
 * - `dismissed` — „לא בשבילי”: לא מוצע שוב.
 * - `liked` — „עזר לי”: נאמר למודל בשיחה כדי שיבנה על מה שעובד.
 */
export interface MentorIdeaFeedback {
  liked: readonly string[];
  dismissed: readonly string[];
  /**
   * יומן הסימונים, עם תאריך — כדי למדוד אחר כך אם המספר באמת זז
   * (`mentorIdeaOutcome`). „עזר לי” ב-3.9 על רעיון להצעות: כמה הצעות
   * היו בשבוע שאחרי, מול השבוע שלפני. הרשימות למעלה הן „מה”; זה „מתי”.
   */
  marks: readonly MentorIdeaMark[];
}

export interface MentorIdeaMark {
  key: string;
  verdict: "helped" | "dismissed";
  /** יום הלוח הישראלי של הסימון — „2026-09-03” */
  date: string;
}

export const EMPTY_IDEA_FEEDBACK: Readonly<MentorIdeaFeedback> = {
  liked: [],
  dismissed: [],
  marks: [],
};

/** כמה מפתחות נשמרים לכל רשימה — הישנים נושרים; מאתיים הם שנים של בקרים. */
export const IDEA_FEEDBACK_MAX = 200;
/** כמה סימונים מתוארכים נשמרים — שישים הם חודשיים של בקרים, די למדידה ולסיכום חודשי. */
export const IDEA_MARKS_MAX = 60;

const MARK_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * יום לוח אמיתי — לא רק צורה: „2026-99-99” עובר את הביטוי, ובשעון
 * ישראל הוא זורק. ה-preferences הם קלט של המשתמש (ביקורת Codex), וסימון
 * פגום אחד היה מפיל את הסבב השבועי של כל המשרד.
 */
function isCalendarDay(label: string): boolean {
  const match = MARK_DATE.exec(label);
  if (match === null) return false;
  const at = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === label;
}

/** מה-preferences של המשתמש — סלחני: ערך פגום הוא רשימה ריקה. */
export function resolveIdeaFeedback(preferences: unknown): MentorIdeaFeedback {
  const mentor =
    typeof preferences === "object" && preferences !== null
      ? (preferences as { mentor?: unknown }).mentor
      : undefined;
  const ideas =
    typeof mentor === "object" && mentor !== null
      ? (mentor as { ideas?: unknown }).ideas
      : undefined;
  const list = (name: "liked" | "dismissed"): string[] => {
    const raw =
      typeof ideas === "object" && ideas !== null
        ? (ideas as Record<string, unknown>)[name]
        : undefined;
    return Array.isArray(raw)
      ? raw
          .filter((k): k is string => typeof k === "string" && IDEA_KEY.test(k))
          .slice(-IDEA_FEEDBACK_MAX)
      : [];
  };
  const rawMarks =
    typeof ideas === "object" && ideas !== null
      ? (ideas as { marks?: unknown }).marks
      : undefined;
  const marks: MentorIdeaMark[] = Array.isArray(rawMarks)
    ? rawMarks
        .flatMap((m: unknown): MentorIdeaMark[] => {
          if (typeof m !== "object" || m === null) return [];
          const { key, verdict, date } = m as Record<string, unknown>;
          return typeof key === "string" &&
            IDEA_KEY.test(key) &&
            (verdict === "helped" || verdict === "dismissed") &&
            typeof date === "string" &&
            isCalendarDay(date)
            ? [{ key, verdict, date }]
            : [];
        })
        .slice(-IDEA_MARKS_MAX)
    : [];
  return { liked: list("liked"), dismissed: list("dismissed"), marks };
}

/**
 * המפתח של הרעיון שמופיע בטקסט — הודעת הבוקר נושאת את הרעיון במילים,
 * לא כמזהה, וכפתורי המשוב צריכים לדעת על מה. `null` כשאין בטקסט רעיון
 * מספר המשחק (בוקר בלי רעיון).
 */
export function ideaKeyInText(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === "") return null;
  for (const metric of Object.keys(MENTOR_PLAYBOOK) as MentorGoalMetric[]) {
    const index = MENTOR_PLAYBOOK[metric].ideas.findIndex((idea) =>
      text.includes(idea),
    );
    if (index >= 0) return ideaKey(metric, index);
  }
  return null;
}

export interface PlaybookIdea {
  key: string;
  text: string;
}

/**
 * רעיון להיום — מסתובב לפי היום, כדי שהבוקר של המנטור לא יגיד את אותו
 * משפט כל יום. ה„זרע” הוא מספר היום (למשל יום בשנה): מי שמקבל שני
 * רעיונות באותו יום מקבל אותו רעיון — עקביות עדיפה על אקראיות.
 *
 * רעיון שהמתווך סימן „לא בשבילי” אינו מוצע שוב; כשסימן כך את כולם —
 * חוזרים לרשימה המלאה, כי שתיקה גרועה מרעיון שכבר נאמר.
 */
export function playbookIdeaPick(
  metric: MentorGoalMetric,
  seed: number,
  feedback: MentorIdeaFeedback = EMPTY_IDEA_FEEDBACK,
): PlaybookIdea {
  const all = MENTOR_PLAYBOOK[metric].ideas.map((text, index) => ({
    key: ideaKey(metric, index),
    text,
  }));
  const dismissed = new Set(feedback.dismissed);
  const open = all.filter((idea) => !dismissed.has(idea.key));
  const pool = open.length > 0 ? open : all;
  const index = ((Math.floor(seed) % pool.length) + pool.length) % pool.length;
  return pool[index]!;
}

export function playbookIdea(
  metric: MentorGoalMetric,
  seed: number,
  feedback?: MentorIdeaFeedback,
): string {
  return playbookIdeaPick(metric, seed, feedback).text;
}

/**
 * שלבי המשפך שנמדדים כיחסי המרה — כל שלב מול הבא אחריו. `typical`
 * הוא ברירת המחדל שנאמרת בשמה („מקובל”), לא ממוצע של עמיתים: אין
 * כאן נתוני משתמשים אחרים.
 */
export interface FunnelStage {
  from: MentorGoalMetric;
  to: MentorGoalMetric;
  /** „הצעה ⟵ סיור” */
  label: string;
  /** כמה `from` לכל `to` מקובל */
  typical: number;
}

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  {
    from: "leads_answered",
    to: "new_buyers",
    label: "ליד שנענה ⟵ קונה",
    typical: 2,
  },
  { from: "new_buyers", to: "offers_sent", label: "קונה ⟵ הצעה", typical: 2 },
  {
    from: "offers_sent",
    to: "viewings_held",
    label: "הצעה ⟵ סיור",
    typical: 3,
  },
  {
    from: "viewings_held",
    to: "deals_closed",
    label: "סיור ⟵ עסקה",
    typical: 5,
  },
];

/** כמה מהשלב הבא צריך כדי שהיחס יהיה עובדה ולא מקרה. */
const MIN_STAGE_OUTCOMES = 3;

export interface FunnelReading {
  stage: FunnelStage;
  /** כמה `from` היו לכל `to` בפועל — `null` כשאין מספיק */
  ratio: number | null;
  from: number;
  to: number;
}

/**
 * המשפך של המתווך עצמו — יחס לכל שלב, מתוך ההיסטוריה (בדרך כלל 13
 * שבועות). שלב עם פחות משלוש תוצאות מקבל `null`: „הצעה אחת, סיור
 * אחד” אינו יחס, זה יום שלישי.
 */
export function funnelReadings(history: MentorActivity): FunnelReading[] {
  return FUNNEL_STAGES.map((stage) => {
    const from = history[stage.from];
    const to = history[stage.to];
    return {
      stage,
      from,
      to,
      ratio: to >= MIN_STAGE_OUTCOMES && from > 0 ? from / to : null,
    };
  });
}

/** כמה גרוע מהמקובל צריך להיות כדי לקרוא לזה צוואר בקבוק — פי 1.5. */
const BOTTLENECK_FACTOR = 1.5;

/**
 * השלב שבו המשפך של המתווך מאבד הכי הרבה ביחס למקובל — או `null`
 * כשאין שלב כזה (או שאין מספיק היסטוריה). מנטור מצביע על מקום אחד,
 * לא על ארבעה.
 */
export function funnelBottleneck(
  history: MentorActivity,
): FunnelReading | null {
  let worst: FunnelReading | null = null;
  let worstFactor = BOTTLENECK_FACTOR;
  for (const reading of funnelReadings(history)) {
    if (reading.ratio === null) continue;
    const factor = reading.ratio / reading.stage.typical;
    if (factor >= worstFactor) {
      worst = reading;
      worstFactor = factor;
    }
  }
  return worst;
}

/** „כל 6 הצעות ⟵ סיור (מקובל: כל 3)” */
export function funnelReadingLabel(reading: FunnelReading): string {
  const shown =
    reading.ratio === null ? "—" : String(Math.round(reading.ratio * 10) / 10);
  return `${reading.stage.label}: כל ${shown} (מקובל: כל ${reading.stage.typical})`;
}
