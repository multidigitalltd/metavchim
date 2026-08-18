import { z } from "zod";

/**
 * אוטומציות שהמשרד בונה בעצמו.
 *
 * ## היחס לאוטומציות המובנות
 *
 * `automations.ts` הוא קטלוג **סגור** של שמונה אוטומציות שהמערכת
 * מריצה מהיום הראשון, וכל אחת מהן היא קוד ייעודי. הקובץ הזה הוא
 * ההפך: **צורה** שהמשרד ממלא — טריגר, תנאים, פעולה — בלי שאף שורת
 * קוד תיכתב עבורה.
 *
 * שני המנגנונים חיים זה לצד זה ולא מחליפים זה את זה. אוטומציה
 * מובנית יודעת דברים שאי אפשר לתאר בטופס (חלון פולו-אפ שנמדד מרגע
 * הפתיחה, בדיקת סטטוס בזמן הירי), ואוטומציה מותאמת יודעת דבר אחד
 * שהמובנות לעולם לא יידעו — מה **המשרד הזה** צריך.
 *
 * ## למה טריגרים מהאירועים הקיימים ולא "מתי שרוצים"
 *
 * הטריגרים הם בדיוק האירועים שכבר זורמים ב-outbox. זו אינה הגבלה
 * טכנית אלא החלטה: אירוע שכבר קיים הוא אירוע שכבר נבדק, כבר
 * מנוטר, וכבר נכתב פעם אחת נכון. טריגר חדש שנולד עם התכונה הזו היה
 * מגיע בלי אף אחד מהשלושה.
 *
 * ## למה התנאים על גוף האירוע בלבד
 *
 * תנאי שדורש שליפה מהמסד ("נכס בבני ברק") היה הופך כל אירוע
 * לשאילתה, ואת מנוע הכללים למנוע שאילתות. גוף האירוע נושא כבר את
 * מה שמבחין בפועל — מקור הליד, הסטטוס החדש, אילו שדות השתנו, כמה
 * התאמות נולדו — וזה מכסה את רוב מה שמשרד באמת רוצה. הרחבה
 * לשליפות היא צעד הגיוני, ומכוון שהוא **לא** נעשה כאן.
 */

/** שדה שאפשר לבנות עליו תנאי, כפי שהוא מופיע בגוף האירוע. */
export interface TriggerField {
  key: string;
  label: string;
  /**
   * `text` — השוואת מחרוזת · `number` — השוואה מספרית ·
   * `list` — מערך מחרוזות, והתנאי שואל אם הוא **מכיל** ערך ·
   * `boolean` — כן/לא
   */
  type: "text" | "number" | "list" | "boolean";
  /** ערכים נפוצים, להצעה במסך. אינו סגור — אפשר להקליד אחר. */
  suggestions?: readonly string[];
}

export interface AutomationTrigger {
  /** שם האירוע ב-outbox — המפתח שמחבר את הכלל למציאות. */
  event: string;
  label: string;
  description: string;
  fields: readonly TriggerField[];
}

/**
 * הטריגרים הפתוחים לבנייה עצמית.
 *
 * **לא כל אירוע מופיע כאן.** אירועים תפעוליים (`storage.cleanup_object`)
 * ואירועים שכבר יש להם אוטומציה מובנית עם היגיון עדין
 * (`task.created` והתזכורת שלו) הושארו בחוץ: טריגר שמשרד יכול
 * לתלות בו כלל חייב להיות כזה שהוא מבין מתי הוא קורה.
 */
