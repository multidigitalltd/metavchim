/**
 * תזכורת לפני סיור — למי שגר בנכס, ולקונה שבא לראות אותו.
 *
 * ## מה זה פותר
 *
 * סיור שאחד הצדדים שכח הוא נסיעה לשווא לשניהם, והוא נפוץ בדיוק
 * משום שקובעים אותו ימים מראש. המתווך שמתקשר בבוקר לוודא עושה
 * את זה ידנית, לכל סיור, ולכן זה נופל דווקא ביום עמוס — כשיש הכי
 * הרבה סיורים.
 *
 * ## שני נמענים, ולא אחד
 *
 * ‎**מי שגר בנכס** צריך לדעת שמגיעים אליו הביתה, ו**הקונה** צריך
 * להיזכר שהוא אמור להגיע. אלה שתי הודעות שונות: אחת אומרת „מגיעים
 * אליך”, השנייה „אנחנו נפגשים”. נוסח אחד לשניהם היה נכון לאף אחד.
 *
 * ## למה הנוסח ניתן לעריכה
 *
 * „בעזרת השם” אינו מתאים לכל משרד, ו„היי” אינו מתאים לכל לקוח.
 * נוסח שקבוע בקוד היה מכריח את המשרד לבחור בין תזכורת בשפה שאינה
 * שלו לבין לכבות את האוטומציה — וזו בחירה שלא צריכה להיות.
 */

/** כמה שעות לפני הסיור נשלחת התזכורת, כברירת מחדל. */
export const VIEWING_REMINDER_DEFAULT_HOURS = 5;

/** דרך המסירה. `both` = גם וגם, ולא „אחד מהם”. */
export type ViewingReminderChannel = "email" | "whatsapp" | "both";

export const VIEWING_REMINDER_CHANNELS: readonly ViewingReminderChannel[] = [
  "whatsapp",
  "email",
  "both",
];

export function viewingReminderChannelLabel(channel: ViewingReminderChannel): string {
  if (channel === "email") return "מייל בלבד";
  if (channel === "whatsapp") return "וואטסאפ בלבד";
  return "וואטסאפ ומייל";
}

/** ‎`true` כשהערוץ כולל את האמצעי הזה. */
export function viewingReminderUses(
  channel: ViewingReminderChannel,
  medium: "email" | "whatsapp",
): boolean {
  return channel === "both" || channel === medium;
}

/**
 * שני הנמענים.
 *
 * ‎`occupant` הוא „מי שגר שם” ולא „השוכר”: בדירה שהבעלים גר בה זהו
 * הבעלים עצמו. השם מתאר את **התפקיד בסיור** — מי פותח את הדלת —
 * ולא את מעמדו בעסקה.
 */
export type ViewingReminderAudience = "occupant" | "buyer";

/**
 * ‎**למי בצד הנכס שולחים — ולמה זה לא תמיד הבעלים.**
 *
 * דירה מושכרת שמוצעת למכירה: הבעלים מחליט על המכירה, אבל **הדלת
 * נפתחת על ידי מי שגר שם**. תזכורת שתגיע רק לבעלים משאירה את השוכר
 * בלי לדעת שמגיעים אליו הביתה — וזה גם לא מנומס וגם לא עובד.
 *
 * ‎`occupancy` הוא מקור האמת ולא קיומו של `occupantContactId`:
 * הסכמה קובעת במפורש שנכס בלי שוכר רשום **אינו** „הבעלים גר בו”.
 * לכן שוכר רשום נבחר רק כשנאמר במפורש שהנכס מושכר; בכל מצב אחר
 * חוזרים לבעלים, ובהיעדרו — אין למי לשלוח.
 */
export function viewingReminderOccupantContactId(property: {
  occupancy?: string | null;
  occupantContactId?: string | null;
  ownerContactId?: string | null;
}): string | null {
  if (property.occupancy === "rented" && (property.occupantContactId ?? null) !== null) {
    return property.occupantContactId ?? null;
  }
  return property.ownerContactId ?? null;
}

/**
 * המשתנים שאפשר לשתול בנוסח.
 *
 * בעברית ובסוגריים מסולסלים כפולים: המשרד עורך את הנוסח, ולא
 * מתכנת. `{{first_name}}` היה מחייב אותו לזכור שם באנגלית כדי
 * לכתוב משפט בעברית.
 */
