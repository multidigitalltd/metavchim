import {
  DEFAULT_MENTOR_PERSONA,
  mentorNameLine,
  mentorStyleGuidance,
  type MentorPersona,
} from "./mentor-persona.js";

/**
 * תרגול שיחה — המנטור משחק את הצד השני ונותן משוב (docs/14 §7.3).
 *
 * ## למה זה במנטור
 *
 * מאמן מכירות אמיתי לא רק מודד; הוא מתאמן איתך. „המוכר אומר שהמחיר
 * נמוך מדי” הוא הרגע שבו מתווך מפסיד בלעדיות, ואף אחד לא מתרגל אותו
 * לפני שהוא קורה. כאן מתרגלים: תרחיש, הצד השני עונה כמו בן אדם ולא
 * כמו בובה, ובסוף — מה עבד, מה פספסת, ומשפט אחד לנסות בשיחה האמיתית.
 *
 * ## מי אומר מה
 *
 * הצד השני הוא **דמות**, לא המנטור: יש לו שם, עמדה, ומה ישכנע אותו.
 * המודל משחק אותו; בלי מודל — שלושה משפטים קבועים לתרחיש, כדי
 * שהתרגול לא יקרוס ל„לא זמין”. המשוב הוא של **המנטור**, בקול ובסגנון
 * שהמתווך בחר; הקוד בודק רשימה קבועה (שאלת? הצעת צעד הבא? הבאת
 * נתון?) והמודל מוסיף את הניואנס. המודל מציע, הקוד מכריע: הרשימה
 * נאמרת גם כשאין מודל, והציון בלי מודל נגזר ממנה.
 *
 * ## הקול
 *
 * המשוב פונה למתווך בגוף שני יחיד בלי מין (§4): פעלים בעבר — שאלת,
 * הצעת, הבאת. הדמויות מדברות בגוף ראשון זכר: שמות שאינם מגלים מין
 * לא היו מספיקים, כי „חושב/חושבת” בהווה מחייב בחירה.
 */

export const PRACTICE_SCENARIOS = [
  "seller_price",
  "seller_exclusive",
  "buyer_hesitant",
  "buyer_lowball",
  "lead_cold",
  "commission",
] as const;
export type PracticeScenario = (typeof PRACTICE_SCENARIOS)[number];

export interface PracticeTurn {
  role: "agent" | "counterpart";
  text: string;
}

export interface PracticeCheck {
  key: string;
  /** מה נבדק — במילים שהמשוב אומר, בעבר: „שאלת שאלה” */
  label: string;
  /** על כל מה שהמתווך אמר, מחובר */
  test: (agentText: string, agentTurns: readonly string[]) => boolean;
}

export interface PracticeScenarioInfo {
  code: PracticeScenario;
  /** התווית לבחירה — „מוכר על המחיר” */
  label: string;
  /** משפט אחד שמסביר את המצב */
  blurb: string;
  counterpart: {
    name: string;
    /** „בעל דירת 4 חדרים ברחוב הרצל” */
    role: string;
    /** העמדה והמניע — למודל, לא למתווך */
    stance: string;
    /** מה ישכנע אותו — למודל, לא למתווך */
    convincedBy: string;
  };
  /** המשפט הפותח של הדמות — קבוע, כדי שהתרגול מתחיל בלי מודל */
  opening: string;
  /** מה נחשב הצלחה — למתווך לפני שמתחילים, ולמודל במשוב */
  goal: string;
  /** תשובות הדמות בלי מודל — לפי סדר, ואז חוזרות */
  fallbackLines: readonly [string, string, string];
  /** הבדיקה שמיוחדת לתרחיש */
  check: PracticeCheck;
  /** מה לנסות בשיחה הבאה — כשאין מודל שינסח */
  tip: string;
}

/** כמה תורים של המתווך בתרגול אחד — אחרי זה המשוב, לא עוד סיבוב. */
export const PRACTICE_MAX_AGENT_TURNS = 8;
/** אורך תור של המתווך */
export const PRACTICE_TEXT_MAX = 600;
/** תורים ביום, על כל התרגולים — אותה מכסה כמו השיחה */
export const PRACTICE_DAILY_CAP = 40;

