"use client";

import { useState } from "react";
import Link from "next/link";
import { IconCart, IconCoins, IconHandshake, IconInfo, IconLock } from "../icons";

/**
 * ההסבר על רשת שיתופי הפעולה.
 *
 * המסך היה רשימות בלבד, והמתווכים לא הבינו ארבעה דברים: מה זה בכלל,
 * מה נחשף ללקוח שלהם, איך נחלקת העמלה, ואיפה כל חלק נמצא. שלושתם
 * הראשונים הם *חשש* — ומתווך שחושש לא משתף. ההסבר כאן אינו קישוט
 * אלא התנאי לשימוש.
 *
 * שני מנגנונים שונים לגמרי חיו במסך אחד ובלי הבחנה, ומכאן הבלבול
 * בקרדיטים: **שיתוף פעולה בין משרדים הוא חינם**, וקרדיטים משמשים
 * אך ורק לקניית ליד בשוק הלידים. ההפרדה הזו מודגשת בכל מקום.
 */

/** מה הרשת נותנת — שלושה שלבים, בשפה של מתווך. */
const STEPS = [
  {
    icon: <IconHandshake s={18} />,
    title: "יש לכם קונה ואין לו נכס",
    body: "מפרסמים את הביקוש שלו ברשת — בלי שם ובלי טלפון. משרדים אחרים רואים מה הוא מחפש, ומי שיש לו נכס מתאים מציע אותו.",
  },
  {
    icon: <IconInfo s={18} />,
    title: "יש לכם נכס ואין לו קונה",
    body: "עוברים על הביקושים ברשת ומציעים את הנכס שלכם. המערכת אף מסמנת אילו מהנכסים שלכם מתאימים לכל ביקוש.",
  },
  {
    icon: <IconCoins s={18} />,
    title: "העסקה נסגרת — והעמלה מתחלקת",
    body: "האחוזים נקבעים מראש, ברגע הפרסום או ההצעה, ולא במו״מ אחרי שהלקוח כבר התעניין.",
  },
];

/**
 * כרטיס הפתיחה. נסגר אחרי קריאה ונשמר בדפדפן — מי שכבר מכיר
 * לא צריך לראות אותו בכל כניסה, ומי שחדש לא יתחיל בלי הסבר.
 */
const SEEN_KEY = "mv_coop_guide_seen";

export function CollaborationGuide() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SEEN_KEY) !== "1";
  });

  function dismiss(): void {
    setOpen(false);
    window.localStorage.setItem(SEEN_KEY, "1");
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mv-btn-plain mb-4"
        onClick={() => setOpen(true)}
      >
        <IconInfo s={14} /> איך עובדת הרשת?
      </button>
    );
  }

  return (
    <section
      className="mb-5 rounded-xl border p-4"
      style={{ borderColor: "var(--color-primary)", background: "var(--color-primary-soft)" }}
      aria-labelledby="coop-guide-heading"
    >
      <h2 id="coop-guide-heading" className="m-0 mb-1" style={{ fontSize: 16, fontWeight: 800 }}>
        איך עובדת רשת שיתופי הפעולה
      </h2>
      <p className="m-0 mb-4 text-[13px]" style={{ color: "var(--color-text-soft)" }}>
        קונה שאין לו נכס, ונכס שאין לו קונה — יושבים בשני משרדים שונים. הרשת
        מחברת ביניהם בלי שאף צד יאבד את הלקוח שלו.
      </p>

      <ol className="m-0 mb-4 grid list-none gap-3 p-0 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-lg p-3"
            style={{ background: "var(--color-surface)" }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span style={{ color: "var(--color-primary)" }}>{step.icon}</span>
              <b className="text-[13.5px]">
                {index + 1}. {step.title}
              </b>
            </div>
            <p className="m-0 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      {/*
        ההבחנה שהכי בלבלה: שני מנגנונים נפרדים באותו מסך. היא מוצגת
        כטבלה ולא כפסקה, כי זו בדיוק ההשוואה שהמשתמש עושה בראש.
      */}
      <div
        className="mb-3 overflow-x-auto rounded-lg"
        style={{ background: "var(--color-surface)" }}
      >
        <table className="w-full border-collapse text-[12.5px]">
          <caption className="p-2.5 pb-1 text-start font-bold">
            שני דברים נפרדים — וזה מה שמבלבל:
          </caption>
          <tbody>
            <tr>
              <td className="p-2.5" style={{ borderBottom: "1px solid var(--color-row-border)", width: "42%" }}>
                <b>
                  <IconHandshake s={14} /> שיתוף פעולה עם משרד
                </b>
                <div style={{ color: "var(--color-text-muted)" }}>
                  פרסום ביקוש · הצעת נכס
                </div>
              </td>
              <td className="p-2.5" style={{ borderBottom: "1px solid var(--color-row-border)" }}>
                <b style={{ color: "var(--color-primary)" }}>חינם לגמרי</b>
                <div style={{ color: "var(--color-text-muted)" }}>
                  בכל המסלולים. אתם מתחלקים בעמלה עם המשרד השני — לא משלמים לנו.
                </div>
              </td>
            </tr>
            <tr>
              <td className="p-2.5">
                <b>
                  <IconCart s={14} /> קניית ליד בשוק
                </b>
                <div style={{ color: "var(--color-text-muted)" }}>
                  ליד ממקור חיצוני
                </div>
              </td>
              <td className="p-2.5">
                <b>עולה קרדיטים</b>
                <div style={{ color: "var(--color-text-muted)" }}>
                  הליד נקנה בכסף אמיתי מהספק, ולכן יש לו מחיר. זה המקום היחיד
                  שבו קרדיטים יורדים.
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="mv-btn-action" onClick={dismiss}>
          הבנתי
        </button>
        <Link href="/buyers" className="mv-btn-plain" style={{ textDecoration: "none" }}>
          פרסם ביקוש מכרטיס קונה
        </Link>
      </div>
    </section>
  );
}

