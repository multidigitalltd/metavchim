/**
 * הפרסונה של המנטור — שם וסגנון ליווי, לפי בחירת המשתמש (docs/14 §4.1).
 *
 * ## למה זה של המשתמש ולא של המשרד
 *
 * המנטור הוא של המתווך: רק מולו, אף פעם לא מול אחרים. גם השם והסגנון
 * — מי שרוצה מנטור ישיר לא צריך את הסכמת המשרד. ההעדפה יושבת
 * ב-`preferences.mentor` של המשתמש, כמו הנגישות, ולכן נוסעת איתו בין
 * מכשירים ואינה דורשת מיגרציה.
 *
 * ## מה הסגנון משנה בפועל
 *
 * לא רק מילה בכותרת. חמישה מקומות קוראים אותו: הפתיח והסיום של הבוקר,
 * הפתיח של הסיכום השבועי, הסיום של דחיפת אמצע השבוע, הנחיית הטון
 * בפרומפט של השיחה — והקצב: הסגנון הרגוע מוותר על הודעת הבוקר. הכללים
 * המחייבים (§4: עובדה ולא שיפוט, רק מולך, ייחוס למאמץ) אינם משתנים
 * בשום סגנון; משתנה איך אומרים, לא מה.
 */

export const MENTOR_STYLES = [
  "warm",
  "direct",
  "challenging",
  "analytic",
  "calm",
] as const;
export type MentorStyle = (typeof MENTOR_STYLES)[number];

export interface MentorStyleInfo {
  code: MentorStyle;
  label: string;
  /** משפט אחד — מה מקבלים */
  blurb: string;
  /** דוגמה לניסוח — כדי לבחור באוזן, לא רק בשם */
  sample: string;
}

export const MENTOR_STYLE_INFO: readonly MentorStyleInfo[] = [
  {
    code: "warm",
    label: "תומך",
    blurb: "חם ומעודד. מתחיל במה שכן, ואומר את הקשה ברכות — בלי לוותר עליו.",
    sample: "2 הצעות מתוך 5. עוד אפשר להגיע לזה — ואני איתך.",
  },
  {
    code: "direct",
    label: "ישיר",
    blurb: "קצר ותכליתי. העובדה, הפער, הפעולה — בלי ריכוך ובלי מחמאות מיותרות.",
    sample: "2 מתוך 5. חסרות 3. שעה של הצעות היום סוגרת את זה.",
  },
  {
    code: "challenging",
    label: "מאתגר",
    blurb: "מצפה ליותר. מציע להעלות רף, ושואל מה ימנע ממך לעשות עוד אחד.",
    sample: "2 מתוך 5 — ולמה לא 6? הפער נסגר בעבודה, לא בהמתנה.",
  },
  {
    code: "analytic",
    label: "אנליטי",
    blurb: "מדבר במספרים: יחסים, משפך, מה זז ולמה. כל עצה מנומקת בנתון שלך.",
    sample:
      "2 מתוך 5, 40% אחרי 60% מהשבוע. כל 3 הצעות שלך הופכות לסיור — 3 הצעות היום שוות סיור.",
  },
  {
    code: "calm",
    label: "רגוע",
    blurb:
      "מעט מילים, טון שקט, בלי הודעת בוקר. סיכום שבועי, דחיפה אחת באמצע, וחגיגות.",
    sample: "2 מתוך 5. צעד אחד היום מספיק.",
  },
];

export const MENTOR_DEFAULT_NAME = "המנטור";
/** אורך השם — כותרת התראה, לא שם משפחה ארוך */
export const MENTOR_NAME_MAX = 24;

export interface MentorPersona {
  /** איך המתווך קורא למנטור — ברירת המחדל „המנטור” */
  name: string;
  style: MentorStyle;
}

export const DEFAULT_MENTOR_PERSONA: Readonly<MentorPersona> = {
  name: MENTOR_DEFAULT_NAME,
  style: "warm",
};

