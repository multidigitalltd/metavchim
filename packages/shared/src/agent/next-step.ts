import { AGENT_ACTIONS, type AgentActionId } from "./actions.js";

/**
 * ‎**„מה עכשיו” — נגזר מהתוצאה, לא מומצא עליה.**
 *
 * ## מה זה מחליף
 *
 * לסוכן כבר הייתה הצעת המשך: אחרי כל שאילתה יוצאת קריאה שנייה
 * למודל עם ה-JSON של התוצאה, והוא מתבקש לכתוב „משפט פקודה קצר
 * שהמתווך יכול לומר עכשיו”. שלוש בעיות בזה, וכולן מאותו שורש:
 *
 * ‎**1 · הוא רואה JSON קטוע.** התוצאה נחתכת ל-6,000 תווים לפני
 * שהיא נשלחת. מה שנחתך פשוט אינו קיים בשביל ההצעה.
 *
 * ‎**2 · הוא יכול להמציא.** „אל תמציא נתונים שאינם ב-JSON” היא
 * הוראה בפרומפט ולא ערובה. הצעה שממציאה שם לקוח היא הצעה שהמתווך
 * ילחץ עליה.
 *
 * ‎**3 · והיא מחרוזת, לא פעולה.** המתווך מקבל משפט להקליד בחזרה,
 * והמערכת מפרשת אותו מחדש מאפס — כולל הסיכוי שהפעם היא תבין אחרת.
 *
 * ## מה כאן במקום
 *
 * צעד שנגזר **דטרמיניסטית** מהתוצאה שכבר חזרה, ונושא איתו את
 * מזהה הפעולה ואת השדות שכבר ידועים. אין קריאה למודל, אין חיתוך,
 * ואין דרך להמציא שם שלא היה בנתונים.
 *
 * ‎**הכלל היחיד, וכל הקובץ נשען עליו: צעד נפלט רק כשהנתונים שחזרו
 * מוכיחים את התנאי שלו.** לא „כנראה כדאי” ולא „בדרך כלל אחרי
 * X עושים Y” — אלא שורה שקיימת בתוצאה, עם שם שקיים בה, ועם ציון
 * שנמדד. היעדר מידע אינו עילה לשום צעד; זו אותה הבחנה שחוזרת
 * במערכת הזו — „לא ידוע” אינו „לא”, וגם אינו „כן”.
 *
 * ההצעה מהמודל נשארת כרשת ביטחון למקרים שאין להם כלל כאן, ולא
 * כמקור הראשי.
 */

/** צעד המשך אחד — מה שנאמר, ומה שיקרה אם יאושר. */
export interface AgentNextStep {
  /**
   * משפט אחד בעברית, בצורת פקודה שאפשר לומר בחזרה.
   *
   * לא שאלה פתוחה („מה תרצה לעשות?”) אלא הצעה קונקרטית שאפשר לענות
   * עליה „כן”. הצעה שאינה נוקבת בשם ובפעולה אינה מניעה לפעולה אלא
   * מעבירה את העבודה בחזרה למתווך.
   */
  text: string;
  action: AgentActionId;
  /**
   * מה שכבר ידוע מהתוצאה. שאר השדות נפתרים כרגיל בזמן הביצוע.
   *
   * ‎**שמות ולא מזהים.** אותו כלל כמו בזיכרון השיחה: הצעד עשוי
   * לנסוע דרך הפרומפט של מודל חיצוני, ומזהה פנימי אינו אמור להגיע
   * לשם. הפותר מתרגם שם לרשומה בדיוק כפי שהוא עושה לכל פנייה אחרת.
   */
  params: Readonly<Record<string, string>>;
}

/** גישה בטוחה לשדה מחרוזת. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    : [];
}

/** הרשומות של מקטע, בין שהתוצאה היא מערך חשוף ובין שהיא עוטפת. */
function section(data: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(data)) return rows(data);
  if (typeof data !== "object" || data === null) return [];
  return rows((data as Record<string, unknown>)[key]);
}

/**
 * ‎**מה שפעולת יצירה מחזירה — וזה `ref`, לא `data`.**
 *
 * ‎`createBuyer` ו-`createLead` מחזירות `href`, `message` ו-`ref`
 * בלבד; אין להן `data` כלל. הגרסה הראשונה של הקובץ הזה קראה
 * ‎`data.buyer.name`, וכל הכללים שנשענו עליה **לא היו נפלטים
 * לעולם** — בדיקה ירוקה על קוד מת. השם היחיד שקיים הוא התווית
 * שב-`ref`, וזו גם הסיבה שהיא מספיקה: הפותר מתרגם תווית לרשומה
 * בדיוק כמו כל פנייה בשם.
 */
export interface AgentStepSource {
  data?: unknown;
  ref?: { label: string; entityType: string };
}

const BY_ID = new Map(AGENT_ACTIONS.map((a) => [a.id, a]));

/**
 * ‎**הצעדים שהתוצאה הזו מצדיקה.**
 *
 * ‎`allowed` הוא אותו סינון שהפרומפט עושה, ומאותה סיבה: להציע
 * פעולה שהמשתמש חסום ממנה זה לשלוח אותו אל „אין לך הרשאה” על משהו
 * שהסוכן עצמו הציע. זו שכבת חוויה — הבדיקה בשרת נשארת ואינה תלויה
 * בה.
 */
