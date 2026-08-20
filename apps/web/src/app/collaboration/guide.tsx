"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconCoins, IconGift, IconHandshake, IconInfo } from "../icons";

/**
 * ההסבר על רשת שיתופי הפעולה.
 *
 * המסך היה רשימות בלבד, והמתווכים לא הבינו ארבעה דברים: מה זה בכלל,
 * מה נחשף ללקוח שלהם, איך נחלקת העמלה, ואיפה כל חלק נמצא. שלושתם
 * הראשונים הם *חשש* — ומתווך שחושש לא משתף. ההסבר כאן אינו קישוט
 * אלא התנאי לשימוש.
 *
 * שני מנגנונים שונים לגמרי חיו במסך אחד ובלי הבחנה, ומכאן הבלבול
 * בקרדיטים. הקו העובר ביניהם הוא **מקור הליד ולא סוג הפעולה**:
 * ביקוש של משרד תיווך אחר הוא חינם — פרסום והצעה כאחד — ולקוח
 * שמופנה ממשרד אחר נושא תמורה, בין שקולטים אותו בלוח ובין שמציעים
 * נכס על ביקוש שהגיע ממקור חיצוני. ראו `coopOfferCost`
 * ב-collaboration-cost.
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
  /*
   * `null` = טרם ידוע. השרת אינו יכול לדעת מה יש ב-localStorage,
   * ולכן קריאה ממנו בזמן האתחול הייתה מייצרת רינדור שרת שונה
   * מרינדור הדפדפן — hydration mismatch בכל כניסה חוזרת. הקריאה
   * נעשית אחרי ההרכבה, ועד אז לא מוצג דבר.
   */
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    setOpen(window.localStorage.getItem(SEEN_KEY) !== "1");
  }, []);

  function dismiss(): void {
    setOpen(false);
    window.localStorage.setItem(SEEN_KEY, "1");
  }

  if (open === null) return null;

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
      style={{
        borderColor: "var(--color-primary)",
        background: "var(--color-primary-soft)",
      }}
      aria-labelledby="coop-guide-heading"
    >
      <h2
        id="coop-guide-heading"
        className="m-0 mb-1"
        style={{ fontSize: 17, fontWeight: 800 }}
      >
        איך עובדת רשת שיתופי הפעולה
      </h2>
      <p
        className="m-0 mb-4 text-[14.5px]"
        style={{ color: "var(--color-text-soft)" }}
      >
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
              <b className="text-[15px]">
                {index + 1}. {step.title}
              </b>
            </div>
            <p
              className="m-0 text-[14px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      {/*
        ההבחנה שהכי בלבלה — שני מנגנונים נפרדים באותו מסך — הייתה כאן
        טבלה בת שתי שורות ושמונה משפטים. היא ירדה מפני שהמסך עצמו כבר
        אומר אותה טוב יותר: ביקוש שעולה קרדיטים נושא תווית מחיר ליד
        הכפתור שלו, וההפניות יושבות בלשונית משלהן. הסבר שחוזר על מה
        שהמסך מראה הוא בדיוק הטקסט המיותר שהפך את האזור לעמוס.
      */}
      <p
        className="m-0 mb-3 text-[14.5px]"
        style={{ color: "var(--color-text-soft)" }}
      >
        <IconGift s={14} /> שיתוף פעולה עם משרד תיווך — <b>חינם בכל המסלולים</b>
        , ולכן אין תווית מחיר על רוב הכרטיסים. <IconCoins s={14} /> קרדיטים
        יורדים רק על הפניית לקוח ועל ביקוש שמסומן במקור חיצוני — ואלה היחידים
        שנושאים תווית מחיר לפני הלחיצה.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="mv-btn-action" onClick={dismiss}>
          הבנתי
        </button>
        <Link
          href="/buyers"
          className="mv-btn-plain"
          style={{ textDecoration: "none" }}
        >
          פרסם ביקוש מכרטיס קונה
        </Link>
      </div>
    </section>
  );
}


/**
 * כללי ההפניה — **ארבעה צעדים חזותיים, לא חמש פסקאות.**
 *
 * הגרסה הקודמת הייתה קיר טקסט מודגש שנפתח כברירת מחדל ותפס חצי
 * מסך; המשתמש דיווח בדיוק על זה: "הרבה טקסטים… שיהיה קצר ידידותי
 * ונעים". כל כלל התכווץ לצעד עם אייקון ומשפט אחד — מי שרוצה את
 * הניסוח המלא ימצא אותו במדריך; מי שמחליט אם לקלוט הפניה צריך
 * את התמצית.
 */
export function ReferralRulesPanel() {
  const steps = [
    {
      icon: <IconHandshake s={18} />,
      title: "מפנים לקוח שלא מתאים לכם",
      body: "המשרד המפנה קובע את המחיר, והסיבה תמיד מוצגת בלוח.",
    },
    {
      icon: <IconInfo s={18} />,
      title: "רואים הכול לפני התשלום",
      body: "הצהרת איכות על הלקוח — רצינות, תקציב, דחיפות — גלויה מראש.",
    },
    {
      icon: <IconCoins s={18} />,
      title: "משלמים על ההפניה בלבד",
      body: "העמלה נגבית בקליטה. אין עמלה נוספת בסגירת עסקה.",
    },
    {
      icon: <IconGift s={18} />,
      title: "מדרגים אחרי העבודה",
      body: "משרד שמצהיר אמת צובר מוניטין — ורואים אותו לפני כל קליטה.",
    },
  ];
  return (
    <div className="mv-ref-steps" aria-label="איך עובדת הפניית לקוח">
      {steps.map((step, i) => (
        <div className="mv-ref-step" key={step.title}>
          <span className="mv-ref-step-num" aria-hidden="true">
            {i + 1}
          </span>
          <span className="mv-ref-step-icon">{step.icon}</span>
          <b className="mv-ref-step-title">{step.title}</b>
          <p className="mv-ref-step-body">{step.body}</p>
        </div>
      ))}
      <p className="mv-ref-steps-privacy">
        שם וטלפון של הלקוח נחשפים רק אחרי הקליטה.
      </p>
    </div>
  );
}

