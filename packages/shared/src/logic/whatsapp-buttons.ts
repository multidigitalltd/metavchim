/**
 * כפתורים בוואטסאפ — בניית ההודעה האינטראקטיבית ופענוח הלחיצה.
 *
 * ## למה כפתור ולא מילה
 *
 * „אשר” הוא מילה שצריך להקליד בזמן נהיגה, בין פגישות, מהטלפון.
 * כפתור הוא לחיצה אחת, והוא גם מסיר את כל הדו-משמעות: „כן, אבל
 * תשנה את המחיר” אינו אישור, ומילה בודדת בשדה טקסט לא תמיד מבדילה.
 *
 * ## מה Meta מתירה
 *
 * - עד **שלושה** כפתורי תשובה מהירה (`button`), כותרת עד 20 תווים.
 * - רשימה (`list`) עד עשר שורות, מאחורי כפתור פתיחה אחד.
 * - גוף ההודעה האינטראקטיבית מוגבל ל-**1024** תווים — פחות בהרבה
 *   מ-4096 של הודעת טקסט. גוף ארוך מזה חייב לרדת לטקסט רגיל, אחרת
 *   Meta דוחה את ההודעה כולה והמתווך לא מקבל דבר.
 * - הכול מותר **רק בתוך חלון 24 השעות**; מחוצה לו נדרשת תבנית.
 *
 * המזהה שחוזר בלחיצה הוא מה שאנחנו שמנו בו, ולכן הוא נושא את
 * הפעולה. תחילית `mv:` מוודאת שאנחנו מפענחים רק מזהים שלנו.
 */

/** תקרת התווים של כותרת כפתור אצל Meta. */
export const WA_BUTTON_TITLE_MAX = 20;
/** תקרת גוף ההודעה האינטראקטיבית — שונה מתקרת הטקסט הרגיל. */
export const WA_INTERACTIVE_BODY_MAX = 1024;
/** תקרת הכפתורים בהודעת „תשובה מהירה”. */
export const WA_MAX_REPLY_BUTTONS = 3;
/** תקרת השורות ברשימה. */
export const WA_MAX_LIST_ROWS = 10;

const ID_PREFIX = "mv";

/** הפעולות שכפתור יכול לשאת. סגורה בכוונה — מזהה חופשי אינו פקודה. */
export type WhatsAppButtonAction =
  /** אישור ההצעה הממתינה */
  | "confirm"
  /** ביטול ההצעה הממתינה */
  | "cancel"
  /** בחירת מועמד מרשימה — הארגומנט הוא המספר הסידורי (1-based) */
  | "pick"
  /** פקודה מוכנה שנשלחת למנוע כאילו הוקלדה — הארגומנט הוא המפתח */
  | "cmd"
  /** השתקת עדכונים לזמן קצוב — הארגומנט הוא דקות */
  | "snooze"
  /**
   * ‎**פתיחת תשלום לחידוש המנוי.**
   *
   * ‏פעולה משלה ולא `cmd`: `cmd` עובר דרך מנוע הפענוח, והמנוע
   * ‏כלל אינו רץ למשרד שתקופתו נגמרה — כלומר הכפתור היה מוצג
   * ‏ולא עושה דבר, בדיוק למי שנועד. וגם: פתיחת דף תשלום מבטלת
   * ‏כל תשלום ממתין של המשרד, ולכן היא חייבת להיות **בקשה
   * ‏מפורשת אחת** ולא נגזרת של פענוח טקסט.
   */
  | "renew"
  /**
   * ‎**תמלול חוזר של אותה הקלטה** — הארגומנט הוא מזהה המדיה.
   *
   * ‏פעולה משלה ולא `cmd`: `cmd` נשלח למנוע ההבנה כאילו הוקלד, ואין
   * ‏משפט בעברית שאומר „קח את מזהה המדיה 123 ותמלל אותו שוב”. מה
   * ‏שנדרש הוא להריץ מחדש בדיוק את המסלול שנכשל — על אותה הקלטה,
   * ‏שעדיין שמורה אצל Meta — ולא לבקש מהמתווך להקליט שוב.
   */
  | "retry";

