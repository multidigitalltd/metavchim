"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * סרגל שנגלל לרוחב — **שיראה שיש בו עוד, ושיביא את הנבחר לתצוגה.**
 *
 * ## התקלה
 *
 * שני סרגלי לשוניות במערכת נגללים לרוחב ומסתירים את פס הגלילה
 * בכוונה (פס גלילה מכער רצועת גלולות). הצירוף הזה יוצר בדיוק את מה
 * שדווח: לשונית שנקטעת באמצע מילה על הקצה, בלי שום סימן שאפשר
 * לגלול אליה — תוכן שנראה **חתוך**, לא תוכן שאפשר להגיע אליו. ועל
 * גביו: כניסה עם `?tab=` בוחרת לשונית שיושבת מחוץ למסך, כלומר
 * פאנל נפתח בלי שרואים מה נבחר.
 *
 * ## למה הוק ולא העתקה
 *
 * שלושת חלקי הפתרון תלויים זה בזה, וכל אחד לבדו חסר תועלת: מסכה
 * בלי מדידה לעולם לא נדלקת, מדידה בלי גלילה משאירה את הנבחר בחוץ,
 * וגלילה שאינה מכבדת את רוחב המסכה מציבה את הנבחר **מתחת** לדהייה.
 * עותק שני של שלושתם הוא עותק שיישחק — ולכן הם יושבים כאן פעם אחת.
 *
 * ## מה שנמדד ולא הונח
 *
 * ‎**`Math.abs` על `scrollLeft`**: ב-RTL כרום מחזיר ערך שלילי,
 * ומדידה שמניחה חיובי מכריזה „אין מה לגלול” בדיוק במסך שבו יש.
 *
 * ‎**משקיף על הילדים ולא רק על הסרגל**: מונה שמגיע אחרי הטעינה
 * („נכסים תואמים 1”) מרחיב לשונית בלי לשנות את תיבת הגבול של
 * הסרגל, ולכן משקיף שמאזין לו בלבד אינו נורה כלל.
 */

/**
 * רוחב אזור הדהייה, בפיקסלים — **חייב להתאים ל-CSS**
 * (`[data-fade]` ב-globals.css). השער `verify:scroll` משווה ביניהם.
 */
export const SCROLL_FADE_PX = 34;

/**
 * הריפוד שהגלילה משאירה סביב הנבחר — גדול מהדהייה, אחרת הלשונית
 * שנבחרה מוצבת מתחתיה: בוחרת ומעמעמת באותה נשימה.
 */
const PAD = SCROLL_FADE_PX + 4;

export function useScrollAffordance<T extends HTMLElement>(
  /**
   * מחרוזת שמשתנה בכל דבר שמזיז את הגיאומטריה — תוויות, מונים,
   * והפריט הנבחר. שינוי שלה מפעיל מדידה מחדש **וגלילה** של הנבחר.
   */
  signature: string,
): (el: T | null) => void {
  /*
   * ‎**ref של callback ולא `useRef`** — וזה נמדד, לא הונח.
   *
   * ‎`useRef` נשאר `null` כשהסרגל מורכב **אחרי** הריצה הראשונה של
   * האפקט: מסך ההגדרות חוזר מוקדם בזמן טעינת המשתמש, ולכן האפקט רץ
   * על `null`, והתלויות אינן משתנות אחר כך — כלומר `data-fade`
   * לעולם אינו נקבע והמסכה לעולם אינה נדלקת. בדיוק זה נצפה שם:
   * 657 פיקסלים של גלישה בלי שום דהייה.
   *
   * ‎`useState` על הצומת הופך את ההרכבה עצמה לתלות.
   */
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null): void => setNode(el), []);

  /** האם נשאר מה לגלול, ולאיזה צד — זה מה ש-CSS אינו יודע לשאול. */
  const measure = useCallback((): void => {
    const el = node;
    if (el === null) return;
    const from = Math.abs(el.scrollLeft);
    const room = el.scrollWidth - el.clientWidth;
    if (room <= 1) {
      el.dataset["fade"] = "none";
      return;
    }
    const atStart = from <= 1;
    const atEnd = from >= room - 1;
    el.dataset["fade"] = atStart ? "end" : atEnd ? "start" : "both";
  }, [node]);

  useEffect(() => {
    const el = node;
    if (el === null) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    /*
     * ‎`ResizeObserver` ולא אירוע `resize` של החלון: הסרגל צר
     * מהחלון ומשתנה גם כשהחלון אינו משתנה — סרגל צד שנפתח, מכשיר
     * שהסתובב, או לשונית שהתרחבה בגלל מונה.
     */
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [node, measure, signature]);

  /**
   * הנבחר נגלל לתצוגה, מעבר לאזור הדהייה.
   *
   * הגלילה נעשית על הסרגל בלבד (`scrollLeft`) ולא דרך
   * ‎`scrollIntoView`, שגורר גם את העמוד אנכית וקופץ מתחת לאצבע.
   * ההשוואה מול הקצה **פחות** הריפוד: לשונית שנמצאת בתוך הסרגל אך
   * יושבת בתוך הדהייה לא הפעילה אף תנאי, ונשארה מעומעמת.
   */
  useEffect(() => {
    const el = node;
    if (el === null) return;
    const chosen = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (chosen === null) return;
    const box = el.getBoundingClientRect();
    const mark = chosen.getBoundingClientRect();
    if (mark.left < box.left + PAD) el.scrollLeft -= box.left + PAD - mark.left;
    else if (mark.right > box.right - PAD) el.scrollLeft += mark.right - (box.right - PAD);
    measure();
  }, [node, measure, signature]);

  return ref;
}