const asked: PracticeCheck = {
  key: "asked",
  label: "שאלת שאלה — לא רק ענית",
  test: (text) => text.includes("?"),
};
const nextStep: PracticeCheck = {
  key: "next_step",
  label: "הצעת צעד הבא קונקרטי",
  test: (text) =>
    /(סיור|פגישה|ניפגש|נדבר מחר|אתקשר|אשלח|נקבע|בשעה|מחר ב|ביום (ראשון|שני|שלישי|רביעי|חמישי|שישי))/u.test(
      text,
    ),
};
const evidence: PracticeCheck = {
  key: "evidence",
  label: "הבאת נתון או דוגמה",
  test: (text) =>
    /(\d|₪|אחוז|%|עסקאות דומות|נמכר|נמכרה|בשוק כבר|ימים בשוק)/u.test(text),
};
const listened: PracticeCheck = {
  key: "listened",
  label: "הקשבת לפני שענית",
  test: (text) =>
    /(מבין|מבינה|הבנתי|מקבל|מקבלת|לגיטימי|נכון ש|צודק|צודקת|שמעתי|ברור לי|אני איתך)/u.test(
      text,
    ),
};
const held: PracticeCheck = {
  key: "held",
  label: "לא ויתרת במשפט הראשון",
  test: (_text, turns) =>
    !/(בסדר,? נוריד|אין בעיה,? נוריד|נוריד את המחיר|תוריד|אתפשר|אוותר|נוותר על|אתן הנחה|נוריד את העמלה|חצי עמלה|בלי בלעדיות)/u.test(
      turns.slice(0, 2).join(" "),
    ),
};

/** הבדיקות הכלליות — בכל תרחיש, בסדר שבו המשוב אומר אותן. */
export const PRACTICE_GENERIC_CHECKS: readonly PracticeCheck[] = [
  listened,
  asked,
  evidence,
  nextStep,
  held,
];

