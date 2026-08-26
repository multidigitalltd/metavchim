/**
 * ‎**„מועד מהיר” — ארבעה צ'יפים במקום בורר תאריכים (SPEC-4c §6).**
 *
 * שדה `datetime-local` הוא ארבע פעולות: לפתוח לוח, לבחור יום, לבחור
 * שעה, לאשר. מתווך שמקליד משימה בין שתי שיחות לא יעשה אותן, ולכן
 * המשימה נשמרת בלי מועד — ומשימה בלי מועד אינה מגיעה לתדריך הבוקר
 * ואינה מזכירה לאיש דבר. הצ'יפ הופך את זה ללחיצה אחת.
 *
 * ## למה זה כאן ולא ב-JSX
 *
 * ‎**זו אריתמטיקה של אזור זמן, וזה בדיוק המקום שבו היא נשברת.**
 * ‎„מחר בבוקר” חייב להיות 09:00 בשעון **ישראל**, ולא 09:00 בשעון
 * המכשיר של מי שנמצא בחו"ל — ו„מחר” חייב להיות היום הישראלי הבא,
 * שאינו „עוד 24 שעות” בליל מעבר שעון.
 *
 * החישוב נשען על `jerusalemDayStart`, שמזיז ימי **לוח** ישראליים,
 * ומחזיר מחרוזת שעת-קיר — בדיוק מה ששדה הטופס מציג וממה שהשמירה
 * ממירה חזרה. אין כאן המרה שנייה שיכולה לסטות מהראשונה.
 *
 * ב-`apps/web` אין הרצת בדיקות, וזו החלטה עם מעבר שעון בתוכה.
 */

import { jerusalemDayStart, jerusalemWallIsoToUtc, jerusalemWallParts, jerusalemWeekStart } from "./israel-time.js";

export interface QuickDueOption {
  key: string;
  label: string;
  /**
   * ערך לשדה `datetime-local` — **שעת קיר ישראלית**, לא UTC.
   *
   * זה מה שהשדה מציג, וזה מה ש-`resolveJerusalemLocalInput` ממיר
   * בשמירה. מסלול המרה אחד לשני הכיוונים.
   */
  value: string;
}

/** שעת בוקר של יום עבודה — „בבוקר” אינו 00:00. */
const MORNING = "09:00";
/**
 * סוף יום העבודה.
 *
 * ‎„היום” אינו חצות: משימה שמועדה 23:59 אינה „היום” אלא „לפני
 * שתלך לישון”, והתזכורת עליה תגיע אחרי שהמשרד נסגר.
 */
const END_OF_DAY = "18:00";

function wallValue(now: Date, offsetDays: number, time: string): string {
  return `${jerusalemWallParts(jerusalemDayStart(now, offsetDays)).date}T${time}`;
}

/**
 * ארבעת המועדים המהירים — **ורק אלה שעדיין לפנינו.**
 *
 * ‎„היום 18:00” בשעה שבע בערב אינו מועד יעד אלא משימה שנולדה
 * באיחור. הצ'יפ נעלם, והמתווך עדיין יכול להקליד כל שעה בשדה עצמו;
 * מה שאינו יכול לקרות הוא לחיצה אחת שמייצרת פיגור.
 *
 * ההשוואה נעשית על הרגע האמיתי (`jerusalemWallIsoToUtc`) ולא על
 * מחרוזות, כי מחרוזת שעת-קיר אינה ניתנת להשוואה מול `now`.
 */
export function quickDueOptions(now: Date): QuickDueOption[] {
  const candidates: QuickDueOption[] = [
    { key: "today", label: "היום", value: wallValue(now, 0, END_OF_DAY) },
    { key: "tomorrow", label: "מחר בבוקר", value: wallValue(now, 1, MORNING) },
    { key: "in3", label: "בעוד 3 ימים", value: wallValue(now, 3, MORNING) },
    {
      key: "next_week",
      label: "בשבוע הבא",
      /*
       * תחילת השבוע הישראלי הבא — ראשון, ולא „בעוד שבעה ימים”.
       * „בשבוע הבא” הוא אמירה על הלוח ולא על מרחק בימים, ומתווך
       * שאומר זאת ביום חמישי מתכוון לראשון שאחריו.
       */
      value: `${jerusalemWallParts(jerusalemWeekStart(now, 1)).date}T${MORNING}`,
    },
  ];
  return candidates.filter((option) => jerusalemWallIsoToUtc(option.value).getTime() > now.getTime());
}
