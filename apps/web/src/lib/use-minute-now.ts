"use client";

import { useEffect, useState } from "react";

/**
 * „עכשיו” שמתקדם בעצמו, בקצב של דקה.
 *
 * מסך שמחשב `new Date()` בזמן הרינדור מקבל את הזמן של **הרינדור
 * האחרון**, לא את הזמן הנוכחי. כל עוד התוצאה היא תווית („באיחור”)
 * זה היה אי-דיוק; מרגע שהיא משתתפת בהכרעה — פגישה שעוד לא קרתה
 * לעומת פגישה שכבר קרתה — מסך שנשאר פתוח ממשיך להכריז על פגישת
 * 09:00 כ„הדבר לעשות עכשיו” גם ב-09:40, עד שמשהו אחר יגרום
 * לרינדור (ביקורת Codex).
 *
 * ‎**הטיק מיושר לגבול הדקה** ולא לרגע ההרכבה: טיימר שהותחל
 * ב-08:59:30 היה מתעורר ב-09:00:30, כלומר חצי דקה שבה המסך אומר
 * דבר שאינו נכון. `setTimeout` עד תחילת הדקה הבאה, ומשם `setInterval`.
 *
 * דקה ולא שנייה — אין על המסך דבר שמשתנה מהר יותר, ושישים רינדורים
 * לדקה היו מחיר על לא כלום.
 *
 * ‎`NowStamp` אינו משתמש בזה בכוונה: הוא מתחיל ב-`null` כדי שהשעה
 * לא תיכנס ל-HTML של השרת ותיצור אי-התאמה בהידרציה. כאן אין את
 * הבעיה — הדשבורד חוזר במצב טעינה עד שהמשתמש ידוע, ולכן הערך
 * ההתחלתי לעולם אינו מגיע לשרת.
 */
export function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);

  return now;
}
