"use client";

import Link from "next/link";
import {
  IconDoc,
  IconHeadphones,
  IconPhone,
  IconSparkle,
} from "../icons";
import { openSupport } from "../support-button";

/**
 * מה קורה כשהטלפון מחובר — למשרד שעדיין אינו מחובר.
 *
 * ## למה זה מסך ולא פסקה
 *
 * קודם עמד כאן טקסט אחד רץ שמנה שש יכולות במשפט אחד. מתווך שסורק
 * מסך בין פגישות אינו קורא פסקה כדי להחליט אם להתעניין — הוא מסתכל.
 * ארבעה שלבים עם אייקון כל אחד נקראים במבט, והם גם מספרים את
 * הסיפור הנכון: זו **שרשרת** שקורית מעצמה, לא רשימת פיצ'רים.
 *
 * ## למה מעט מלים
 *
 * כל שלב הוא משפט אחד. מה שלא נכנס למשפט אחד אינו שייך למסך
 * שנועד לגרום להרים טלפון — הוא שייך לשיחה שאחריו.
 *
 * ## שתי דרכי המשך, ולא אחת
 *
 * „דברו איתי” פותח את טופס הפנייה למי שרוצה שיחזרו אליו, וקישור
 * להגדרות למי שכבר יודע מה לעשות ורק צריך להגיע לשם. הפרדה בין
 * השניים מונעת מהמסך לחסום את מי שמוכן לפעול לבד.
 */

const REQUEST_TEXT = "אשמח לחבר את הטלפון של המשרד למערכת. נא צרו איתי קשר.";

const STEPS = [
  {
    icon: IconPhone,
    title: "השיחה נרשמת לבד",
    text: "כל שיחה נכנסת ויוצאת נכנסת ליומן, והלקוח המתקשר מזוהה ונפתח בכרטיס שלו.",
  },
  {
    icon: IconHeadphones,
    title: "ההקלטה נשמרת",
    text: "אפשר לחזור ולהאזין לכל שיחה מהכרטיס — גם חודשים אחריה.",
  },
  {
    icon: IconDoc,
    title: "התמלול נכתב",
    text: "המערכת מתמללת את השיחה בעברית ומסמנת מי אמר מה.",
  },
  {
    icon: IconSparkle,
    title: "הסיכום והמשימה",
    text: "תקציר קצר נכנס לכרטיס, ומשימת המשך נפתחת כדי ששום לקוח לא ייפול.",
  },
] as const;

export function TelephonyPitch(): React.JSX.Element {
  return (
    <section className="mv-pitch" aria-labelledby="pbx-pitch-heading">
      <div className="mv-pitch-head">
        {/*
          האיור דקורטיבי לגמרי: טלפון שממנו יוצא גל קול שהופך לשורות
          כתובות. הוא נצבע בטוקנים ולכן מתהפך נכון במצב כהה.
        */}
        <svg className="mv-pitch-art" viewBox="0 0 220 120" aria-hidden="true">
          <ellipse cx="110" cy="62" rx="100" ry="52" className="mv-pitch-blob" />
          {/* השפופרת */}
          <rect x="26" y="30" width="46" height="64" rx="11" className="mv-pitch-device" />
          <path d="M40 44h18" className="mv-pitch-line" />
          <path d="M40 54h18" className="mv-pitch-line" />
          {/* גל הקול שיוצא ממנה */}
          <g className="mv-pitch-wave">
            <path d="M86 62v-10" />
            <path d="M98 62v-20" />
            <path d="M110 62v-28" />
            <path d="M122 62v-18" />
          </g>
          {/* הדף שנכתב מהשיחה */}
          <rect x="140" y="28" width="56" height="68" rx="9" className="mv-pitch-page" />
          <path d="M152 46h32" className="mv-pitch-line" />
          <path d="M152 58h32" className="mv-pitch-line" />
          <path d="M152 70h20" className="mv-pitch-line" />
        </svg>

        <div className="mv-pitch-intro">
          <h2 id="pbx-pitch-heading" className="mv-pitch-title">
            חברו את הטלפון — וכל שיחה תתעד את עצמה
          </h2>
          <p className="mv-pitch-sub">
            בלי להקליד כלום אחרי שיחה, ובלי לזכור למי להתקשר בחזרה.
          </p>
        </div>
      </div>

      <ol className="mv-pitch-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="mv-pitch-step">
            <span className="mv-pitch-step-icon" aria-hidden="true">
              <step.icon s={22} />
            </span>
            {/* המספר מסמן שרשרת ולא רשימה — הסדר הוא חלק מהמסר */}
            <span className="mv-pitch-step-num" aria-hidden="true">
              {index + 1}
            </span>
            <h3 className="mv-pitch-step-title">{step.title}</h3>
            <p className="mv-pitch-step-text">{step.text}</p>
          </li>
        ))}
      </ol>

      <div className="mv-pitch-actions">
        <button
          type="button"
          className="mv-pitch-cta"
          onClick={() => openSupport({ kind: "question", text: REQUEST_TEXT })}
        >
          להצטרפות לשירות
        </button>
        <Link href="/settings?tab=integrations#telephony" className="mv-pitch-link">
          כבר יש לי מרכזיה — לחיבור בהגדרות ←
        </Link>
      </div>
    </section>
  );
}