export function agentNextSteps(
  action: string,
  result: AgentStepSource,
  allowed: readonly string[],
  now: Date,
): AgentNextStep[] {
  const { data, ref } = result;
  const out: AgentNextStep[] = [];
  const permit = (step: AgentNextStep): void => {
    if (allowed.includes(step.action) && BY_ID.has(step.action)) out.push(step);
  };

  switch (action) {
    /*
     * ‎**התאמה שנמצאה ולא נשלחה עליה הצעה היא התאמה שלא קרה כלום
     * איתה.** זה הצעד שהמתווך עושה אחריה בפועל, וזו הסיבה שהוא
     * ראשון כאן.
     *
     * הכיוון נבדק: „התאמות לנכס” מחזירה **קונים**, ורק אז יש למי
     * לשלוח. „התאמות לקונה” מחזירה נכסים, ואת שם הקונה לא ניתן
     * לדעת מהשורה — שם אין צעד, וזו התשובה הנכונה ולא נפילה לשם
     * כלשהו.
     */
    case "show_matches": {
      const top = section(data, "matches")
        .filter((m) => str(m["buyerName"]) !== null)
        .sort((a, b) => (Number(b["score"]) || 0) - (Number(a["score"]) || 0))[0];
      if (top === undefined) break;
      const name = str(top["buyerName"])!;
      const score = typeof top["score"] === "number" ? ` (${top["score"]}% התאמה)` : "";
      permit({
        text: `לשלוח הצעה ל${name}${score}?`,
        action: "send_offer",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * קונה חדש בלי התאמות הוא כרטיס שנשמר ולא נעשה בו דבר. השאלה
     * הראשונה שמתווך שואל אחרי שהזין קונה היא „מה יש לי בשבילו”.
     */
    case "create_buyer": {
      const name = ref?.entityType === "buyer" ? str(ref.label) : null;
      if (name === null) break;
      permit({
        text: `לראות מה מתאים ל${name} עכשיו?`,
        action: "show_matches",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**נכס חדש — ובעל הנכס קודם לפרסום.**
     *
     * בלי בעל נכס אי אפשר להחתים על הזמנה בכתב ואי אפשר לשלוח עדכון
     * שיווק, ולכן פרסום לרשת לפניו הוא סדר הפוך. התנאי נבדק ולא
     * מונח: `missingFields` חוזר מהיצירה, ורק מה שכתוב בו נטען.
     */
    case "create_property": {
      const title = ref?.entityType === "property" ? str(ref.label) : null;
      if (title === null) break;
      /*
       * ‎**ולא „אין בעל נכס — להוסיף?”**, שהיה הניסוח הראשון כאן.
       * ‎`createProperty` אינה מחזירה `missingFields`, ולכן הצעה
       * כזו הייתה טוענת על היעדר בעלים בלי לדעת. הצעד היחיד שהתוצאה
       * מוכיחה הוא שהנכס קיים.
       */
      permit({
        text: `לפרסם את ${title} לרשת המתווכים?`,
        action: "share_property",
        params: { propertyPhrase: title },
      });
      break;
    }

    /*
     * ‎**רק משימה שבאמת באיחור.** „יש לך 7 משימות” אינו עילה לשום
     * דבר; משימה שהמועד שלה עבר היא הדבר היחיד ברשימה שיש לו דחיפות
     * מוכחת, והדגל מגיע מהשרת ולא מחישוב כאן.
     */
    case "show_tasks": {
      /*
       * ‎**„באיחור” מחושב, כי השורה אינה נושאת דגל.** `showTasks`
       * מחזירה `dueAt` בלבד. הניסוח הראשון כאן חיפש `overdue: true`
       * שאינו קיים בשום שורה — כלומר כלל שלעולם אינו נפלט.
       *
       * ההשוואה בין שני רגעים ואינה תלויה באזור זמן: `dueAt` הוא
       * חותמת UTC, וכך גם `now`. אין כאן שעת קיר ואין מה לפרש.
       */
      const late = section(data, "tasks").find((t) => {
        const due = str(t["dueAt"]);
        if (due === null) return false;
        const at = new Date(due);
        return !Number.isNaN(at.getTime()) && at.getTime() < now.getTime();
      });
      const title = str(late?.["title"]);
      if (title === null) break;
      permit({
        text: `„${title}” באיחור. לסמן שבוצעה?`,
        action: "complete_task",
        params: { taskPhrase: title },
      });
      break;
    }

    /*
     * ליד חדש שאיש לא קבע איתו כלום חוזר להיות רשומה במאגר. הצעד
     * הוא פגישה ולא „לעדכן סטטוס”: סטטוס מתעד מה שקרה, ופגישה
     * גורמת למשהו לקרות.
     *
     * ‎**`lead` ולא `buyer`,** וזה נבדק בקוד ולא הונח: `createLead`
     * מחזירה `refOf(name, "lead", id)`. הניסוח הראשון כאן לא בדק סוג
     * כלל, והבדיקה שנכתבה לו המציאה `entityType: "buyer"` — כלומר
     * אישרה קלט שאינו קיים.
     *
     * ‎`ref` חוזרת רק כשהליד **גלוי** למי שקלט אותו; פנייה שמוזגה
     * לליד של סוכן אחר אינה מחזירה אותה, ולכן אין כאן הצעה לקבוע
     * פגישה עם כרטיס שהשירותים ידחו.
     */
    case "create_lead": {
      const name = ref?.entityType === "lead" ? str(ref.label) : null;
      if (name === null) break;
      permit({
        text: `לקבוע פגישה עם ${name}?`,
        action: "schedule_appointment",
        params: { buyerPhrase: name },
      });
      break;
    }

    default:
      break;
  }

  return out;
}