export const AUTOMATION_TRIGGERS: readonly AutomationTrigger[] = [
  {
    event: "lead.created",
    label: "נכנס ליד חדש",
    description: "בכל פעם שנוצר ליד — מטופס, מוואטסאפ, משיחה או מייבוא.",
    fields: [
      {
        key: "source",
        label: "מקור הליד",
        type: "text",
        suggestions: ["whatsapp", "web", "phone", "email", "import", "manual"],
      },
      { key: "requiresHuman", label: "דורש טיפול אנושי", type: "boolean" },
    ],
  },
  {
    event: "property.ready",
    label: "נכס הגיע למוכנות",
    description: "כשציון המוכנות של הנכס עולה — כלומר הוא מוכן לשיווק.",
    fields: [{ key: "readinessScore", label: "ציון מוכנות", type: "number" }],
  },
  {
    event: "property.updated",
    label: "נכס עודכן",
    description: "עריכה של פרטי נכס. אפשר לצמצם לשדות מסוימים.",
    fields: [
      {
        key: "changedFields",
        label: "השדות שהשתנו",
        type: "list",
        suggestions: ["priceAgorot", "status", "rooms", "city", "address"],
      },
    ],
  },
  {
    event: "property.delisted",
    label: "נכס יצא משיווק",
    description: "נמכר, הושכר או הוקפא.",
    fields: [
      {
        key: "newStatus",
        label: "הסטטוס החדש",
        type: "text",
        suggestions: ["sold", "rented", "frozen"],
      },
    ],
  },
  {
    event: "buyer.updated",
    label: "כרטיס קונה עודכן",
    description: "עריכה של ביקוש הקונה — תקציב, אזורים, חדרים.",
    fields: [
      {
        key: "changedFields",
        label: "השדות שהשתנו",
        type: "list",
        suggestions: ["budgetAgorot", "rooms", "cities", "status"],
      },
    ],
  },
  {
    event: "offer.sent",
    label: "נשלחה הצעה",
    description: "בכל פעם שהצעה נשלחה ללקוח.",
    fields: [],
  },
  {
    event: "offer.opened",
    label: "הצעה נפתחה",
    description: "הלקוח פתח את ההצעה ששלחנו.",
    fields: [{ key: "openCount", label: "מספר הפתיחות", type: "number" }],
  },
  {
    event: "offer.interested",
    label: "הלקוח סימן עניין בהצעה",
    description: "הלקוח לחץ „מעוניין” בעמוד ההצעה.",
    fields: [],
  },
  {
    event: "matches.computed",
    label: "נמצאו התאמות חדשות",
    description: "סבב חישוב התאמות הסתיים ונולדו התאמות חדשות.",
    fields: [
      { key: "newMatchCount", label: "התאמות חדשות", type: "number" },
      { key: "strongMatchCount", label: "מתוכן מומלצות", type: "number" },
    ],
  },
  {
    event: "appointment.scheduled",
    label: "נקבעה פגישה",
    description: "פגישה או סיור שנקבעו ביומן.",
    fields: [
      {
        key: "kind",
        label: "סוג הפגישה",
        type: "text",
        // בדיוק מה שהיומן פולט (calendar.controller — z.enum).
        // „signing” לא קיים, וכלל שנבנה עליו לא היה מתקיים לעולם.
        suggestions: ["viewing", "meeting", "call"],
      },
    ],
  },
];

const TRIGGER_BY_EVENT = new Map(AUTOMATION_TRIGGERS.map((t) => [t.event, t]));

export function automationTrigger(event: string): AutomationTrigger | undefined {
  return TRIGGER_BY_EVENT.get(event);
}

/**
 * האופרטורים.
 *
 * מכוון מצומצם. אופרטור נוסף הוא עוד מצב שצריך להסביר במסך, לתרגם
 * לעברית ולבדוק — והרשימה הזו כבר מכסה את מה שמשרד מבטא בפועל.
 */
export const CONDITION_OPERATORS = [
  { value: "eq", label: "שווה ל", types: ["text", "number", "boolean"] },
  { value: "neq", label: "שונה מ", types: ["text", "number", "boolean"] },
  { value: "gte", label: "גדול או שווה ל", types: ["number"] },
  { value: "lte", label: "קטן או שווה ל", types: ["number"] },
  { value: "contains", label: "מכיל את", types: ["list"] },
  { value: "not_contains", label: "אינו מכיל את", types: ["list"] },
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]["value"];

export const AutomationConditionSchema = z.object({
  field: z.string().min(1).max(60),
  operator: z.enum(["eq", "neq", "gte", "lte", "contains", "not_contains"]),
  /** מוחזק כמחרוזת תמיד — ההשוואה ממירה לפי סוג השדה. */
  value: z.string().max(200),
});
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

/**
 * הפעולות.
 *
 * שתיים בלבד, ובכוונה: שתיהן דברים שהמערכת כבר עושה מאות פעמים
 * ביום דרך האוטומציות המובנות, כלומר הן נבדקו. פעולה ששולחת הודעה
 * ללקוח — מייל או וואטסאפ — היא קפיצה אחרת לגמרי (נוסחים, הסכמה,
 * הסרה מרשימה), והיא הצעד הבא ולא חלק מהראשון.
 */
export const AUTOMATION_ACTIONS = [
  {
    kind: "task",
    label: "פתיחת משימה",
    description: "נפתחת משימה לסוכן שתבחרו, עם מועד יעד יחסי לאירוע.",
  },
  {
    kind: "notify",
    label: "התראה במערכת",
    description: "התראה לסוכן שתבחרו — בפעמון, ובפוש אם הוא הפעיל אותו.",
  },
] as const;

export type AutomationActionKind = (typeof AUTOMATION_ACTIONS)[number]["kind"];

export const AutomationActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    /** למי. מזהה משתמש — הכלל אינו מנחש בעלות. */
    assignedToUserId: z.string().length(26),
    title: z.string().min(2).max(200),
    /** בכמה ימים מהאירוע. 0 = היום. */
    dueInDays: z.number().int().min(0).max(365),
  }),
  z.object({
    kind: z.literal("notify"),
    userId: z.string().length(26),
    title: z.string().min(2).max(120),
    body: z.string().max(400).default(""),
  }),
]);
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