export interface WhatsAppButton {
  action: WhatsAppButtonAction;
  /** ארגומנט קצר (מספר או מפתח) — נכנס למזהה שחוזר בלחיצה */
  arg?: string;
  /**
   * חותם ההצעה שהכפתור שייך לה.
   *
   * בלעדיו לחיצה על „אשר” בהודעה ישנה מבצעת את ההצעה ה*נוכחית*:
   * המתווך התעלם מהצעה, ביקש משהו אחר, ואז לחץ בטעות על הכפתור
   * הישן שגלל אליו — והמערכת ביצעה בקשה שהוא לא הסתכל עליה
   * (ביקורת Codex). הצד המקבל משווה ודוחה חותם שאינו תואם.
   */
  token?: string;
  title: string;
}

export function encodeButtonId(
  action: WhatsAppButtonAction,
  arg?: string,
  token?: string,
): string {
  return [ID_PREFIX, action, arg ?? "", token ?? ""].join(":").replace(/:+$/u, "");
}

export interface DecodedButton {
  action: WhatsAppButtonAction;
  arg?: string;
  token?: string;
}

/** null = לא מזהה שלנו (או פעולה שאיננו מכירים) — יטופל כטקסט רגיל. */
export function decodeButtonId(id: string): DecodedButton | null {
  const parts = id.split(":");
  if (parts[0] !== ID_PREFIX || parts.length < 2) return null;
  const action = parts[1];
  if (
    action !== "confirm" &&
    action !== "cancel" &&
    action !== "pick" &&
    action !== "cmd" &&
    action !== "snooze" &&
    action !== "renew" &&
    action !== "retry"
  ) {
    return null;
  }
  /*
   * ‎`cmd` נושא את משפט הפקודה עצמו, ומשפט יכול להכיל נקודתיים —
   * „פגישה ב-17:30”. פיצול רגיל היה חותך אותו שם ושולח למנוע פקודה
   * שונה ממה שהוצג על הכפתור. לכפתורי `cmd` אין חותם (לחיצה ישנה
   * רק מנסחת הצעה מחדש — הביצוע ממילא נעצר על „אשר”), ולכן כל מה
   * שאחרי הפעולה הוא הארגומנט, נקודתיים ועוד.
   */
  if (action === "cmd") {
    const arg = parts.slice(2).join(":");
    return { action, ...(arg === "" ? {} : { arg }) };
  }
  const arg = parts[2] ?? "";
  const token = parts.slice(3).join(":");
  return {
    action,
    ...(arg === "" ? {} : { arg }),
    ...(token === "" ? {} : { token }),
  };
}

/**
 * כותרת שנכנסת בתקרה. חיתוך ולא דחייה: כפתור עם שם קטוע עדיף על
 * הודעה שנדחית כולה — והכותרות שלנו קצרות ממילא.
 */
export function buttonTitle(text: string): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length <= WA_BUTTON_TITLE_MAX
    ? clean
    : `${clean.slice(0, WA_BUTTON_TITLE_MAX - 1)}…`;
}

/** האם הגוף נכנס בהודעה אינטראקטיבית, או שצריך לרדת לטקסט. */
export function fitsInteractive(body: string): boolean {
  return body.trim() !== "" && body.length <= WA_INTERACTIVE_BODY_MAX;
}

/** מטען „תשובה מהירה” — עד שלושה כפתורים מתחת לגוף ההודעה. */
export function replyButtonsPayload(
  to: string,
  body: string,
  buttons: readonly WhatsAppButton[],
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, WA_MAX_REPLY_BUTTONS).map((button) => ({
          type: "reply",
          reply: {
            id: encodeButtonId(button.action, button.arg, button.token),
            title: buttonTitle(button.title),
          },
        })),
      },
    },
  };
}

export interface WhatsAppListRow extends WhatsAppButton {
  /** שורת משנה ברשימה — מה שמבדיל בין שני מועמדים עם שם דומה */
  description?: string;
}

/**
 * מטען רשימה — לבחירה מתוך יותר משלושה מועמדים.
 *
 * `description` חשוב כאן במיוחד: שני קונים בשם „כהן” נראים זהים
 * ברשימה בלי השורה השנייה, והבחירה הופכת לניחוש.
 */
export function listPayload(
  to: string,
  body: string,
  openLabel: string,
  rows: readonly WhatsAppListRow[],
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonTitle(openLabel),
        sections: [
          {
            rows: rows.slice(0, WA_MAX_LIST_ROWS).map((row) => ({
              id: encodeButtonId(row.action, row.arg, row.token),
              title: buttonTitle(row.title),
              // Meta מגבילה גם אותה; 72 היא התקרה המתועדת
              ...(row.description === undefined || row.description === ""
                ? {}
                : { description: row.description.slice(0, 72) }),
            })),
          },
        ],
      },
    },
  };
}