function isMentorStyle(value: unknown): value is MentorStyle {
  return (
    typeof value === "string" &&
    (MENTOR_STYLES as readonly string[]).includes(value)
  );
}

/**
 * מה-preferences של המשתמש (`{ mentor: { name, style } }`) לפרסונה —
 * סלחני: ערך חסר או פגום נופל לברירת המחדל, לא לשגיאה. שם ריק או
 * ארוך מדי נחתך/מוחלף; סגנון שאינו ברשימה הוא „תומך”.
 */
export function resolveMentorPersona(preferences: unknown): MentorPersona {
  const raw =
    typeof preferences === "object" && preferences !== null
      ? (preferences as { mentor?: unknown }).mentor
      : undefined;
  if (typeof raw !== "object" || raw === null)
    return { ...DEFAULT_MENTOR_PERSONA };
  const { name, style } = raw as { name?: unknown; style?: unknown };
  const trimmed =
    typeof name === "string" ? name.trim().slice(0, MENTOR_NAME_MAX) : "";
  return {
    name: trimmed === "" ? MENTOR_DEFAULT_NAME : trimmed,
    style: isMentorStyle(style) ? style : DEFAULT_MENTOR_PERSONA.style,
  };
}

/** האם המתווך נתן שם — רק אז המנטור מציג את עצמו בשם. */
export function mentorHasName(persona: MentorPersona): boolean {
  return persona.name.trim() !== "" && persona.name !== MENTOR_DEFAULT_NAME;
}

/**
 * הפתיח בשם — „בוקר טוב דנה, כאן נועה.” / „בוקר טוב דנה.” / „בוקר טוב.”
 * ‎`salute` הוא הברכה („בוקר טוב”, „היי”); המנטור מציג את עצמו רק
 * כשיש לו שם, וגם אז במילה — לא בחתימה.
 */
export function mentorSalutation(
  salute: string,
  firstName: string | undefined,
  persona: MentorPersona,
): string {
  const name = (firstName ?? "").trim();
  const who = name === "" ? salute : `${salute} ${name}`;
  return mentorHasName(persona) ? `${who}, כאן ${persona.name}.` : `${who}.`;
}

/**
 * הסיום של הודעה יומית או דחיפה — לפי הסגנון, ולפי אם יש פיגור.
 * אותו מסר בכולם („זה אפשרי”), בקול אחר.
 */
export function mentorCloser(style: MentorStyle, behind: boolean): string {
  switch (style) {
    case "direct":
      return behind ? "זה בהישג יד. לעבודה." : "יום טוב. הלאה.";
    /*
     * בלי טענות על היתכנות („הפער קטן מיום עבודה”): הסיום אינו יודע כמה
     * חסר ולא כמה זמן נשאר, ויעד של 200 ביום שישי היה מקבל הבטחה
     * שקרית (ביקורת Codex). הקול שונה — המסר הוא „לפעול”, לא „יספיק”.
     */
    case "challenging":
      return behind
        ? "הפער לא נסגר מעצמו — ולך יש מה לעשות איתו היום."
        : "בקצב — ועכשיו השאלה כמה מעל.";
    case "analytic":
      return behind
        ? "המספרים לא זזים לבד — כל פעולה היום משנה את היחס."
        : "המספרים בסדר. ממשיכים באותו קצב.";
    case "calm":
      return behind ? "צעד אחד היום מספיק." : "יום טוב.";
    case "warm":
    default:
      return behind ? "עוד אפשר להגיע לזה — ואני איתך." : "יום טוב — ואני כאן.";
  }
}

export type MentorGreetingMood = "celebrate" | "encourage" | "steady";

/**
 * הפתיח של הסיכום השבועי — „היי דנה, …” לפי הסגנון ומצב הרוח של
 * הסיכום. ‎`null` בלי שם פרטי: הסיכום מתחיל מהגוף, כמו היום.
 */
