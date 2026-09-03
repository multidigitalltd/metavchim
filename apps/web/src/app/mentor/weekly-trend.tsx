"use client";

import { formatJerusalemDate, ON_TRACK_THRESHOLD } from "@metavchim/shared";

/**
 * ‎**הגרף השבועי — שלושה-עשר שבועות, ומה שקרה בכל אחד.**
 *
 * ## למה עמודות, ולא קו
 *
 * ‏קו מרמז על רצף: הוא מחבר בין נקודה לנקודה ואומר „ומשם המשכת
 * לכאן”. שבועות אינם כאלה — כל שבוע הוא התחייבות שנפרעה או לא,
 * ושבוע חלש אחרי שבוע חזק אינו „ירידה במגמה” אלא שבוע חלש. עמודה
 * נפרדת לכל שבוע אומרת בדיוק את זה.
 *
 * ‏זו גם הסיבה שאין כאן קו מגמה או ממוצע נע: המנטור הזה מודד ביצוע
 * שבועי מול התחייבות שבועית, ומגמה מוחלקת הייתה מטשטשת בדיוק את
 * המידע שאפשר לפעול לפיו.
 *
 * ## ההכרעה החשובה: „לא הבטחתי” אינו „נכשלתי”
 *
 * ‏שבוע בלי התחייבות מגיע כ-`null`, והוא **אינו** מצויר כעמודה
 * בגובה אפס. עמודה נמוכה אומרת „ניסית וכמעט לא עשית”; שבוע שלא
 * הובטח בו דבר לא נמדד כלל. בלי ההבחנה הזו, מתווך שנכנס בפעם
 * הראשונה היה רואה שלושה-עשר כישלונות — וזו בדיוק ההפך מהנקודה.
 *
 * ‏לכן שבוע כזה מצויר כקו-בסיס דק, והמקרא אומר במפורש מה הוא.
 */

export interface WeekPoint {
  weekKey: string;
  percent: number | null;
  current: boolean;
}

/** ‏‎`YYYY-MM-DD` ⇒ „30.08” — יום וחודש בלבד, מתחת לעמודה. */
function shortDay(iso: string): string {
  return formatJerusalemDate(new Date(`${iso}T12:00:00.000Z`)).slice(0, 5);
}

export function WeeklyTrend({ weeks }: { weeks: WeekPoint[] }): React.JSX.Element {
  const measured = weeks.filter((w) => w.percent !== null);

  if (measured.length === 0) {
    return (
      <p className="m-0 text-[length:var(--type-body)]">
        עוד אין מה לצייר. ברגע שתקבע התחייבות שבועית, כל שבוע יקבל כאן עמודה
        משלו — ותוכל לראות את השרשרת נבנית.
      </p>
    );
  }

  const best = Math.max(...measured.map((w) => w.percent as number));
  const onTrackWeeks = measured.filter(
    (w) => (w.percent as number) >= ON_TRACK_THRESHOLD,
  ).length;

  return (
    <div>
      {/*
         ‎`role="img"` עם תיאור מילולי: גרף עמודות שנשען על גובה בלבד
         אינו נגיש למי שאינו רואה אותו, והמספרים עצמם כבר קיימים —
         הם רק צריכים להיאמר.
      */}
      {/*
         ‎`items-stretch` ולא `items-end`: העמודות מקבלות את גובה
         השורה, וגובה באחוזים בתוכן נפתר מולו. עם `items-end` כל
         עמודה הייתה בגובה התוכן שלה — כלומר אפס — וכל הגרף היה
         נמעך לקו אחד. זה נתפס בצילום, לא בבדיקה.
      */}
      <div
        className="flex items-stretch gap-1.5 sm:gap-2"
        style={{ height: 132 }}
        role="img"
        aria-label={`ביצוע שבועי ב-${measured.length} השבועות שנמדדו: ${onTrackWeeks} מהם מעל ${ON_TRACK_THRESHOLD} אחוז, והגבוה ביותר ${best} אחוז`}
      >
        {weeks.map((week) => {
          const value = week.percent;
          const height = value === null ? 0 : Math.max(3, value);
          const reached = value !== null && value >= ON_TRACK_THRESHOLD;
          return (
            <div key={week.weekKey} className="flex min-w-0 flex-1 flex-col items-center">
              {/* ‏אזור העמודה תופס את כל מה שנשאר מעל התווית */}
              <div className="relative flex w-full flex-1 items-end">
                {/* ‏קו הסף — נמתח על פני כל עמודה, כדי שאפשר יהיה למדוד בעין */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0"
                  style={{
                    bottom: `${ON_TRACK_THRESHOLD}%`,
                    borderTop: "1px dashed var(--color-text-muted)",
                    opacity: 0.4,
                  }}
                />
                {value === null ? (
                  /*
                     ‏שבוע בלי התחייבות: קו בסיס, לא עמודה. ההבדל הוא
                     בין „לא הבטחת” ל„נכשלת”, וגובה אפס אומר את השני.
                  */
                  <span
                    className="w-full rounded-sm"
                    style={{ height: 3, background: "var(--color-input-border)" }}
                    title={`${shortDay(week.weekKey)} — לא נקבעה התחייבות`}
                  />
                ) : (
                  <span
                    className="w-full rounded-t-md"
                    style={{
                      height: `${height}%`,
                      background: reached
                        ? "var(--domain-green-fg)"
                        : "var(--domain-amber-fg)",
                      outline: week.current ? "2px solid var(--color-text)" : "none",
                      outlineOffset: 1,
                    }}
                    title={`${shortDay(week.weekKey)} — ${value}% ביצוע`}
                  />
                )}
              </div>
              <span
                className="mt-1 truncate text-[length:var(--type-caption)]"
                style={{
                  color: week.current ? "var(--color-text)" : "var(--color-text-muted)",
                  fontWeight: week.current ? 700 : 400,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {shortDay(week.weekKey)}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block rounded-sm"
            style={{ width: 10, height: 10, background: "var(--domain-green-fg)" }}
          />
          עמדת ביעד
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block rounded-sm"
            style={{ width: 10, height: 10, background: "var(--domain-amber-fg)" }}
          />
          מתחת ל-{ON_TRACK_THRESHOLD}%
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block rounded-sm"
            style={{ width: 10, height: 3, background: "var(--color-input-border)" }}
          />
          שבוע בלי התחייבות — לא נמדד, לא נכשל
        </span>
      </div>
    </div>
  );
}