export const PRACTICE_SCENARIO_INFO: readonly PracticeScenarioInfo[] = [
  {
    code: "seller_price",
    label: "מוכר על המחיר",
    blurb: "בעל דירה שבטוח שהמחיר שהצעת נמוך מדי — והשכן מכר ביותר.",
    counterpart: {
      name: "יוסי",
      role: "בעל דירת 4 חדרים ברחוב הרצל, מוכר בפעם הראשונה",
      stance:
        "בטוח שהדירה שלו שווה 2.4 מיליון כי „השכן מכר ב-2.3 לפני שנה והדירה שלי משופצת”. המתווך הציע 2.15. הוא לא כועס — הוא פשוט לא מאמין למספר, וחושש שהמתווך רוצה למכור מהר ובזול.",
      convincedBy:
        "עסקאות דומות אמיתיות עם מספרים, הסבר על מה קורה לנכס שמתחיל גבוה מדי (ימים בשוק, קונים שמדלגים), והצעה לצעד ברור — למשל להתחיל במחיר שלו לשבועיים עם תאריך לבדיקה מחדש.",
    },
    opening:
      "תשמע, 2.15 זה נמוך מדי. השכן שלי מכר ב-2.3 לפני שנה, והדירה שלי משופצת. אני לא מוכר מתחת ל-2.4.",
    goal: "לא להתווכח על המספר — לעגן אותו בעסקאות דומות, להסביר מה קורה לנכס שמתחיל גבוה, ולסגור על צעד הבא ברור (מחיר, תאריך לבדיקה מחדש).",
    fallbackLines: [
      "אני יודע מה השכן קיבל. למה שלי שווה פחות?",
      "אז בוא ננסה חודש במחיר שלי. אם לא ילך — נדבר.",
      "טוב, תשלח לי את העסקאות האלה ונדבר מחר.",
    ],
    check: {
      key: "anchored",
      label: "עיגנת את המחיר בעסקאות דומות",
      test: (text) =>
        /(עסקאות|נמכר|נמכרה|מחיר שוק|שמאי|ביקוש|זמן בשוק|ימים בשוק|קונים מדלגים)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „אני מבין למה 2.3 של השכן מרגיש כמו הרצפה. הנה שלוש עסקאות מהרחוב מהחצי שנה האחרונה — נעבור עליהן ביחד, ואז נחליט על מספר עם תאריך לבדיקה מחדש.”",
  },
  {
    code: "seller_exclusive",
    label: "מוכר שלא רוצה בלעדיות",
    blurb: "בעל נכס שאומר „אני אפרסם לבד, למה לי להתחייב”.",
    counterpart: {
      name: "אבי",
      role: "בעל דירת 3 חדרים, כבר פרסם לבד ביד2 חודשיים",
      stance:
        "מאמין שבלעדיות היא „לתת למישהו מונופול על הדירה שלי”. פרסם לבד, קיבל פניות של מתווכים ולא של קונים, ומתחיל להתעייף — אבל לא יגיד את זה ראשון.",
      convincedBy:
        "תוכנית שיווק קונקרטית (צילום, פרסום, קונים שכבר מחפשים, דוח שבועי), תקופת בלעדיות קצרה עם יציאה, ושאלה כנה על מה קרה בחודשיים שפרסם לבד.",
    },
    opening:
      "בלעדיות? אני מפרסם לבד כבר חודשיים, למה שאתן למישהו מונופול על הדירה שלי? תביא קונה — תקבל עמלה.",
    goal: "לשאול מה קרה בחודשיים האחרונים, לומר מה הבלעדיות נותנת לו (תוכנית, דוח, קונים שכבר מחפשים), ולהציע בלעדיות קצרה עם יציאה.",
    fallbackLines: [
      "קיבלתי הרבה פניות, רובן ממתווכים. קונים? שניים, שלא חזרו.",
      "ומה אתה עושה בשלושה חודשים שאני לא יכול לעשות לבד?",
      "חודשיים עם יציאה אם אין סיורים — על זה אפשר לדבר. תשלח לי את התוכנית.",
    ],
    check: {
      key: "value",
      label: "אמרת מה הבלעדיות נותנת לו",
      test: (text) =>
        /(שיווק|פרסום|צילום|תוכנית|דוח|עדכון|קונים ש|מה אני עושה|יציאה|תקופה קצרה)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „מה קרה בחודשיים האלה — כמה קונים אמיתיים הגיעו לסיור? הנה מה שאני עושה בשבועיים הראשונים, ובלעדיות של חודשיים עם יציאה אם אין סיורים.”",
  },
  {
    code: "buyer_hesitant",
    label: "קונה שמתלבט",
    blurb: "קונה שראה את הדירה פעמיים ואומר „נחשוב על זה”.",
    counterpart: {
      name: "רוני",
      role: "קונה שראה דירה פעמיים עם בת הזוג, ועכשיו „חושב”",
      stance:
        "הדירה מוצאת חן, אבל יש משהו שמפריע ולא נאמר: המשכנתא גדולה ממה שתכננו, וההורים אמרו „אל תמהרו”. יגיד „נחשוב על זה” עד שישאלו אותו מה באמת מפריע.",
      convincedBy:
        "שאלה ישירה ורכה על מה עוצר, הכרה בחשש, והצעה לצעד קטן שמפחית סיכון — סיור שלישי עם ההורים, שיחה עם יועץ משכנתאות, או להבין מה קורה אם מחכים.",
    },
    opening:
      "אהבנו את הדירה, באמת. אבל אנחנו צריכים לחשוב על זה עוד קצת. נחזור אליך.",
    goal: "לא ללחוץ — לשאול מה באמת מפריע, להכיר בזה, ולהציע צעד קטן שמקדם (סיור עם מי שמחליט איתו, יועץ, תאריך).",
    fallbackLines: [
      "לא, הכול בסדר עם הדירה. פשוט החלטה גדולה.",
      "האמת? ההורים שלי אמרו לא למהר, והמשכנתא יצאה יותר ממה שחשבנו.",
      "סיור עם ההורים ביום שישי — כן, זה יעזור. תבדוק אם אפשר.",
    ],
    check: {
      key: "dug",
      label: "שאלת מה באמת עוצר",
      test: (text) =>
        /(מה (באמת |הכי |בעצם )?(מפריע|חסר|מונע|מטריד|עוצר|מעכב)|מה היה גורם|מה צריך לקרות|מה הספק|מה החשש)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „ברור, זו החלטה גדולה. מה מבין כל הדברים הכי מטריד עכשיו — המחיר, המשכנתא, או משהו בדירה עצמה?”",
  },
  {
    code: "buyer_lowball",
    label: "קונה עם הצעה נמוכה",
    blurb: "קונה שרוצה להציע 15% מתחת למחיר — „ככה עושים, לא?”.",
    counterpart: {
      name: "דני",
      role: "קונה בפעם הראשונה, קרא באינטרנט ש„תמיד מציעים 15% פחות”",
      stance:
        "רוצה את הדירה, אבל בטוח שלהציע נמוך זה החוכמה. אין לו נתונים — יש לו כלל אצבע. יתעקש עד שיראה שההצעה שלו תיפול ומה זה יעלה לו.",
      convincedBy:
        "שאלה על מה ההצעה מבוססת, נתונים על מה נסגר באזור מול המבוקש, והסבר מה מוכר עושה עם הצעה שנתפסת כלא רצינית — ואז הצעה אמיתית עם טווח.",
    },
    opening: "המחיר 2.2? אני מציע 1.87. ככה עושים, מתחילים נמוך. תעביר להם.",
    goal: "לשאול על מה ההצעה מבוססת, להביא נתונים על מה נסגר באזור, להסביר מה קורה להצעה שנתפסת כלא רצינית, ולבנות איתו הצעה שיש לה סיכוי.",
    fallbackLines: [
      "על מה מבוסס? ככה כולם עושים. אף אחד לא משלם מחיר מלא.",
      "ומה, המוכר יעלב? שיגיד מספר. זה משא ומתן.",
      "טוב. אם באזור נסגר 3–4 אחוז מתחת למבוקש — תגיד לי מה מספר שלא יעיף אותנו מהשולחן.",
    ],
    check: {
      key: "basis",
      label: "בדקת על מה ההצעה מבוססת",
      test: (text) =>
        /(מה מבוסס|על מה|למה דווקא|מה התקציב|כמה את|גמיש|טווח|מה נסגר|נסגר ב)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „על מה ה-1.87 מבוסס? באזור הזה נסגר בחצי שנה האחרונה 3–4 אחוז מתחת למבוקש. הצעה של 15% פחות בדרך כלל לא מקבלת תשובה בכלל — ואז איבדנו את הדירה. בוא נבנה מספר שפותח משא ומתן.”",
  },
  {
    code: "lead_cold",
    label: "ליד שאומר „רק מתעניין”",
    blurb: "פנייה מהמודעה שאומרת „רק מסתכל, לא דחוף” — ומנתקת בעוד רגע.",
    counterpart: {
      name: "שחר",
      role: "פנה מהמודעה, בין פגישות, לא רוצה למכור לו כלום",
      stance:
        "באמת מחפש — דירה לילדים, תקציב 1.8 — אבל שונא שמוכרים לו, ואומר „רק מתעניין” כדי לסיים מהר. ייפתח לשאלה אחת קצרה ומעניינת, וייסגר להצגה עצמית ארוכה.",
      convincedBy:
        "שאלה אחת קצרה שנוגעת בו (אזור, חדרים, מתי), בלי מונולוג, והצעה לשלוח שניים-שלושה נכסים בלי התחייבות.",
    },
    opening:
      "היי, ראיתי את המודעה של הדירה ברחוב הרצל. רק מתעניין, לא משהו דחוף. כמה היא?",
    goal: "לענות קצר, לשאול שאלה אחת שפותחת (מה מחפש, איזה אזור, מתי), ולסגור על שליחת 2–3 נכסים — בלי מונולוג.",
    fallbackLines: [
      "אה, בסדר. תשלח לי בוואטסאפ, אני אסתכל.",
      "לילדים, בעצם. תקציב בערך 1.8. אבל לא ממהרים.",
      "כן, תשלח שניים-שלושה כאלה ונדבר בשבוע הבא.",
    ],
    check: {
      key: "opened",
      label: "שאלת שאלה אחת שפותחת",
      test: (text) =>
        /(מה מחפש|איזה אזור|תקציב|מתי|כמה חדרים|מה חשוב|בשביל מי|למי)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „2.2. שאלה אחת — זה בשבילך או לילדים? יש לי שניים-שלושה דומים באזור, אשלח בוואטסאפ בלי שום התחייבות.”",
  },
  {
    code: "commission",
    label: "בקשה להנחה בעמלה",
    blurb: "לקוח שאומר „המתווך השני לוקח אחוז, למה אתה שניים?”.",
    counterpart: {
      name: "עמית",
      role: "מוכר שקיבל הצעה ממתווך אחר — „אחוז אחד בלבד”",
      stance:
        "לא מבין מה ההבדל בין מתווך למתווך — כולם „מעלים למודעה”. אם המתווך ייכנס למלחמת מחירים, הוא יבחר בזול; אם יבין מה הוא מקבל, ישלם.",
      convincedBy:
        "הסבר קונקרטי מה העמלה כוללת ומה זה שווה במחיר הסופי (משא ומתן, קונים מוכנים, זמן), בלי לזלזל במתווך השני, ובלי להתקפל.",
    },
    opening:
      "תראה, מתווך אחר הציע לי אחוז אחד. אתה מבקש שניים. למה שאשלם כפול על אותה מודעה ביד2?",
    goal: "לא להתקפל ולא לזלזל — להסביר מה העמלה כוללת ומה היא שווה במחיר הסופי, ולתת דוגמה.",
    fallbackLines: [
      "כולם אומרים שהם מנהלים משא ומתן. מה ההבדל בפועל?",
      "ואם אתה לא מביא יותר מהמתווך השני — למה שאשלם כפול?",
      "טוב, זה נשמע יותר מ„מודעה”. תראה לי דוגמה של עסקה שסגרת ככה.",
    ],
    check: {
      key: "worth",
      label: "הסברת מה העמלה כוללת",
      test: (text) =>
        /(מה כלול|כולל|מה אני עושה|שווה|שיווק|משא ומתן|חוסך|ניסיון|תוצאה|במחיר הסופי|קונים מוכנים)/u.test(
          text,
        ),
    },
    tip: "לנסות בשיחה הבאה: „ההבדל לא במודעה — במה שקורה אחריה. בעסקה האחרונה שלי המשא ומתן הוסיף 60 אלף למחיר. זה מה שהאחוז הנוסף קונה.”",
  },
];

export function practiceScenario(code: string): PracticeScenarioInfo | null {
  return PRACTICE_SCENARIO_INFO.find((s) => s.code === code) ?? null;
}

/** התור הראשון — הדמות פותחת. */
export function practiceOpening(scenario: PracticeScenarioInfo): PracticeTurn {
  return { role: "counterpart", text: scenario.opening };
}

/** תשובת הדמות בלי מודל — לפי מספר התורים של המתווך, ואז חוזרות. */
export function practiceFallbackReply(
  scenario: PracticeScenarioInfo,
  agentTurns: number,
): string {
  const lines = scenario.fallbackLines;
  return lines[Math.max(0, agentTurns - 1) % lines.length]!;
}

function agentTexts(turns: readonly PracticeTurn[]): string[] {
  return turns.filter((t) => t.role === "agent").map((t) => t.text);
}

export interface PracticeCheckResult {
  key: string;
  label: string;
  met: boolean;
}

/** הרשימה הקבועה — הכלליות ואז זו של התרחיש. */
export function practiceChecklist(
  scenario: PracticeScenarioInfo,
  turns: readonly PracticeTurn[],
): PracticeCheckResult[] {
  const texts = agentTexts(turns);
  const joined = texts.join("\n");
  return [...PRACTICE_GENERIC_CHECKS, scenario.check].map((check) => ({
    key: check.key,
    label: check.label,
    met: texts.length > 0 && check.test(joined, texts),
  }));
}

export interface MentorPracticeFeedback {
  /** מה עבד — עד שלושה, עובדות מהשיחה */
  worked: string[];
  /** מה פספסת — עד שלושה */
  missed: string[];
  /** משפט אחד לנסות בשיחה הבאה — במילים שאפשר להגיד */
  tryNext: string;
  /** 1–5 */
  score: number;
  checklist: PracticeCheckResult[];
  source: "model" | "checklist";
}

/** „4 מתוך 5” */
export function practiceScoreLabel(score: number): string {
  return `${score} מתוך 5`;
}

/**
 * הציון מהרשימה בלבד — כשאין מודל: אחת עד חמש, לפי כמה מהבדיקות
 * עברו. אפס בדיקות שעברו הוא עדיין 1: תרגלת, וזה שווה משהו.
 */
export function practiceChecklistScore(
  checklist: readonly PracticeCheckResult[],
): number {
  const met = checklist.filter((c) => c.met).length;
  return Math.max(
    1,
    Math.min(5, Math.round(1 + (4 * met) / Math.max(1, checklist.length))),
  );
}

/** המשוב בלי מודל — הרשימה כפי שהיא, והטיפ של התרחיש. */
export function practiceFallbackFeedback(
  scenario: PracticeScenarioInfo,
  turns: readonly PracticeTurn[],
): MentorPracticeFeedback {
  const checklist = practiceChecklist(scenario, turns);
  return {
    worked: checklist.filter((c) => c.met).map((c) => c.label),
    missed: checklist.filter((c) => !c.met).map((c) => c.label),
    tryNext: scenario.tip,
    score: practiceChecklistScore(checklist),
    checklist,
    source: "checklist",
  };
}

/* ---------- הפרומפטים ---------- */

export const PRACTICE_REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "מה הדמות אומרת עכשיו, בעברית מדוברת, משפט אחד או שניים",
    },
    closing: {
      type: "boolean",
      description:
        "true רק כשהדמות השתכנעה והסכימה לצעד הבא, או כשהחליטה לסיים את השיחה",
    },
  },
  required: ["reply", "closing"],
};

function transcript(
  scenario: PracticeScenarioInfo,
  turns: readonly PracticeTurn[],
): string[] {
  return turns.map(
    (t) =>
      `${t.role === "agent" ? "המתווך" : scenario.counterpart.name}: ${t.text}`,
  );
}

/**
 * הדמות עונה. הכללים: אמיתי ולא קל, בגוף ראשון, לא יוצא מהתפקיד,
 * ולא מדריך — ההדרכה היא של המנטור, בסוף.
 */
export function buildPracticeReplyPrompt(
  scenario: PracticeScenarioInfo,
  turns: readonly PracticeTurn[],
): string {
  const c = scenario.counterpart;
  return [
    `אתם משחקים תפקיד בתרגול שיחה של מתווך/ת נדל"ן. אתם ${c.name} — ${c.role}.`,
    `העמדה שלכם: ${c.stance}`,
    `מה באמת ישכנע אתכם (לא לגלות למתווך): ${c.convincedBy}`,
    "כללים מחייבים:",
    `1. דברו בגוף ראשון, כ${c.name}, בעברית מדוברת וטבעית. משפט אחד או שניים — כמו בטלפון, לא נאום.`,
    "2. אתם אמיתיים ולא קלים: עונים למה שהמתווך אמר בפועל, לא למה שהייתם רוצים לשמוע. מתרככים רק כשיש סיבה — נתון, הקשבה, צעד ברור. משפט ריק („אני מבין אותך”) בלי תוכן אינו סיבה.",
    "3. לא יוצאים מהתפקיד, לא מדריכים את המתווך ולא מעריכים אותו. אין הערות בסוגריים.",
    "4. כשפונים למתווך — פעלים בעבר או „שלך”, בלי „אתה/את”, כדי לא לנחש מין.",
    "5. closing=true רק כשהשתכנעתם והסכמתם לצעד הבא, או כשהחלטתם שנגמר (למשל אחרי שהמתווך התקפל לגמרי או התעלם מכם שלוש פעמים). אחרת false.",
    "",
    "השיחה עד כה:",
    ...transcript(scenario, turns),
    "",
    "ענו ב-JSON עם reply ו-closing.",
  ].join("\n");
}

export const PRACTICE_FEEDBACK_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    worked: {
      type: "array",
      items: { type: "string" },
      description:
        "מה עבד — עד שלושה משפטים קצרים, כל אחד עובדה מהשיחה עם ציטוט קצר של המתווך",
    },
    missed: {
      type: "array",
      items: { type: "string" },
      description: "מה פספס — עד שלושה, כל אחד עם מה היה אפשר לומר במקום",
    },
    tryNext: {
      type: "string",
      description:
        "משפט אחד לנסות בשיחה האמיתית הבאה — במילים שאפשר להגיד כמו שהן, במירכאות",
    },
    score: { type: "integer", description: "1 עד 5" },
  },
  required: ["worked", "missed", "tryNext", "score"],
};