/**
 * מה נחשף ומה לא.
 *
 * החשש הזה הוא מה שעוצר מתווכים מלשתף: "הם ייקחו לי את הלקוח".
 * רשימה מפורשת של מה שהצד השני רואה — ובעיקר של מה שהוא **לא**
 * רואה — עונה עליו בלי שיצטרכו לשאול.
 */
export function PrivacyPanel() {
  return (
    <details
      className="mb-5 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <summary className="cursor-pointer font-semibold">
        <IconLock s={15} /> מה המשרד השני רואה על הלקוח שלי?
      </summary>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="m-0 mb-1.5 text-[13px] font-bold" style={{ color: "var(--color-primary)" }}>
            ✓ נחשף
          </p>
          <ul className="m-0 ps-4 text-[12.5px]" style={{ color: "var(--color-text-soft)" }}>
            <li>הערים והשכונות שהוא מחפש</li>
            <li>טווח חדרים וסוג העסקה</li>
            <li>תקציב — <b>מעוגל כלפי מעלה</b> ל-100 אלף ₪</li>
            <li>דרישות החובה (מעלית, חניה וכו&apos;)</li>
            <li>התיאור החופשי שאתם כותבים</li>
          </ul>
        </div>
        <div>
          <p className="m-0 mb-1.5 text-[13px] font-bold" style={{ color: "var(--color-danger)" }}>
            ✕ לא נחשף
          </p>
          <ul className="m-0 ps-4 text-[12.5px]" style={{ color: "var(--color-text-soft)" }}>
            <li>שם הלקוח</li>
            <li>מספר טלפון</li>
            <li>כתובת אימייל</li>
            <li>התקציב המדויק</li>
            <li>ההערות הפנימיות שלכם</li>
          </ul>
        </div>
      </div>

      <p className="m-0 mt-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        גם אחרי שמשרד מציע נכס — הוא עדיין לא מקבל את פרטי הלקוח. אתם מחליטים
        אם ההצעה מעניינת, ורק אז נפתח קשר בין המשרדים. <b>הלקוח נשאר שלכם.</b>
      </p>
    </details>
  );
}

/**
 * הסבר חלוקת העמלה.
 *
 * "50%/50%" בלי הקשר אינו אומר דבר: חצי ממה, מי גובה, ומתי. שלוש
 * השאלות האלה חוזרות בכל שיחת תמיכה על שת"פ.
 */
export function CommissionPanel() {
  return (
    <details
      className="mb-5 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <summary className="cursor-pointer font-semibold">
        <IconCoins s={15} /> איך נחלקת העמלה?
      </summary>

      <p className="m-0 mt-3 mb-2 text-[13px]">
        האחוז שנקבע הוא <b>חלקכם בעמלה של העסקה</b> — לא סכום שמשולם למערכת.
      </p>
      <ul className="m-0 mb-3 ps-4 text-[12.5px]" style={{ color: "var(--color-text-soft)" }}>
        <li>
          <b>50% / 50%</b> — החלוקה המקובלת: כל צד מקבל חצי מדמי התיווך.
        </li>
        <li>
          <b>60% / 40%</b> — לטובת מי שהביא את הצד המשמעותי יותר בעסקה.
        </li>
        <li>
          כל צד גובה מהלקוח <b>שלו</b>, לפי ההסכם שחתם איתו.
        </li>
      </ul>
      <p className="m-0 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        האחוז נקבע <b>מראש</b> — ברגע פרסום הביקוש או הגשת ההצעה — ולא במו&quot;מ
        אחרי שהלקוח כבר התעניין. שם בדיוק נשברים שיתופי פעולה.
        המערכת מציגה את החלוקה לשני הצדדים לפני כל החלטה.
      </p>
    </details>
  );
}
