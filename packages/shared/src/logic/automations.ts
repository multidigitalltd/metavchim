/**
 * האוטומציות הפנימיות — מה המערכת עושה מעצמה, בשליטת המשרד.
 *
 * ## למה הקובץ הזה נולד
 *
 * המערכת כבר הריצה שמונה אוטומציות: ליד שלא נענה מוסלם, ליד שהתקרר
 * מחומם, הצעה שנפתחה ולא נענתה מקבלת פולו-אפ, נכס שיורד משיווק שולח
 * חלופה לקונה, ועוד. כולן היו **קבועות בקוד ובלתי נראות**: המשרד לא
 * ידע שהן קיימות, לא יכול היה לכבות אחת מהן, והספים שלהן היו משתני
 * סביבה — כלומר זהים לכל המשרדים במערכת.
 *
 * זה נראה למתווך כמו "המערכת יצרה לי משימה שלא ביקשתי". אוטומציה
 * שאי אפשר לראות ולכבות אינה עוזרת, היא מטרידה — ומשרד שמוצף
 * משימות אוטומטיות מפסיק להסתכל על **כל** המשימות, כולל אלה שהוא
 * כן יצר.
 *
 * ## מה כאן ומה לא
 *
 * כאן הקטלוג בלבד: מה קיים, מה כל אחת עושה במילים של מתווך, ואיזה
 * מספר אפשר לכוון בה. ההרצה עצמה נשארה ב-Worker, וההגדרה נשמרת
 * ב-`tenants.settings` — בדיוק כמו משקלי ההתאמה.
 *
 * הקטלוג הוא **מקום אחד** שגם המסך, גם ה-API וגם ה-Worker קוראים
 * ממנו. שלוש רשימות נפרדות היו נפרדות בפועל ביום שמוסיפים אוטומציה,
 * והתוצאה הייתה מסך שמבטיח שליטה על משהו שאף אחד לא אוכף.
 */

import {
  DEFAULT_VIEWING_REMINDER_MESSAGES,
  VIEWING_REMINDER_DEFAULT_HOURS,
  VIEWING_REMINDER_TEXT_MAX,
  type ViewingReminderChannel,
} from "./viewing-reminder.js";

/** מפתח אוטומציה — נשמר ב-DB, ולכן אינו משתנה אחרי שיצא לאוויר. */
export type AutomationKey =
  | "lead_sla"
  | "stale_lead"
  | "offer_followup"
  | "viewing_followup"
  | "property_delisted"
  | "daily_brief"
  | "weekly_summary"
  | "exclusivity"
  | "missed_call_intake"
  | "viewing_reminder";

/** יחידת הסף שאפשר לכוון. `null` = לאוטומציה אין מספר, רק כן/לא. */
export type AutomationUnit = "hours" | "days" | null;

export interface AutomationSpec {
  key: AutomationKey;
  /** מה זה, בשורה — הכותרת שהמשרד רואה. */
  title: string;
  /** מה קורה בפועל, בניסוח שאומר גם *מה נוצר* ולמי. */
  what: string;
  /**
   * מתי היא רצה — הבהרה שמונעת את השאלה "למה זה לא קרה מיד".
   */
  when: string;
  unit: AutomationUnit;
  /** ברירת המחדל של הסף; חסר כשאין סף. */
  defaultValue?: number;
  min?: number;
  max?: number;
  /**
   * ‎**האוטומציה שולחת ללקוח, ולכן יש לה ערוץ ונוסח.**
   *
   * רוב האוטומציות כאן פותחות משימה או התראה — כלומר פונות פנימה,
   * למשרד. מי שפונה **החוצה** צריכה שתי הכרעות נוספות שאין לשאר:
   * באיזה אמצעי, ובאילו מילים. הן יושבות על אותה הגדרה ולא במקום
   * שלישי, כי הן חלק מ„איך האוטומציה הזו מתנהגת”.
   *
   * ‎`audiences` הן תיבות הנוסח שהמסך מציג. אוטומציה עם שני נמענים
   * שונים צריכה שני נוסחים — „מגיעים אליך” אינו „אנחנו נפגשים”.
   */
  outbound?: {
    audiences: readonly { key: string; title: string; defaultText: string }[];
  };
  /**
   * אוטומציה שאסור לכבות.
   *
   * התראות הבלעדיות הן היחידות כאלה: מועד השליש ותום הבלעדיות הם
   * מועדים שנובעים מחוזה שהמשרד חתם עליו, ומשרד שיכבה אותם יגלה
   * שהבלעדיות פגה רק כשהמוכר יתקשר לשאול. שליטה שמאפשרת לפספס
   * תאריך חוזי אינה שליטה, היא מלכודת.
   */
  required?: boolean;
}