/**
 * המשוב — בקול של המנטור ובסגנון שהמתווך בחר. הרשימה של הקוד נכנסת
 * לפרומפט כדי שהמודל לא יסתור אותה, ויוסיף עליה את מה שרק קריאה של
 * השיחה רואה.
 */
export function buildPracticeFeedbackPrompt(
  scenario: PracticeScenarioInfo,
  turns: readonly PracticeTurn[],
  checklist: readonly PracticeCheckResult[],
  persona: MentorPersona = DEFAULT_MENTOR_PERSONA,
): string {
  return [
    'אתם המנטור האישי של מתווך/ת נדל"ן במערכת „מתווכים”. המתווך סיים עכשיו תרגול שיחה, ואתם נותנים משוב.',
    `התרחיש: ${scenario.label} — ${scenario.blurb} הצד השני היה ${scenario.counterpart.name}, ${scenario.counterpart.role}.`,
    `מה נחשב הצלחה בתרחיש הזה: ${scenario.goal}`,
    "כללים מחייבים:",
    "1. עובדה, לא שיפוט: מצטטים מה המתווך אמר ואומרים מה זה עשה. אין „מעט”, „רק”, „חבל”.",
    "2. מה עבד קודם — בשמו. ייחוס למאמץ ולתהליך, לא ליכולת.",
    "3. מה פספס — עד שלושה דברים, ולכל אחד מה היה אפשר לומר במקום. לא רשימת מכולת.",
    "4. tryNext הוא משפט אחד שאפשר להגיד בטלפון כמו שהוא — במירכאות, בגוף ראשון של המתווך.",
    "5. פנייה בגוף שני יחיד בלי מין: פעלים בעבר (שאלת, הצעת, הבאת), „שלך”. לא „אתה/את”. בלי אימוג'י, בלי כותרות.",
    "6. הציון 1–5: 5 = הצד השני השתכנע בזכות מה שנאמר; 3 = השיחה זזה אבל בלי סגירה; 1 = התקפלות או התעלמות. הרשימה שלמטה היא עוגן — לא לסתור אותה.",
    `7. ${mentorStyleGuidance(persona.style)}`,
    mentorNameLine(persona),
    "",
    "מה הקוד בדק בשיחה:",
    ...checklist.map((c) => `- ${c.label}: ${c.met ? "כן" : "לא"}`),
    "",
    "השיחה:",
    ...transcript(scenario, turns),
    "",
    "ענו ב-JSON עם worked, missed, tryNext ו-score.",
  ].join("\n");
}

