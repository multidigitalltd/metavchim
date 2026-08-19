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
        style={{ fontSize: 16, fontWeight: 800 }}
      >
        איך עובדת רשת שיתופי הפעולה
      </h2>
      <p
        className="m-0 mb-4 text-[13px]"
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
              <b className="text-[13.5px]">
                {index + 1}. {step.title}
              </b>
            </div>
            <p
              className="m-0 text-[12.5px]"
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
        className="m-0 mb-3 text-[13px]"
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
 * מעטפת אחידה לפאנלי ההסבר.
 *
 * שלושת הפאנלים היו שלושה עותקים של אותו `details` בריפוד מלא ובגופן
 * מלא, ולכן במצב סגור — שהוא רוב הזמן — כל אחד מהם תפס כרטיס גדול
 * וכמעט ריק מעל התוכן שבאמת באו לראות. שורה סגורה היא **כותרת ולא
 * כרטיס**: ריפוד הדוק וגופן קטן, והריווח נפתח רק יחד עם התוכן.
 *
 * מקור אחד לשלושתם — אחרת הם נפרדים ביום שמישהו משנה אחד מהם.
 */
function GuidePanel({
  icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="mb-2.5 rounded-lg border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">
        {/*
          עטיפת inline-flex ולא אייקון חשוף: ה-preflight של Tailwind
          מגדיר `svg { display: block }`, ולכן האייקון בתוך summary ירד
          לשורה משלו והשורה ה"סגורה" תפסה שלוש שורות. flex על ה-summary
          עצמו היה פותר את זה ומוחק את משולש הפתיחה — הוא זקוק
          ל-list-item — ולכן הפנימיות הן שהופכות לשורה אחת.
        */}
        <span className="inline-flex items-center gap-1.5 align-middle">
          {icon} {title}
        </span>
      </summary>
      {/* קו מפריד ולא רווח: הוא מסמן איפה ההסבר מתחיל בלי לגזול גובה */}
      <div
        className="border-t px-3 py-2.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        {children}
      </div>
    </details>
  );
}

/**
 * כללי ההפניה.
 *
 * ארבעה כללים שכולם מפתיעים אם מגלים אותם אחרי התשלום: מי קובע את
 * התמורה, כמה מתוכה הולך לפלטפורמה, שהתשלום אינו מותנה בתוצאה, ומה
 * מאזן את זה. הפאנל יושב בלשונית ההפניות עצמה — במקום שבו מחליטים.
 */
export function ReferralRulesPanel() {
  return (
    <GuidePanel
      icon={<IconHandshake s={14} />}
      title="איך עובדת הפניית לקוח?"
      defaultOpen
    >
      <p className="m-0 mb-2 text-[13px]">
        משרד שמקבל פנייה שאינה מתאימה לו — לא באזור שלו, לא בתחום שלו או שאין לו
        פנאי — מפנה את הלקוח למשרד שכן יכול לשרת אותו, ומקבל <b>עמלת הפניה</b>.
        הלקוח מקבל מענה אמיתי, והמשרד המפנה חייב לומר למה הוא מפנה.
      </p>
      <ul
        className="m-0 mb-3 ps-4 text-[12.5px]"
        style={{ color: "var(--color-text-soft)" }}
      >
        <li>
          <b>המשרד המפנה קובע את התמורה</b> — הוא זה שיודע מה שווה הלקוח שהוא
          מוותר עליו. מתוכה יורדת עמלת פלטפורמה, והפירוק מוצג לו לפני הפרסום.
        </li>
        <li>
          <b>הסיבה חובה</b> ומוצגת בלוח. „מחוץ לאזור שלנו” ו„הלקוח לא התקדם
          איתנו” הן שתי הפניות שונות מאוד — ומי שמשלם צריך לדעת מה מהן.
        </li>
        <li>
          <b>העמלה היא על ההפניה, לא על התוצאה</b> — היא נגבית ברגע הקליטה ואינה
          מוחזרת גם אם לא תיסגר עסקה, ואין עמלה נוספת בסגירה.
        </li>
        <li>
          <b>שני הצדדים מדרגים</b>, והדירוג של המשרדים הקולטים מוצג לצד כל הפניה
          עתידית של המשרד המפנה. זה מה שמייקר הפניית זבל.
        </li>
      </ul>
      <p
        className="m-0 text-[12.5px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        שם וטלפון של הלקוח נחשפים למשרד הקולט רק אחרי הקליטה. עד אז מוצגים
        הכוונה, המקור, העיר, הסיבה והתיאור בלבד.
      </p>
    </GuidePanel>
  );
}