export function mentorWeeklyGreeting(
  persona: MentorPersona,
  mood: MentorGreetingMood,
  firstName: string | undefined,
): string | null {
  const name = (firstName ?? "").trim();
  if (name === "") return null;
  const hi = mentorHasName(persona)
    ? `היי ${name}, כאן ${persona.name}.`
    : `היי ${name},`;
  const tail = ((): string => {
    switch (persona.style) {
      case "direct":
        return mood === "celebrate"
          ? "שבוע עם תוצאה."
          : mood === "encourage"
            ? "השבוע שלך, ומה עושים עם זה."
            : "השבוע שלך.";
      case "challenging":
        return mood === "celebrate"
          ? "שבוע חזק — ויש לאן לעלות."
          : mood === "encourage"
            ? "השבוע לא יצא. השבוע הבא הוא ההזדמנות."
            : "שבוע בקצב. אפשר יותר.";
      case "analytic":
        return mood === "celebrate"
          ? "המספרים של השבוע — ויש בהם תוצאה."
          : "המספרים של השבוע.";
      case "calm":
        return "השבוע שלך.";
      case "warm":
      default:
        return mood === "celebrate"
          ? "איזה שבוע היה לך."
          : mood === "encourage"
            ? "הנה השבוע שלך — נעבור עליו ביחד."
            : "הנה השבוע שלך.";
    }
  })();
  // „היי דנה, איזה שבוע” — פסיק; „היי דנה, כאן נועה. איזה שבוע” — נקודה כבר שם
  return `${hi} ${tail}`;
}

/** הקצב לפי הסגנון — הרגוע מוותר על הבוקר; השאר מקבלים הכול. */
export function mentorCadence(style: MentorStyle): { morning: boolean } {
  return { morning: style !== "calm" };
}

/**
 * הנחיית הטון לפרומפט של השיחה — פסקה אחת לפי הסגנון. הכללים
 * המחייבים נשארים; זו רק הדרך לומר.
 */
export function mentorStyleGuidance(style: MentorStyle): string {
  switch (style) {
    case "direct":
      return "הסגנון שהמתווך בחר: ישיר. קצר ותכליתי — העובדה, הפער, הפעולה. בלי ריכוך, בלי מחמאות מיותרות, בלי „אולי”. משפט עד שניים.";
    case "challenging":
      return "הסגנון שהמתווך בחר: מאתגר. לצפות ליותר — להציע להעלות רף, לשאול מה ימנע ממנו לעשות עוד אחד, לחגוג קצר ולהמשיך הלאה. תובעני, לעולם לא מזלזל.";
    case "analytic":
      return "הסגנון שהמתווך בחר: אנליטי. לדבר במספרים — יחסים, המשפך, מה זז ולמה; כל עצה מנומקת בנתון של המתווך עצמו. בלי רגש מיותר, בלי ניחושים.";
    case "calm":
      return "הסגנון שהמתווך בחר: רגוע. מעט מילים, טון שקט, בלי דחיפות ובלי סימני קריאה. משפט אחד או שניים — מה שחשוב בלבד.";
    case "warm":
    default:
      return "הסגנון שהמתווך בחר: תומך. חם ומעודד — להתחיל במה שכן, לומר את הקשה ברכות ובלי לוותר עליו, ולסיים בכך שהמנטור איתו.";
  }
}

/** הצגה עצמית בפרומפט — „שמכם: נועה” רק כשיש שם; אחרת „המנטור”. */
export function mentorNameLine(persona: MentorPersona): string {
  return mentorHasName(persona)
    ? `השם שהמתווך נתן לכם: „${persona.name}”. כך הוא פונה אליכם — הציגו את עצמכם בשם הזה כשזה טבעי, בלי לחזור עליו בכל תשובה.`
    : "אין לכם שם — המתווך קורא לכם „המנטור”.";
}