/** מה שהמודל החזיר, אחרי הסכמה — ממוזג עם הרשימה של הקוד. */
export function practiceModelFeedback(
  raw: { worked: string[]; missed: string[]; tryNext: string; score: number },
  checklist: PracticeCheckResult[],
): MentorPracticeFeedback {
  return {
    worked: raw.worked.slice(0, 3),
    missed: raw.missed.slice(0, 3),
    tryNext: raw.tryNext,
    score: Math.max(1, Math.min(5, Math.round(raw.score))),
    checklist,
    source: "model",
  };
}

/* ---------------- תרגול מהוואטסאפ (docs/14 §7.3) ---------------- */

/**
 * ‎**התרגול הוא שיחה, ולכן וואטסאפ הוא מקומו הטבעי.**
 *
 * ‏במסך הוא עובד כבר: המנטור משחק את הצד השני, המתווך עונה, ובסוף
 * ‏מגיע משוב. אבל מתווך שרוצה לתרגל שיחה עם מוכר עושה את זה בין
 * ‏פגישות, מהטלפון — ושם, עד עכשיו, התרגול פשוט לא היה קיים.
 *
 * ‏מה שכאן הוא **הניסוח בלבד**. השירות, המכסה, והמשוב זהים לחלוטין
 * ‏לאלה של המסך: תרגול שהתחיל בוואטסאפ נגמר במסך ולהפך, כי זו אותה
 * ‏שורה במסד. שכפול של הלוגיקה היה מייצר שני תרגולים שונים באותו שם.
 */