export const AUTOMATIONS: readonly AutomationSpec[] = [
  {
    key: "lead_sla",
    title: "ליד חדש שלא נענה",
    what: "נפתחת משימה דחופה לסוכן האחראי, ומנהל המשרד מקבל התראה.",
    when: "כשעברו X שעות מכניסת הליד בלי מענה ראשון.",
    unit: "hours",
    defaultValue: 2,
    min: 1,
    max: 72,
  },
  {
    key: "stale_lead",
    title: "ליד שהתקרר",
    what: "נפתחת משימה לחזור אל הלקוח, עם התראה לסוכן שהליד שלו.",
    when: "כשליד בטיפול לא זז X ימים. נבדק פעם ביום.",
    unit: "days",
    defaultValue: 7,
    min: 1,
    max: 90,
  },
  {
    key: "offer_followup",
    title: "הצעה נפתחה ולא נענתה",
    what: "נפתחת משימת פולו-אפ לסוכן ששלח את ההצעה.",
    when: "כשעברו X שעות מהרגע שהקונה פתח את ההצעה ולא הגיב.",
    unit: "hours",
    defaultValue: 48,
    min: 1,
    max: 336,
  },
  {
    key: "viewing_followup",
    title: "פולו-אפ אחרי סיור",
    what: "נפתחת משימה לשאול את הקונה איך היה הסיור.",
    when: "X שעות אחרי שהסיור הסתיים.",
    unit: "hours",
    defaultValue: 1,
    min: 1,
    max: 72,
  },
  {
    key: "property_delisted",
    title: "נכס ירד משיווק",
    what: "נפתחת משימה להציע חלופה לכל קונה שהתעניין בו.",
    when: "מיד כשהנכס מסומן כנמכר, הושכר או הוקפא.",
    unit: null,
  },
  {
    key: "daily_brief",
    title: "תקציר יומי",
    what: "התראה עם מה שמחכה היום: פגישות, משימות ולידים ללא מענה.",
    when: "כל בוקר.",
    unit: null,
  },
  {
    key: "weekly_summary",
    title: "סיכום שבועי",
    what: "התראה עם מה שקרה במשרד בשבוע שעבר.",
    when: "פעם בשבוע.",
    unit: null,
  },
  {
    key: "exclusivity",
    title: "מועדי בלעדיות",
    what: "התראה לקראת מועד השליש ולקראת תום הבלעדיות.",
    when: "נבדק פעם ביום מול התאריכים שבחוזה.",
    unit: null,
    required: true,
  },
  {
    key: "missed_call_intake",
    title: "שיחה שלא נענתה — טופס ללקוח",
    what: "שולחת ללקוח בוואטסאפ קישור למילוי מה הוא מחפש. אין תבנית מאושרת ⇒ נפתחת משימה עם ההודעה מוכנה לשליחה.",
    when: "מיד עם קליטת שיחה נכנסת שלא נענתה, ופעם אחת ללקוח כל עוד הקישור הקודם בתוקף.",
    unit: null,
  },
  {
    key: "viewing_reminder",
    title: "תזכורת לפני סיור",
    what: "נשלחת תזכורת למי שגר בנכס ולקונה שקבוע לו סיור. מי שאי אפשר להגיע אליו — נפתחת משימה לסוכן.",
    when: "X שעות לפני מועד הסיור. נבדק כל רבע שעה.",
    unit: "hours",
    defaultValue: VIEWING_REMINDER_DEFAULT_HOURS,
    min: 1,
    max: 48,
    outbound: {
      audiences: [
        {
          key: "occupant",
          title: "למי שגר בנכס",
          defaultText: DEFAULT_VIEWING_REMINDER_MESSAGES.occupant,
        },
        {
          key: "buyer",
          title: "לקונה",
          defaultText: DEFAULT_VIEWING_REMINDER_MESSAGES.buyer,
        },
      ],
    },
  },
];

