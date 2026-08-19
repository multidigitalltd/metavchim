"use client";

import { useEffect, useState } from "react";
import { hebrewDateFull } from "@metavchim/shared";

/**
 * התאריך והשעה, בשורת הכותרת.
 *
 * עד כה הופיע רק התאריך הלועזי. מתווך ישראלי חי בשני לוחות — הוא קובע
 * פגישה ל"יום שלישי" ומוזמן לאירוע ב"ט"ו בשבט" — והשעון הוא מה שהופך
 * את השורה מקישוט למידע: "מה חשוב לעשות היום" נקרא אחרת ב-09:00
 * ובאחת עשרה בלילה.
 *
 * **הידרציה:** השעה נקבעת רק אחרי העלייה בדפדפן. רינדור בשרת היה
 * מייצר שעה אחת ב-HTML ואחרת אחרי ההידרציה — אזהרת אי-התאמה של React,
 * ובמקרה הגרוע שעה שקפאה. לכן המצב ההתחלתי הוא `null` והשורה מופיעה
 * ברגע שיש מה להציג.
 */

const dateFmt = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFmt = new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" });

export function NowStamp({ className }: { className?: string }): React.JSX.Element | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    /*
     * דקה, לא שנייה. השעון מציג שעות ודקות, וטיק כל שנייה היה מרנדר
     * שישים פעם יותר בלי לשנות דבר על המסך.
     */
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return null;
  // ההמרה העברית עשויה לא להיות זמינה בדפדפן ישן — אז פשוט לא מוצגת
  const hebrew = hebrewDateFull(now);

  return (
    <span className={className} style={{ fontSize: 15.5, color: "var(--color-text-muted)" }}>
      {dateFmt.format(now)}
      {hebrew ? ` · ${hebrew}` : ""}
      {" · "}
      {/*
        השעה עצמה ב-LTR: "09:00" בתוך משפט עברי מתהפך ל-"00:09" בחלק
        מהדפדפנים, וזו טעות שנראית כמו תקלת נתונים.
      */}
      <time dir="ltr" dateTime={now.toISOString()}>
        {timeFmt.format(now)}
      </time>
    </span>
  );
}