/** ‏המילים שמסיימות תרגול — כלשונן, כמו „דלג” ו„בטל”. */
const PRACTICE_END_WORDS = new Set([
  "סיום",
  "סיים",
  "תסיים",
  "מספיק",
  "סיימתי",
  "די",
  "עצור",
  "משוב",
]);

/**
 * ‎`normalize` נמסר על ידי הקורא ולא מיובא: החבילה המשותפת אינה
 * ‏מכירה את נרמול הטקסט של הוואטסאפ, ושכפול שלו כאן היה מייצר שני
 * ‏כללי נרמול שיסטו זה מזה.
 */
export function isPracticeEndMessage(
  text: string,
  normalize: (value: string) => string,
): boolean {
  return PRACTICE_END_WORDS.has(normalize(text));
}

/** ‏פתיחת תרגול — מי הדמות, מה המטרה, ואיך מסיימים. */
export function practiceChatOpening(scenario: PracticeScenarioInfo): string {
  return [
    `🎭 תרגול: ${scenario.label}`,
    scenario.blurb,
    "",
    `${scenario.counterpart.name} (${scenario.counterpart.role}):`,
    `„${scenario.opening}”`,
    "",
    `המטרה: ${scenario.goal}`,
    "ענו כמו בשיחה אמיתית. „סיום” בכל שלב — ואתן משוב.",
  ].join("\n");
}