const BY_KEY = new Map(AUTOMATIONS.map((spec) => [spec.key, spec]));

export function automationSpec(key: AutomationKey): AutomationSpec | undefined {
  return BY_KEY.get(key);
}

/**
 * הגדרת אוטומציה אחת.
 *
 * ‎`value` קיים רק למי שיש לה סף, ו-`channel`/`messages` רק למי
 * שפונה ללקוח (`outbound`). שדות ריקים אצל השאר ולא אובייקט נפרד:
 * „מה האוטומציה הזו עושה” הוא מקום אחד, וגם המסך וגם הסבב קוראים
 * ממנו.
 */
export interface AutomationSetting {
  enabled: boolean;
  value?: number;
  channel?: ViewingReminderChannel;
  /** נוסח פר-נמען. מפתח חסר ⇒ נוסח ברירת המחדל שבקטלוג. */
  messages?: Record<string, string>;
}

export type AutomationSettings = Record<AutomationKey, AutomationSetting>;

/** ברירת המחדל: הכל פועל, בספים שהיו קבועים בקוד עד כה. */
export function defaultAutomationSettings(): AutomationSettings {
  const out = {} as AutomationSettings;
  for (const spec of AUTOMATIONS) {
    out[spec.key] = {
      enabled: true,
      ...(spec.defaultValue === undefined ? {} : { value: spec.defaultValue }),
      /*
       * ‎**וואטסאפ ומייל, ולא אחד מהם.** תזכורת שמגיעה בערוץ אחד
       * בלבד מפספסת בדיוק את הלקוח שאינו חי בערוץ הזה, ואת המשרד
       * זה עולה בנסיעה לשווא. מי שרוצה פחות — מצמצם במסך.
       */
      ...(spec.outbound === undefined
        ? {}
        : {
            channel: "both" as ViewingReminderChannel,
            messages: Object.fromEntries(
              spec.outbound.audiences.map((a) => [a.key, a.defaultText]),
            ),
          }),
    };
  }
  return out;
}

/**
 * קריאת ההגדרה השמורה, סלחנית בכוונה.
 *
 * הערך מגיע מ-JSON שנשמר בעבר, ולכן הוא יכול להיות חסר, חלקי, או
 * מגרסה שבה אוטומציה עדיין לא היה קיימת. **כל חוסר נופל לברירת
 * המחדל ולא מכבה כלום**: אוטומציה שנכבית בשקט בגלל שדה חסר היא
 * בדיוק התקלה שאי אפשר לאבחן — המשרד יגלה אותה כשליד לא ייענה
 * ואף אחד לא יידע.
 *
 * ערך מחוץ לתחום נחתך לתחום ולא נזרק, מאותה סיבה.
 */
export function resolveAutomationSettings(raw: unknown): AutomationSettings {
  const out = defaultAutomationSettings();
  if (typeof raw !== "object" || raw === null) return out;
  const source = raw as Record<string, unknown>;

  for (const spec of AUTOMATIONS) {
    const entry = source[spec.key];
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const current = out[spec.key];
    if (typeof record["enabled"] === "boolean" && spec.required !== true) {
      current.enabled = record["enabled"];
    }
    if (spec.unit !== null && typeof record["value"] === "number") {
      current.value = clampValue(spec, record["value"]);
    }

    if (spec.outbound !== undefined) {
      const channel = record["channel"];
      if (channel === "email" || channel === "whatsapp" || channel === "both") {
        current.channel = channel;
      }
      /*
       * ‎**נוסח ריק נופל לברירת המחדל ואינו נשלח.** משרד שמחק את
       * התיבה התכוון „תחזירו לי את המקורי”, לא „שלחו הודעה ריקה”
       * — והודעה ריקה ללקוח היא בדיוק מה שאי אפשר לתקן אחרי.
       *
       * הנוסח נחתך ולא נזרק, כמו הסף: הגדרה שנשמרה בעבר בגרסה עם
       * תקרה אחרת אינה סיבה להשבית את האוטומציה כולה.
       */
      const messages = record["messages"];
      if (typeof messages === "object" && messages !== null && current.messages) {
        const saved = messages as Record<string, unknown>;
        for (const audience of spec.outbound.audiences) {
          const text = saved[audience.key];
          if (typeof text !== "string" || text.trim() === "") continue;
          current.messages[audience.key] = text.slice(0, VIEWING_REMINDER_TEXT_MAX);
        }
      }
    }
  }
  return out;
}

