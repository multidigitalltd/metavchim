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
  | "snooze";

export interface WhatsAppButton {
  action: WhatsAppButtonAction;
  /** ארגומנט קצר (מספר או מפתח) — נכנס למזהה שחוזר בלחיצה */
  arg?: string;
  title: string;
}

export function encodeButtonId(action: WhatsAppButtonAction, arg?: string): string {
  return arg === undefined ? `${ID_PREFIX}:${action}` : `${ID_PREFIX}:${action}:${arg}`;
}

/** null = לא מזהה שלנו (או פעולה שאיננו מכירים) — יטופל כטקסט רגיל. */
export function decodeButtonId(
  id: string,
): { action: WhatsAppButtonAction; arg?: string } | null {
  const parts = id.split(":");
  if (parts[0] !== ID_PREFIX || parts.length < 2) return null;
  const action = parts[1];
  if (
    action !== "confirm" &&
    action !== "cancel" &&
    action !== "pick" &&
    action !== "cmd" &&
    action !== "snooze"
  ) {
    return null;
  }
  const arg = parts.slice(2).join(":");
  return arg === "" ? { action } : { action, arg };
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
            id: encodeButtonId(button.action, button.arg),
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
              id: encodeButtonId(row.action, row.arg),
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