export const VIEWING_REMINDER_PLACEHOLDERS = [
  { token: "{{שם}}", what: "שם הנמען" },
  { token: "{{שעה}}", what: "שעת הסיור (למשל 17:30)" },
  { token: "{{תאריך}}", what: "תאריך הסיור (למשל 27/08)" },
  { token: "{{כתובת}}", what: "כתובת הנכס" },
  { token: "{{סוכן}}", what: "שם הסוכן שקבע את הסיור" },
  { token: "{{משרד}}", what: "שם המשרד" },
] as const;

export interface ViewingReminderVars {
  שם: string;
  שעה: string;
  תאריך: string;
  כתובת: string;
  סוכן: string;
  משרד: string;
}

/** ברירת המחדל לנוסח — מה שנשלח כשהמשרד לא נגע בכלום. */
export const DEFAULT_VIEWING_REMINDER_MESSAGES: Readonly<
  Record<ViewingReminderAudience, string>
> = {
  occupant:
    "היי {{שם}}, מזכירים שהיום בעזרת השם בשעה {{שעה}} מגיעים לביקור בנכס ב{{כתובת}}. אם משהו השתנה — נשמח לדעת. {{סוכן}}, {{משרד}}",
  buyer:
    "היי {{שם}}, מזכירים שאנחנו נפגשים היום בעזרת השם בשעה {{שעה}} ב{{כתובת}}. נתראה! {{סוכן}}, {{משרד}}",
};

/**
 * שתילת הערכים בנוסח.
 *
 * ‎**החלפה אחת לכל מפתח, ולא לולאה על מה שהוחלף.** ערך שמכיל
 * במקרה `{{...}}` — כתובת שנכתבה בטעות כך, שם עם סוגריים — אינו
 * מתפרש שוב כמשתנה. זה ההבדל בין שתילה לבין הרצה של קלט משתמש.
 *
 * מפתח שאינו מוכר נשאר כפי שהוא ואינו נמחק: המשרד רואה במסך בדיוק
 * מה שיצא, ומבין שהוא כתב משהו שאין לו ערך — בעוד מחיקה שקטה
 * הייתה משאירה משפט קטוע בלי הסבר.
 */
export function renderViewingReminder(text: string, vars: ViewingReminderVars): string {
  return text.replace(/\{\{([^{}]+)\}\}/gu, (whole, key: string) => {
    const value = (vars as unknown as Record<string, unknown>)[key.trim()];
    return typeof value === "string" ? value : whole;
  });
}

/** התקרה על נוסח שנשמר — ארוך מזה אינו הודעת תזכורת. */
export const VIEWING_REMINDER_TEXT_MAX = 600;

/**
 * מה מונע תזכורת על פגישה מסוימת — או `null` כשמותר לשלוח.
 *
 * ההכרעה כאן ולא בשאילתה: „בוטלה” ו„לא הגיע” הם מצבים שהמסך
 * והסבב חייבים להסכים עליהם, ותנאי שנכתב פעמיים ב-SQL וב-TypeScript
 * מסכים עם עצמו רק ביום שנכתב.
 */
export function viewingReminderSkipReason(appointment: {
  kind: string;
  status: string;
  startsAt: Date;
}): string | null {
  if (appointment.kind !== "viewing") return "אינה סיור";
  if (appointment.status === "cancelled") return "הסיור בוטל";
  if (appointment.status === "no_show") return "סומן שלא הגיעו";
  if (appointment.status === "completed") return "הסיור כבר הסתיים";
  return null;
}

/**
 * ‎**מתי מגיע הרגע לשלוח.**
 *
 * החלון הוא „הסיור עוד לפנינו, ונשארו לו פחות מ-X שעות” — ולא
 * „בדיוק X שעות לפני”. סבב שרץ כל רבע שעה לעולם לא יפגע בנקודה
 * מדויקת, וסיור שנקבע שעה לפני שהוא מתחיל היה נשאר בלי תזכורת
 * כלל אילו הדרישה הייתה מדויקת. „מאוחר יותר מהמתוכנן” עדיף על
 * „בכלל לא”.
 */
export function viewingReminderDue(
  startsAt: Date,
  hoursBefore: number,
  now: Date,
): boolean {
  const ms = startsAt.getTime() - now.getTime();
  return ms > 0 && ms <= hoursBefore * 60 * 60 * 1000;
}
