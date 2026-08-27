/**
 * תפריט „מה אני יודע לעשות” — נבנה מהקטלוג, בלי קריאת מודל.
 *
 * זו השאלה הראשונה של כל מתווך חדש, והיא נשאלה עד היום דרך המודל:
 * תשלום על ניסוח מחדש של אותה תשובה, עם סיכוי שהיא תזכיר פעולה
 * שלמשתמש הזה אין אליה הרשאה. כאן היא נגזרת מהפעולות שלו בפועל —
 * מדויקת, מיידית וחינם.
 *
 * הדוגמאות הן דוגמאות אמיתיות מהקטלוג, כלומר בדיוק הניסוחים שהמודל
 * מאומן עליהם — מי שמעתיק אותן מקבל תוצאה טובה כבר בפעם הראשונה.
 */

export interface HelpAction {
  id: string;
  title: string;
  risk: string;
  examples: readonly string[];
}

/**
 * קבוצות התפריט לפי סדר השימוש בפועל, לא לפי סדר הקטלוג.
 *
 * ‎**כל פעולה בקטלוג חייבת להופיע כאן, ובקבוצה אחת בלבד.**
 *
 * זו רשימה מקבילה לקטלוג, וככזו היא נטתה ממנו: שש פעולות קיימות —
 * „מי צריך שיחה חוזרת”, „הכרטיס של”, „תשמיע לי”, קישור החתימה,
 * הבלעדיות ותיעוד השיווק — **לא הופיעו בתפריט כלל**. הן עבדו; פשוט
 * אי אפשר היה לדעת מהסוכן עצמו שהן קיימות, וזה גרוע במיוחד בתפריט
 * שכל תכליתו לענות „מה אתה יודע לעשות”.
 *
 * ‎`assistant-help.test.ts` אוכף את הכיסוי, ולכן פעולה חדשה שלא
 * תשובץ תפיל את הבדיקה במקום להיעלם בשקט.
 */
const GROUPS: { label: string; ids: readonly string[] }[] = [
  {
    label: "לשאול על המאגר",
    ids: ["find_buyers", "find_properties", "search", "show_matches", "show_card"],
  },
  {
    label: "היום שלי",
    ids: [
      "show_schedule",
      "show_tasks",
      "show_notifications",
      "show_callbacks",
      "show_leads",
      "show_calls",
      "play_recording",
      "office_report",
    ],
  },
  {
    label: "להוסיף ולעדכן",
    ids: [
      "create_lead",
      "create_buyer",
      "create_property",
      "create_task",
      "schedule_appointment",
      "reschedule_appointment",
      "update_appointment",
      "update_buyer",
      "update_property",
      "update_lead_status",
      "complete_task",
      "assign_task",
      "add_note",
      "dismiss_match",
    ],
  },
  {
    label: "הצעות והחתמה",
    ids: [
      "send_offer",
      "send_agreement",
      "send_email",
      "send_message",
      "show_offers",
      "show_agreements",
      "show_emails",
    ],
  },
  { label: "בלעדיות", ids: ["show_exclusivity", "log_marketing_action"] },
  {
    label: "רשת המשרדים",
    ids: ["share_property", "share_buyer", "show_demands", "show_deals"],
  },
  { label: "עזרה", ids: ["open_support_ticket"] },
];

/** מיוצאת לבדיקת הכיסוי בלבד — התפריט עצמו נבנה מ-`helpMenu`. */
export const HELP_GROUP_IDS: readonly string[] = GROUPS.flatMap((group) => group.ids);

/** כמה דוגמאות מוצגות בכל קבוצה — תפריט, לא קטלוג. */
const EXAMPLES_PER_GROUP = 2;

/**
 * הפעולות שמהן נלקחות דוגמאות ההכרות, לפי סדר עדיפות.
 *
 * הסדר מייצר גיוון: שאלה על המאגר, הוספה, ומבט על היום — כך שמי
 * שקורא רואה את שלושת סוגי השימוש ולא שלוש וריאציות של אותו דבר.
 * מסוננות מול מה שמותר למשתמש בפועל.
 */
const WELCOME_PREFERRED = [
  "find_buyers",
  "create_buyer",
  "show_schedule",
  "find_properties",
  "create_property",
  "show_tasks",
  "create_task",
  "search",
] as const;

/** עד שלוש דוגמאות — הכרות, לא קטלוג. */
const WELCOME_EXAMPLES = 3;

export function welcomeExamples(actions: readonly HelpAction[]): string[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const ordered = [
    ...WELCOME_PREFERRED.flatMap((id) => {
      const action = byId.get(id);
      return action ? [action] : [];
    }),
    // פעולה מותרת שאינה ברשימת ההעדפה עדיפה על דוגמה חסרה
    ...actions.filter((action) => !WELCOME_PREFERRED.includes(action.id as never)),
  ];
  return ordered
    .flatMap((action) => {
      const example = action.examples[0];
      return example === undefined ? [] : [example];
    })
    .slice(0, WELCOME_EXAMPLES);
}

export function helpMenu(actions: readonly HelpAction[], firstName?: string): string {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const greeting = firstName ? `${firstName}, הנה מה שאני יודעת לעשות בשבילך:` : "הנה מה שאני יודעת לעשות:";
  const lines: string[] = [greeting];

  for (const group of GROUPS) {
    const available = group.ids.flatMap((id) => {
      const action = byId.get(id);
      return action ? [action] : [];
    });
    if (available.length === 0) continue;
    lines.push("", `*${group.label}*`);
    lines.push(available.map((action) => action.title).join(" · "));
    for (const action of available.slice(0, EXAMPLES_PER_GROUP)) {
      const example = action.examples[0];
      if (example !== undefined) lines.push(`   „${example}”`);
    }
  }

  if (lines.length === 1) {
    return "כרגע אין לך הרשאות לפעולות דרך הסוכן — פנו לבעל המשרד.";
  }

  lines.push(
    "",
    "אפשר גם *להקליט* לי הודעה קולית במקום להקליד.",
    "לפני כל פעולה שמשנה נתונים אשאל אישור — *אשר* לביצוע, *בטל* לביטול.",
  );
  return lines.join("\n");
}