function clampValue(spec: AutomationSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.defaultValue ?? 1;
  const min = spec.min ?? 1;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * למה ההגדרה נדחית — `null` כשהיא תקפה.
 *
 * הסף נבדק כאן ולא רק נחתך, כי מסך ששולח 500 שעות צריך לדעת שהוא
 * שולח משהו לא סביר; החיתוך ב-`resolve` הוא ההגנה על **קריאה** של
 * ערך שכבר נשמר, לא היתר לכתוב כל דבר.
 */
export function automationRejectionReason(
  key: string,
  setting: { enabled?: unknown; value?: unknown; channel?: unknown; messages?: unknown },
): string | null {
  const spec = BY_KEY.get(key as AutomationKey);
  if (spec === undefined) return `אוטומציה לא מוכרת: ${key}`;

  if (setting.enabled !== undefined && typeof setting.enabled !== "boolean") {
    return `${spec.title}: "פועל" חייב להיות כן או לא`;
  }
  if (spec.required === true && setting.enabled === false) {
    return `${spec.title}: אי אפשר לכבות — אלו מועדים שנובעים מהחוזה`;
  }

  /*
   * ‎**ערוץ ונוסח על אוטומציה שאינה פונה ללקוח נדחים במפורש.**
   *
   * בליעה שקטה הייתה מקבלת 200 על הגדרה שלא נשמרה — כלומר המשרד
   * מנסח הודעה, המסך אומר „נשמר”, ודבר לא משתנה.
   */
  if (setting.channel !== undefined || setting.messages !== undefined) {
    if (spec.outbound === undefined) return `${spec.title}: אינה שולחת ללקוח`;
    if (
      setting.channel !== undefined &&
      setting.channel !== "email" &&
      setting.channel !== "whatsapp" &&
      setting.channel !== "both"
    ) {
      return `${spec.title}: ערוץ לא מוכר`;
    }
    if (setting.messages !== undefined) {
      if (typeof setting.messages !== "object" || setting.messages === null) {
        return `${spec.title}: הנוסח חייב להיות טקסט לכל נמען`;
      }
      const known = new Set(spec.outbound.audiences.map((a) => a.key));
      for (const [audience, text] of Object.entries(setting.messages)) {
        if (!known.has(audience)) return `${spec.title}: נמען לא מוכר — ${audience}`;
        if (typeof text !== "string") return `${spec.title}: הנוסח חייב להיות טקסט`;
        if (text.length > VIEWING_REMINDER_TEXT_MAX) {
          return `${spec.title}: הנוסח ארוך מ-${VIEWING_REMINDER_TEXT_MAX} תווים`;
        }
      }
    }
  }

  if (setting.value === undefined) return null;
  if (spec.unit === null) return `${spec.title}: אין לה סף לכוון`;
  if (typeof setting.value !== "number" || !Number.isFinite(setting.value)) {
    return `${spec.title}: הסף חייב להיות מספר`;
  }
  const min = spec.min ?? 1;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  if (setting.value < min || setting.value > max) {
    return `${spec.title}: הסף חייב להיות בין ${min} ל-${max}`;
  }
  return null;
}

/** תווית היחידה למסך. */
export function automationUnitLabel(unit: AutomationUnit): string {
  if (unit === "hours") return "שעות";
  if (unit === "days") return "ימים";
  return "";
}

/**
 * הסף במילישניות — הצורה שבה ה-Worker וה-Dispatcher צריכים אותו.
 *
 * ההמרה כאן ולא בכל קורא בנפרד: שעות וימים באותו שדה `value` הם
 * בדיוק המקום שבו מישהו יכפיל ב-24 פעם אחת יותר מדי.
 */
export function automationThresholdMs(
  key: AutomationKey,
  settings: AutomationSettings,
): number | null {
  const spec = BY_KEY.get(key);
  if (spec === undefined || spec.unit === null) return null;
  const value = settings[key].value ?? spec.defaultValue;
  if (value === undefined) return null;
  const hours = spec.unit === "days" ? value * 24 : value;
  return hours * 60 * 60 * 1000;
}
