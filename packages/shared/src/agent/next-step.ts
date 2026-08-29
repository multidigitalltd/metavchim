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
  /**
   * ‎**כותרת הכפתור** — פועל קצר, עד ~20 תווים לפני חיתוך של Meta.
   *
   * הצעד נוסע לוואטסאפ ככפתור מתחת להודעה ולמסך כצ'יפ, והכותרת
   * היא מה שרואים לפני הלחיצה. `text` הוא מה שהלחיצה שולחת בפועל,
   * ולכן שניהם חובה: כפתור בלי משפט אין לו מה לשגר, ומשפט בלי
   * כותרת אינו כפתור.
   */
  label: string;
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
  /**
   * ‎**הפרמטרים שהפעולה רצה איתם — כי חלק מההקשר אינו בתוצאה.**
   *
   * „מה מתאים לדירה ברמת גן” מחזיר **קונים** (`listForProperty`),
   * והנכס שנשאל עליו אינו בשום שורה. בלעדיו הצעד היוצא נשא רק את שם
   * הקונה, והמשפט „לשלוח הצעה למשה כהן?” פוענח מחדש בלי נכס —
   * ‎`sendOffer` לא מצא על מה לשלוח והצטמצם לניווט לכרטיס. כלומר
   * הצעה שהבטיחה שליחה ולא שלחה (ביקורת Codex).
   *
   * שמות ולא מזהים, כמו בכל השאר: `propertyPhrase` הוא מה שנאמר,
   * והפותר מתרגם אותו שוב בדיוק כמו בפעם הראשונה.
   */
  params?: Readonly<Record<string, unknown>>;
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

      /*
       * ‎**הצעה בלי נכס אינה הצעה, ולכן אין צעד בלעדיו.**
       *
       * שני מקורות, כי לשתי הצורות של השאלה יש נתונים שונים:
       * התאמות המשרד (`listAll`) נושאות `property` בכל שורה, ו„מה
       * מתאים לדירה ברמת גן” (`listForProperty`) אינה נושאת אותו
       * כלל — הנכס שם הוא **השאלה**, לא התוצאה.
       *
       * בלי אף אחד מהם הצעד יורד. `sendOffer` היה מצטמצם לניווט
       * לכרטיס הקונה, כלומר הצעה שאומרת „לשלוח” ואינה שולחת —
       * וזה גרוע מלא להציע כלום.
       */
      const property = top["property"];
      const title =
        (typeof property === "object" && property !== null
          ? (str((property as Record<string, unknown>)["title"]) ??
            str((property as Record<string, unknown>)["address"]))
          : null) ?? str(result.params?.["propertyPhrase"]);
      if (title === null) break;

      const score = typeof top["score"] === "number" ? ` (${top["score"]}% התאמה)` : "";
      permit({
        text: `לשלוח ל${name} הצעה על ${title}${score}?`,
        label: "📤 שלח הצעה",
        action: "send_offer",
        params: { buyerPhrase: name, propertyPhrase: title },
      });
      /*
       * והצעד השני על אותה התאמה — סיור. אותו קונה מוכח ואותו נכס
       * מוכח, ולכן אין כאן טענה חדשה; מה שמשתנה הוא רק איזו פעולה
       * המתווך מעדיף, וזו בדיוק הבחירה ששני כפתורים נותנים.
       */
      permit({
        text: `לקבוע ל${name} סיור ב${title}?`,
        label: "📅 קבע סיור",
        action: "schedule_appointment",
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
        label: "🔍 מצא התאמות",
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
        label: "🌐 פרסם לרשת",
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
        label: "✔️ סמן שבוצעה",
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
        label: "📅 קבע פגישה",
        action: "schedule_appointment",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**חיפוש שמצא — הצעד הוא על הראשון שנמצא.** „מי מחפש 4 חדרים
     * בגבעתיים” מחזיר רשימה; מה שהמתווך עושה איתה הוא לבדוק מה יש
     * למישהו מהם. השם מוכח — הוא שורת התוצאה הראשונה.
     */
    case "find_buyers": {
      const name = str(section(data, "buyers")[0]?.["name"]);
      if (name === null) break;
      permit({
        text: `לראות מה מתאים ל${name}?`,
        label: "🔍 מצא התאמות",
        action: "show_matches",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ואותו כלל בכיוון הנכסים: נכס שנמצא — למי הוא מתאים. הכותרת
     * מוכחת מהשורה; `address` הוא הנפילה כשאין כותרת שיווקית.
     */
    case "find_properties": {
      const first = section(data, "properties")[0];
      const title = str(first?.["title"]) ?? str(first?.["address"]);
      if (title === null) break;
      permit({
        text: `למי מתאים ${title}?`,
        label: "🔍 למי מתאים?",
        action: "show_matches",
        params: { propertyPhrase: title },
      });
      break;
    }

    /*
     * הצעה שנשלחה — הצעד הבא של המתווך הוא סיור. הקונה מוכח מתוך
     * הפרמטרים שהפעולה **רצה איתם** (אותו מקור כמו הנכס
     * ב-`show_matches`): זה מה שנאמר, והפותר יתרגם אותו שוב.
     */
    case "send_offer": {
      const name = str(result.params?.["buyerPhrase"]);
      if (name === null) break;
      permit({
        text: `לקבוע ל${name} סיור בנכס?`,
        label: "📅 קבע סיור",
        action: "schedule_appointment",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**מי שממתין לחזרה — הצעד הוא לחזור אליו.** השם הוא שורת
     * התוצאה הראשונה, שהיא כבר מדורגת לפי דחיפות בשרת; הצעד השני
     * הוא הודעה, למי שעדיף לו לכתוב מאשר לחייג.
     */
    case "show_callbacks": {
      const name = str(section(data, "callbacks")[0]?.["name"]);
      if (name === null) break;
      permit({
        text: `להתקשר ל${name}?`,
        label: "📞 התקשר",
        action: "call_contact",
        params: { buyerPhrase: name },
      });
      permit({
        text: `לשלוח ל${name} הודעה?`,
        label: "💬 שלח הודעה",
        action: "send_message",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ליד ברשימה — הצעד הוא לקדם אותו, לא לצפות בו שוב. פגישה
     * ראשונה היא מה שמזיז ליד, ולכן היא הצעד הראשון.
     */
    case "show_leads": {
      const name = str(section(data, "leads")[0]?.["name"]);
      if (name === null) break;
      permit({
        text: `לקבוע פגישה עם ${name}?`,
        label: "📅 קבע פגישה",
        action: "schedule_appointment",
        params: { buyerPhrase: name },
      });
      permit({
        text: `להתקשר ל${name}?`,
        label: "📞 התקשר",
        action: "call_contact",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**בלעדיות בסיכון — הצעד הוא הפעולה שמצילה אותה.** רק כשחסרות
     * פעולות שיווק בפועל (`missing > 0`): בלעדיות מלאה אינה צריכה
     * שום דבר, והצעה עליה הייתה רעש.
     */
    case "show_exclusivity": {
      const risky = section(data, "exclusivity").find(
        (row) => typeof row["missing"] === "number" && (row["missing"] as number) > 0,
      );
      const title = str(risky?.["propertyTitle"]);
      if (title === null) break;
      permit({
        text: `לתעד פעולת שיווק על ${title}?`,
        label: "📋 תעד שיווק",
        action: "log_marketing_action",
        params: { propertyPhrase: title },
      });
      break;
    }

    /*
     * ‎**ביקוש ברשת שיש לי נכס בשבילו** — וזה נמדד, לא משוער:
     * ‎`matchCount` מגיע ממנוע ההתאמות. ביקוש בלי התאמה אינו מזמין
     * שום צעד, כי אין מה להציע לו.
     */
    case "show_demands": {
      const withMatch = section(data, "demands").find(
        (row) => typeof row["matchCount"] === "number" && (row["matchCount"] as number) > 0,
      );
      const office = str(withMatch?.["office"]);
      if (office === null) break;
      const cities = withMatch?.["cities"];
      const where = Array.isArray(cities) && cities.length > 0 ? ` ב${String(cities[0])}` : "";
      permit({
        text: `להציע נכס לביקוש של ${office}${where}?`,
        label: "🤝 הצע נכס",
        action: "offer_to_demand",
        params: { demandPhrase: office },
      });
      break;
    }

    /*
     * נכס ברשת — הצעד הוא להעמיד מולו קונה שלי. הכותרת מוכחת
     * מהשורה הראשונה של הפיד.
     */
    case "show_network_listings": {
      const first = rows(data)[0];
      const title = str(first?.["title"]);
      if (title === null) break;
      permit({
        text: `להביע התעניינות ב${title} בשביל קונה שלי?`,
        label: "🤝 הבע התעניינות",
        action: "express_interest",
        params: { listingPhrase: title },
      });
      break;
    }

    /*
     * ‎**פנייה שממתינה — הצעד הוא לענות לה.** זה כל מה שהרשימה
     * הזו קיימת בשבילו: מה שממתין ולא נענה נשאר תלוי.
     */
    case "show_network_inbox": {
      const title = str(rows(data)[0]?.["title"]);
      if (title === null) break;
      permit({
        text: `לפתוח חדר עסקה על ${title}?`,
        label: "🤝 פתח חדר עסקה",
        action: "open_deal_room",
        params: { approachPhrase: title },
      });
      break;
    }

    /*
     * מייל שנכנס — הצעד הוא לענות. השם מוכח מהשורה, והנושא אינו
     * נכנס לצעד: הוא תוכן של לקוח ואינו נחוץ לפקודה.
     */
    case "show_emails": {
      const name = str(section(data, "emails")[0]?.["contactName"]);
      if (name === null) break;
      permit({
        text: `לענות ל${name} במייל?`,
        label: "✉️ ענה במייל",
        action: "send_email",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**הצעה שנשלחה וממתינה — הצעד הוא המעקב.** הקונה מוכח מהשורה
     * הראשונה; מה שעושים אחרי שנשלחה הצעה הוא לוודא שהיא נקראה.
     */
    case "show_offers": {
      const name = str(section(data, "offers")[0]?.["buyerName"]);
      if (name === null) break;
      permit({
        text: `להתקשר ל${name} לגבי ההצעה?`,
        label: "📞 התקשר",
        action: "call_contact",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ליד שהפך לקונה — אותה שאלה בדיוק כמו אחרי `create_buyer`:
     * כרטיס חדש בלי התאמות הוא רשומה שלא נעשה בה דבר.
     */
    case "convert_lead": {
      const name = ref?.entityType === "buyer" ? str(ref.label) : null;
      if (name === null) break;
      permit({
        text: `לראות מה מתאים ל${name} עכשיו?`,
        label: "🔍 מצא התאמות",
        action: "show_matches",
        params: { buyerPhrase: name },
      });
      break;
    }

    /*
     * ‎**עסקה שנפתחה — החדר ריק עד שמישהו כותב בו.** הצעד מפנה
     * לשיחה עצמה; אין כאן שם להוכיח, ולכן הביטוי נשאר פתוח
     * והבורר יציג את החדרים.
     */
    case "open_deal_room": {
      permit({
        text: "לכתוב הודעה בחדר העסקה?",
        label: "💬 כתוב בחדר",
        action: "post_deal_message",
        params: {},
      });
      break;
    }

    /*
     * סיור שנקבע — הצעד הוא להזכיר ללקוח. השם מגיע מהפרמטרים
     * שהפעולה רצה איתם, כמו ב-`send_offer`.
     */
    case "schedule_appointment": {
      const name = str(result.params?.["buyerPhrase"]);
      if (name === null) break;
      permit({
        text: `לשלוח ל${name} הודעה עם פרטי הפגישה?`,
        label: "💬 שלח תזכורת",
        action: "send_message",
        params: { buyerPhrase: name },
      });
      break;
    }

    default:
      break;
  }

  return out;
}