export const AutomationRuleInputSchema = z.object({
  name: z.string().min(2).max(120),
  enabled: z.boolean(),
  trigger: z.string().min(3).max(60),
  conditions: z.array(AutomationConditionSchema).max(10),
  action: AutomationActionSchema,
});
export type AutomationRuleInput = z.infer<typeof AutomationRuleInputSchema>;

/**
 * למה הכלל הזה אינו תקין — או `null` כשהוא כן.
 *
 * בשרת ולא רק במסך: הכלל מגיע מהדפדפן, וכלל ששמור עם טריגר שאינו
 * קיים או תנאי על שדה שאין לו הוא כלל שלעולם לא ירוץ ולעולם לא
 * יאמר למה. שגיאה בשמירה עדיפה על אוטומציה שקטה שלא עובדת.
 */
export function ruleRejectionReason(rule: AutomationRuleInput): string | null {
  const trigger = automationTrigger(rule.trigger);
  if (!trigger) return "הטריגר אינו מוכר";

  for (const condition of rule.conditions) {
    const field = trigger.fields.find((f) => f.key === condition.field);
    if (!field) return `השדה "${condition.field}" אינו קיים בטריגר הזה`;

    const operator = CONDITION_OPERATORS.find((o) => o.value === condition.operator);
    if (!operator) return "אופרטור לא מוכר";
    if (!(operator.types as readonly string[]).includes(field.type)) {
      return `האופרטור "${operator.label}" אינו מתאים לשדה "${field.label}"`;
    }
    if (field.type === "number" && Number.isNaN(Number(condition.value))) {
      return `הערך של "${field.label}" חייב להיות מספר`;
    }
    if (condition.value.trim() === "") return `חסר ערך בתנאי על "${field.label}"`;
  }
  return null;
}

/** ערך מגוף האירוע, מנורמל להשוואה. */
function readField(payload: Record<string, unknown>, key: string): unknown {
  return payload[key];
}

function compareOne(
  actual: unknown,
  condition: AutomationCondition,
  fieldType: TriggerField["type"],
): boolean {
  const { operator, value } = condition;

  if (fieldType === "list") {
    // מערך חסר נחשב ריק ולא „לא ידוע”: אירוע ישן בלי השדה לא אמור
    // להפעיל כלל שמחפש ערך בתוכו
    const list = Array.isArray(actual) ? actual.map(String) : [];
    const has = list.includes(value);
    return operator === "contains" ? has : !has;
  }

  if (fieldType === "number") {
    const left = Number(actual);
    const right = Number(value);
    // ערך שאינו מספר אינו „קטן מכל דבר” — הוא פשוט לא מקיים את התנאי
    if (Number.isNaN(left) || Number.isNaN(right)) return false;
    if (operator === "eq") return left === right;
    if (operator === "neq") return left !== right;
    if (operator === "gte") return left >= right;
    if (operator === "lte") return left <= right;
    return false;
  }

  if (fieldType === "boolean") {
    const left = actual === true;
    const right = value === "true" || value === "כן" || value === "1";
    return operator === "eq" ? left === right : left !== right;
  }

  const left = actual === undefined || actual === null ? "" : String(actual);
  return operator === "eq" ? left === value : left !== value;
}

/**
 * האם האירוע מקיים את כל תנאי הכלל.
 *
 * **וגם, לא או.** משרד שמנסח שני תנאים מתכוון לצמצם, לא להרחיב —
 * וכלל שמתרחב כשמוסיפים לו תנאי הוא בדיוק ההפתעה שגורמת לכבות את
 * כל התכונה. „או” נבנה בינתיים כשני כללים.
 *
 * ללא תנאים = תמיד מתקיים, כלומר „בכל פעם שהאירוע קורה”.
 */
export function conditionsMatch(
  trigger: AutomationTrigger,
  conditions: readonly AutomationCondition[],
  payload: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => {
    const field = trigger.fields.find((f) => f.key === condition.field);
    // תנאי על שדה שאינו קיים אינו מתקיים — הכיוון הבטוח. כלל פגום
    // שלא רץ מתגלה; כלל פגום שרץ על הכול מציף את המשרד.
    if (!field) return false;
    return compareOne(readField(payload, condition.field), condition, field.type);
  });
}

/** תיאור הכלל במשפט אחד — לרשימה ולתיעוד. */
export function describeRule(rule: AutomationRuleInput): string {
  const trigger = automationTrigger(rule.trigger);
  const when = trigger?.label ?? rule.trigger;
  const filters =
    rule.conditions.length === 0
      ? ""
      : ` (${rule.conditions
          .map((c) => {
            const field = trigger?.fields.find((f) => f.key === c.field);
            const operator = CONDITION_OPERATORS.find((o) => o.value === c.operator);
            return `${field?.label ?? c.field} ${operator?.label ?? c.operator} ${c.value}`;
          })
          .join(", ")})`;
  const action =
    rule.action.kind === "task"
      ? `פתיחת משימה "${rule.action.title}"`
      : `התראה "${rule.action.title}"`;
  return `${when}${filters} ⟵ ${action}`;
}