/**
 * ‏תור של הדמות. `left` הוא כמה תורים נשארו, ונאמר רק כשהוא קטן —
 * ‏„נשארו 6” באמצע תרגול הוא רעש, „נשאר אחד” הוא מידע.
 */
export function practiceChatTurn(
  counterpartName: string,
  line: string,
  left: number,
): string {
  const tail =
    left <= 0
      ? "\n\n(זה היה התור האחרון — שלחו „סיום” למשוב)"
      : left <= 2
        ? `\n\n(נשאר ${left === 1 ? "תור אחד" : "עוד תור או שניים"}, ואז משוב)`
        : "";
  return `${counterpartName}: „${line}”${tail}`;
}

/** ‏המשוב בסוף — אותו תוכן שהמסך מציג, בשורות. */
export function practiceChatFeedback(
  scenarioLabel: string,
  feedback: MentorPracticeFeedback,
): string {
  const lines = [`🎭 ${scenarioLabel} — ${practiceScoreLabel(feedback.score)}`];
  if (feedback.worked.length > 0) {
    lines.push("", "מה עבד:", ...feedback.worked.map((item) => `✅ ${item}`));
  }
  if (feedback.missed.length > 0) {
    lines.push("", "מה פספסת:", ...feedback.missed.map((item) => `↗️ ${item}`));
  }
  lines.push("", `לנסות בשיחה הבאה: ${feedback.tryNext}`);
  return lines.join("\n");
}

/** ‏תרגול שנסגר בלי משוב — נטישה, לא כישלון. */
export const PRACTICE_CHAT_ABANDONED =
  "התרגול נסגר בלי משוב. אפשר להתחיל חדש: „תרגל איתי מוכר על המחיר”.";

/** ‏רשימת התרחישים לבחירה, כשלא נאמר איזה. */
export function practiceChatMenu(): string {
  return [
    "על מה נתרגל? אפשר לומר את השם:",
    ...PRACTICE_SCENARIO_INFO.map((info) => `• ${info.label} — ${info.blurb}`),
  ].join("\n");
}
